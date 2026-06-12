import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
  OnModuleInit, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowCard, WORKFLOW_STAGES } from './workflow-card.entity';
import { Project } from '../projects/project.entity';
import { AppGateway } from '../gateway/app.gateway';

interface Viewer { id: string; role: string }

/** Роли, которые могут редактировать доску любого SMM-проекта.
 *  Остальным нужно быть менеджером или участником проекта. */
const PRIVILEGED = ['admin', 'founder', 'co_founder', 'smm_director'];

@Injectable()
export class WorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    @InjectRepository(WorkflowCard) private repo: Repository<WorkflowCard>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private gateway: AppGateway,
  ) {}

  /** Идемпотентное создание таблицы — рантайм-замена миграции
   *  (тот же паттерн, что lead_progress в ClientsService). */
  async onModuleInit() {
    try {
      await this.repo.manager.query(`
        CREATE TABLE IF NOT EXISTS workflow_cards (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "projectId"   uuid NOT NULL,
          title         varchar NOT NULL,
          description   text,
          "contentType" varchar,
          deadline      date,
          "assigneeId"  uuid,
          stage         varchar NOT NULL DEFAULT 'content_plan',
          position      int NOT NULL DEFAULT 0,
          "createdById" uuid,
          "createdAt"   timestamp NOT NULL DEFAULT NOW(),
          "updatedAt"   timestamp NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_cards_project
          ON workflow_cards ("projectId", stage, position);
      `);
    } catch (e: any) {
      this.logger.warn(`CREATE TABLE workflow_cards failed: ${e?.message || e}`);
    }
  }

  /** Может ли пользователь редактировать доску проекта:
   *  привилегированная роль, менеджер проекта (назначаемый — любой
   *  роли) или участник проекта. */
  private async assertCanEdit(projectId: string, viewer: Viewer): Promise<Project> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Проект не найден');
    if (PRIVILEGED.includes(viewer.role)) return project;
    if (project.managerId === viewer.id) return project;
    const rows = await this.repo.manager.query(
      `SELECT 1 FROM project_members WHERE "projectsId" = $1 AND "usersId" = $2 LIMIT 1`,
      [projectId, viewer.id],
    );
    if (rows.length > 0) return project;
    throw new ForbiddenException('Нет доступа к доске этого проекта');
  }

  private broadcast(projectId: string) {
    try {
      this.gateway.broadcast('workflow:changed', { projectId });
    } catch { /* best-effort */ }
  }

  /** Карточки проекта, сгруппированные по этапам делает фронт —
   *  отдаём плоский отсортированный список с исполнителями. */
  async list(projectId: string) {
    return this.repo.find({
      where: { projectId },
      relations: ['assignee'],
      order: { stage: 'ASC', position: 'ASC', createdAt: 'ASC' },
    }).then(cards => cards.map(c => this.toDto(c)));
  }

  private toDto(c: WorkflowCard) {
    return {
      id: c.id,
      projectId: c.projectId,
      title: c.title,
      description: c.description,
      contentType: c.contentType,
      deadline: c.deadline,
      stage: c.stage,
      position: c.position,
      assigneeId: c.assigneeId,
      assignee: c.assignee ? {
        id: c.assignee.id,
        name: c.assignee.name,
        avatar: c.assignee.avatar || null,
        role: c.assignee.role,
        secondaryRole: c.assignee.secondaryRole || null,
      } : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  async create(projectId: string, dto: any, viewer: Viewer) {
    await this.assertCanEdit(projectId, viewer);
    const title = String(dto?.title || '').trim();
    if (!title) throw new BadRequestException('Заголовок обязателен');
    const stage = WORKFLOW_STAGES.includes(dto?.stage) ? dto.stage : 'content_plan';
    // Новая карточка — в конец колонки.
    const [{ max }] = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max
       FROM workflow_cards WHERE "projectId" = $1 AND stage = $2`,
      [projectId, stage],
    );
    const card = this.repo.create({
      projectId,
      title: title.slice(0, 300),
      description: dto?.description ? String(dto.description).slice(0, 5000) : null,
      contentType: dto?.contentType ? String(dto.contentType).slice(0, 30) : null,
      deadline: dto?.deadline || null,
      assigneeId: dto?.assigneeId || null,
      stage,
      position: Number(max) + 1,
      createdById: viewer.id,
    });
    const saved = await this.repo.save(card);
    this.broadcast(projectId);
    return this.repo.findOne({ where: { id: saved.id }, relations: ['assignee'] })
      .then(c => this.toDto(c!));
  }

  async update(id: string, dto: any, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanEdit(card.projectId, viewer);
    const patch: Partial<WorkflowCard> = {};
    if (dto.title !== undefined) {
      const t = String(dto.title || '').trim();
      if (!t) throw new BadRequestException('Заголовок обязателен');
      patch.title = t.slice(0, 300);
    }
    if (dto.description !== undefined) patch.description = dto.description ? String(dto.description).slice(0, 5000) : null;
    if (dto.contentType !== undefined) patch.contentType = dto.contentType ? String(dto.contentType).slice(0, 30) : null;
    if (dto.deadline !== undefined) patch.deadline = dto.deadline || null;
    if (dto.assigneeId !== undefined) patch.assigneeId = dto.assigneeId || null;
    await this.repo.update(id, patch);
    this.broadcast(card.projectId);
    return this.repo.findOne({ where: { id }, relations: ['assignee'] })
      .then(c => this.toDto(c!));
  }

  /** Перенос карточки: смена этапа и/или позиции внутри колонки.
   *  position — целевой индекс (0 = верх). Остальные карточки целевой
   *  колонки перенумеровываются. */
  async move(id: string, dto: { stage?: string; position?: number }, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanEdit(card.projectId, viewer);

    const targetStage = dto.stage && WORKFLOW_STAGES.includes(dto.stage as any)
      ? dto.stage
      : card.stage;

    // Карточки целевой колонки без переносимой, в текущем порядке.
    const siblings = await this.repo.find({
      where: { projectId: card.projectId, stage: targetStage },
      order: { position: 'ASC', createdAt: 'ASC' },
    }).then(list => list.filter(c => c.id !== id));

    const rawPos = dto.position;
    const idx = rawPos === undefined || rawPos === null
      ? siblings.length
      : Math.max(0, Math.min(Number(rawPos) || 0, siblings.length));
    siblings.splice(idx, 0, card);

    // Bulk-перенумерация: одна транзакция, чтобы не было дублей позиций.
    await this.repo.manager.transaction(async tx => {
      for (let i = 0; i < siblings.length; i++) {
        await tx.update(WorkflowCard, siblings[i].id, {
          position: i,
          ...(siblings[i].id === id ? { stage: targetStage } : {}),
        });
      }
    });

    this.broadcast(card.projectId);
    return { ok: true };
  }

  async remove(id: string, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanEdit(card.projectId, viewer);
    await this.repo.delete(id);
    this.broadcast(card.projectId);
    return { ok: true };
  }
}
