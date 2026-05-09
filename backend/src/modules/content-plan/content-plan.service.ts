import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  ContentPlanItem,
  ContentPlanStatus,
  ContentApprovalStatus,
  ContentItemType,
} from './content-plan-item.entity';
import { Task, TaskStatus, TaskPriority } from '../tasks/task.entity';

export interface ContentPlanFilters {
  projectId?: string;
  status?: ContentPlanStatus;
  approvalStatus?: ContentApprovalStatus;
  assigneeId?: string;
  contentType?: ContentItemType;
  from?: string;  // YYYY-MM-DD — нижняя граница publishDate
  to?: string;    // YYYY-MM-DD — верхняя граница publishDate
}

const CONTENT_TYPE_LABEL: Record<string, string> = {
  reel: 'Reel',
  story: 'История',
  post: 'Пост',
  design: 'Дизайн',
  ad: 'Реклама',
  video: 'Видео',
  carousel: 'Карусель',
  other: 'Контент',
};

@Injectable()
export class ContentPlanService {
  private readonly logger = new Logger(ContentPlanService.name);

  constructor(
    @InjectRepository(ContentPlanItem) private repo: Repository<ContentPlanItem>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
  ) {}

  /** Собирает payload задачи из элемента контент-плана. */
  private buildTaskPayload(item: ContentPlanItem, createdById?: string): Partial<Task> {
    const typeLabel = CONTENT_TYPE_LABEL[item.contentType] || 'Контент';
    return {
      title: `${typeLabel}: ${item.topic}`,
      description: item.caption || undefined,
      projectId: item.projectId,
      assigneeId: item.assigneeId || undefined,
      createdById: createdById || undefined,
      // Дедлайн задачи = дата публикации; стартовая = дедлайн подготовки.
      deadline: item.publishDate || item.preparationDeadline || undefined,
      startDate: (item.preparationDeadline || item.publishDate || undefined) as any,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.NEW,
    };
  }

  /** Создаёт или обновляет связанную задачу под элемент плана.
   *  Минимальная синхронизация: title/description/assignee/dates. Без
   *  уведомлений и activity-log — это служебная авто-задача от плана. */
  private async syncTaskForItem(item: ContentPlanItem, createdById?: string): Promise<string | null> {
    // Создаём задачу только если есть и assignee, и какая-то дата —
    // иначе она бесполезна (пустая задача без сроков и исполнителя).
    if (!item.assigneeId || (!item.publishDate && !item.preparationDeadline)) {
      return item.taskId || null;
    }
    const payload = this.buildTaskPayload(item, createdById);
    if (item.taskId) {
      // Обновляем существующую задачу (если она ещё жива).
      const existing = await this.taskRepo.findOne({ where: { id: item.taskId } });
      if (existing) {
        await this.taskRepo.update(item.taskId, {
          title: payload.title,
          description: payload.description,
          assigneeId: payload.assigneeId,
          deadline: payload.deadline,
          startDate: payload.startDate as any,
        });
        return item.taskId;
      }
      // Задача удалена вручную — пересоздадим.
    }
    const task = this.taskRepo.create(payload);
    const saved = await this.taskRepo.save(task);
    return saved.id;
  }

  /** Удаляет авто-задачу под элемент плана (если она была привязана). */
  private async removeTaskForItem(item: ContentPlanItem): Promise<void> {
    if (!item.taskId) return;
    try {
      await this.taskRepo.delete(item.taskId);
    } catch (e) {
      this.logger.warn(`Failed to delete linked task ${item.taskId}: ${(e as Error).message}`);
    }
  }

  async findAll(f: ContentPlanFilters = {}) {
    const qb = this.repo.createQueryBuilder('c')
      .leftJoinAndSelect('c.assignee', 'assignee')
      .leftJoinAndSelect('c.pm', 'pm')
      .leftJoinAndSelect('c.project', 'project');

    if (f.projectId) qb.andWhere('c.projectId = :pid', { pid: f.projectId });
    if (f.status) qb.andWhere('c.status = :st', { st: f.status });
    if (f.approvalStatus) qb.andWhere('c.approvalStatus = :ast', { ast: f.approvalStatus });
    if (f.assigneeId) qb.andWhere('c.assigneeId = :aid', { aid: f.assigneeId });
    if (f.contentType) qb.andWhere('c.contentType = :ct', { ct: f.contentType });
    if (f.from) qb.andWhere('c.publishDate >= :from', { from: f.from });
    if (f.to) qb.andWhere('c.publishDate <= :to', { to: f.to });

    qb.orderBy('c.publishDate', 'ASC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'pm', 'project'],
    });
    if (!item) throw new NotFoundException('Content plan item not found');
    return item;
  }

  async create(dto: Partial<ContentPlanItem>, createdById?: string) {
    const item = this.repo.create(dto);
    const saved = await this.repo.save(item);
    // Авто-создание задачи под этот элемент (если есть assignee + дата).
    const taskId = await this.syncTaskForItem(saved, createdById);
    if (taskId && taskId !== saved.taskId) {
      saved.taskId = taskId;
      await this.repo.update(saved.id, { taskId });
    }
    return saved;
  }

  /** Массовое создание — нужно для авто-генерации плана из тарифа. */
  async createMany(items: Partial<ContentPlanItem>[], createdById?: string) {
    if (!items.length) return [];
    const entities = items.map(d => this.repo.create(d));
    const saved = await this.repo.save(entities);
    // Параллельно создаём задачи. Игнорируем ошибки отдельных элементов —
    // план уже сохранён, задачи это вторичный артефакт.
    await Promise.all(saved.map(async (s) => {
      try {
        const taskId = await this.syncTaskForItem(s, createdById);
        if (taskId && taskId !== s.taskId) {
          s.taskId = taskId;
          await this.repo.update(s.id, { taskId });
        }
      } catch (e) {
        this.logger.warn(`Failed to auto-create task for plan item ${s.id}: ${(e as Error).message}`);
      }
    }));
    return saved;
  }

  async update(id: string, dto: Partial<ContentPlanItem>, updatedById?: string) {
    const before = await this.findOne(id);
    const { id: _id, createdAt, updatedAt, ...patch } = dto as any;
    await this.repo.update(id, patch);
    const after = await this.findOne(id);
    // Синхронизируем связанную задачу — title/assignee/dates могли измениться.
    try {
      const taskId = await this.syncTaskForItem(after, updatedById);
      if (taskId && taskId !== after.taskId) {
        after.taskId = taskId;
        await this.repo.update(after.id, { taskId });
      }
    } catch (e) {
      this.logger.warn(`Failed to sync task for plan item ${id}: ${(e as Error).message}`);
    }
    return after;
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    // Удаляем связанную задачу (если ещё жива).
    await this.removeTaskForItem(item);
    await this.repo.remove(item);
    return { message: 'Content plan item deleted' };
  }

  /** План-факт по проекту: сколько чего запланировано vs опубликовано.
   *  Используется в Wave 5 (план-факт) и в риск-скоринге. */
  async getPlanFactByProject(projectId: string) {
    const rows = await this.repo
      .createQueryBuilder('c')
      .select('c.contentType', 'contentType')
      .addSelect('COUNT(*)', 'planned')
      .addSelect(`SUM(CASE WHEN c.status = 'published' THEN 1 ELSE 0 END)`, 'published')
      .addSelect(`SUM(CASE WHEN c.status = 'cancelled' THEN 1 ELSE 0 END)`, 'cancelled')
      .where('c.projectId = :pid', { pid: projectId })
      .groupBy('c.contentType')
      .getRawMany();

    return rows.map(r => ({
      contentType: r.contentType,
      planned: Number(r.planned),
      published: Number(r.published),
      cancelled: Number(r.cancelled),
      remaining: Math.max(0, Number(r.planned) - Number(r.published) - Number(r.cancelled)),
    }));
  }
}
