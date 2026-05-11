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
import { AppGateway } from '../gateway/app.gateway';

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
    private gateway: AppGateway,
  ) {}

  /** Сообщить фронту что задачи проекта изменились — он перезагрузит
   *  канбан и календарь без F5 (useSocket подписан на tasks:changed). */
  private emitTasksChanged(projectId?: string) {
    try {
      this.gateway.broadcast('tasks:changed', projectId ? { projectId } : {});
    } catch (e) {
      this.logger.warn(`Failed to broadcast tasks:changed: ${(e as Error).message}`);
    }
  }

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
    const hasTopic = !!(item.topic && item.topic.trim());
    const hasDate = !!(item.publishDate || item.preparationDeadline);
    // Без topic ИЛИ без даты задача бесполезна. Если ранее существовала
    // связанная задача (item.taskId) и теперь стало "не задача" — удаляем
    // её, чтобы не оставлять сирот с устаревшими данными в канбане/календаре.
    if (!hasTopic || !hasDate) {
      if (item.taskId) {
        await this.removeTaskForItem(item);
        return null;
      }
      return null;
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
    const items = await qb.getMany();

    // Lazy backfill: при открытии плана конкретного проекта проверяем,
    // что у каждого элемента с датой есть связанная задача. Если нет —
    // создаём задачу-плэйсхолдер. Это гарантирует что элементы, созданные
    // до миграции taskId или сгенерированные авто-генерацией из тарифа
    // без assignee, появятся в канбане задач и в календаре проекта.
    // Делаем синхронно (await), чтобы при следующем переходе на /tasks
    // или /calendar данные уже были на месте — без необходимости F5.
    if (f.projectId) {
      const orphans = items.filter(it =>
        !it.taskId && (it.publishDate || it.preparationDeadline),
      );
      if (orphans.length > 0) {
        await Promise.all(orphans.map(async (it) => {
          try {
            const taskId = await this.syncTaskForItem(it);
            if (taskId && taskId !== it.taskId) {
              await this.repo.update(it.id, { taskId });
              it.taskId = taskId;
            }
          } catch (e) {
            this.logger.warn(`Backfill task for item ${it.id} failed: ${(e as Error).message}`);
          }
        }));
        // Уведомляем фронт чтобы канбан/календарь перерисовались сразу.
        this.emitTasksChanged(f.projectId);
      }
    }

    return items;
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
    if (taskId) this.emitTasksChanged(saved.projectId);
    return saved;
  }

  /** Массовое создание — нужно для авто-генерации плана из тарифа. */
  async createMany(items: Partial<ContentPlanItem>[], createdById?: string) {
    if (!items.length) return [];
    const entities = items.map(d => this.repo.create(d));
    const saved = await this.repo.save(entities);
    // Параллельно создаём задачи. Игнорируем ошибки отдельных элементов —
    // план уже сохранён, задачи это вторичный артефакт.
    let createdAny = false;
    await Promise.all(saved.map(async (s) => {
      try {
        const taskId = await this.syncTaskForItem(s, createdById);
        if (taskId && taskId !== s.taskId) {
          s.taskId = taskId;
          await this.repo.update(s.id, { taskId });
          createdAny = true;
        }
      } catch (e) {
        this.logger.warn(`Failed to auto-create task for plan item ${s.id}: ${(e as Error).message}`);
      }
    }));
    if (createdAny) this.emitTasksChanged(saved[0]?.projectId);
    return saved;
  }

  async update(id: string, dto: Partial<ContentPlanItem>, updatedById?: string) {
    const before = await this.findOne(id);
    const { id: _id, createdAt, updatedAt, ...patch } = dto as any;
    await this.repo.update(id, patch);
    const after = await this.findOne(id);
    // Синхронизируем связанную задачу — title/assignee/dates могли измениться.
    // syncTaskForItem может вернуть null (если задача была удалена из-за
    // удаления дат или очистки topic) — тогда обнуляем taskId в БД.
    try {
      const taskId = await this.syncTaskForItem(after, updatedById);
      if (taskId !== after.taskId) {
        after.taskId = taskId as any;
        await this.repo.update(after.id, { taskId: taskId as any });
      }
    } catch (e) {
      this.logger.warn(`Failed to sync task for plan item ${id}: ${(e as Error).message}`);
    }
    this.emitTasksChanged(after.projectId);
    return after;
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    // Удаляем связанную задачу (если ещё жива).
    await this.removeTaskForItem(item);
    await this.repo.remove(item);
    if (item.taskId) this.emitTasksChanged(item.projectId);
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
