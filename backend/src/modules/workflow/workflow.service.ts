import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
  OnModuleInit, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WorkflowCard, WORKFLOW_STAGES } from './workflow-card.entity';
import { ShootSession } from './shoot-session.entity';
import { UnitEvent } from './unit-event.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { AppGateway } from '../gateway/app.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';
import { MailService } from '../mail/mail.service';

interface Viewer { id: string; role: string }
interface Actor { id: string; name: string; role: string; secondaryRole: string | null }

/** Роли, которые могут редактировать доску любого SMM-проекта.
 *  Остальным нужно быть менеджером или участником проекта. */
const PRIVILEGED = ['admin', 'founder', 'co_founder', 'smm_director'];

/** Роли, видящие ВСЕ SMM-проекты на глобальной доске. Организатор —
 *  управляющая роль производства, видит и редактирует всю доску. */
const SEE_ALL = ['admin', 'founder', 'co_founder', 'smm_director', 'video_director', 'organizer'];

/** Полный доступ к действиям движка (ADMIN-уровень из ТЗ §12). */
const ALL_ACCESS = ['admin', 'founder', 'co_founder'];

/** Роли, которым разрешено РЕДАКТИРОВАТЬ данные доски (создавать/менять/
 *  удалять карточки, назначать исполнителей, заполнять КП и съёмку).
 *  Остальные роли — только смена статуса своих карточек. */
const MANAGE_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'organizer'];

/** Человекочитаемые названия этапов (для журнала и уведомлений). */
const STAGE_LABELS: Record<string, string> = {
  content_plan: 'Контент-план',
  organization: 'Организация',
  shooting: 'Съёмка',
  editing: 'Монтаж',
  design: 'Дизайн',
  internal_review: 'Внутренняя проверка',
  client_approval: 'Согласование с клиентом',
  ready_to_publish: 'Готово к публикации',
  published: 'Опубликовано',
  ads: 'Реклама',
};

/** Роль-владелец этапа — кого уведомлять при входе карточки на этап. */
const STAGE_ROLES: Record<string, string[]> = {
  content_plan: ['scriptwriter'],
  organization: ['organizer'],
  shooting: ['video_director', 'videographer'],
  editing: ['video_editor'],
  design: ['designer'],
  internal_review: ['qa'],
  client_approval: ['smm_director'],
  ready_to_publish: ['publisher'],
  published: [],
  ads: ['targetologist'],
};

/** Маршрут групповой карточки (Рилсы/Макеты) по этапам. Группа едет целиком;
 *  каждый элемент можно вынести отдельно (advanceItem) на тот же next-этап. */
const GROUP_NEXT: Record<string, Record<string, string>> = {
  reels: {
    organization: 'shooting', shooting: 'editing', editing: 'internal_review',
    internal_review: 'client_approval', client_approval: 'ready_to_publish',
    ready_to_publish: 'published',
  },
  macros: {
    organization: 'design', design: 'internal_review',
    internal_review: 'client_approval', client_approval: 'ready_to_publish',
    ready_to_publish: 'published',
  },
};

/** RBAC: какая роль может выполнить действие выхода этапа (ТЗ §12).
 *  ALL_ACCESS (admin/founder/co_founder) могут всё. */
const ACTION_ROLES: Record<string, string[]> = {
  confirm_plan: ['scriptwriter'],
  org_confirm: ['organizer'],
  confirm_shoot: ['organizer'],
  assign_videographer: ['video_director'],
  shoot_done: ['videographer', 'video_director'],
  editing_done: ['video_editor'],
  cover_done: ['designer'],
  layout_done: ['designer'],
  qa_accept: ['qa'],
  qa_rework: ['qa'],
  mark_sent_to_client: ['smm_director'],
  client_approve: ['smm_director'],
  client_revisions: ['smm_director'],
  publish: ['publisher'],
};

/** Обратное планирование дедлайнов от publishDate (ТЗ §11), дни до публикации. */
const DEADLINE_OFFSETS: Record<string, Record<string, number>> = {
  reels: { organization: 12, shooting: 9, editing: 5, design: 5, internal_review: 3, client_approval: 2, ready_to_publish: 1 },
  static: { design: 5, internal_review: 3, client_approval: 2, ready_to_publish: 1 },
};

@Injectable()
export class WorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    @InjectRepository(WorkflowCard) private repo: Repository<WorkflowCard>,
    @InjectRepository(ShootSession) private shootRepo: Repository<ShootSession>,
    @InjectRepository(UnitEvent) private eventRepo: Repository<UnitEvent>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(SmmTariff) private tariffRepo: Repository<SmmTariff>,
    private gateway: AppGateway,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    private mail: MailService,
  ) {}

  /** Идемпотентное создание/миграция таблиц — рантайм-замена миграции. */
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
      // Новые колонки движка (ТЗ §6) — идемпотентно.
      const cols = [
        `ADD COLUMN IF NOT EXISTS type varchar`,
        `ADD COLUMN IF NOT EXISTS "parentCardId" uuid`,
        `ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'active'`,
        `ADD COLUMN IF NOT EXISTS "needsCover" boolean NOT NULL DEFAULT true`,
        `ADD COLUMN IF NOT EXISTS "needsIntro" boolean NOT NULL DEFAULT true`,
        `ADD COLUMN IF NOT EXISTS "editingDone" boolean NOT NULL DEFAULT false`,
        `ADD COLUMN IF NOT EXISTS "designDone" boolean NOT NULL DEFAULT false`,
        `ADD COLUMN IF NOT EXISTS "rawFootageUrl" text`,
        `ADD COLUMN IF NOT EXISTS "finalCutUrl" text`,
        `ADD COLUMN IF NOT EXISTS "finalAssetUrl" text`,
        `ADD COLUMN IF NOT EXISTS "coverUrl" text`,
        `ADD COLUMN IF NOT EXISTS "introUrl" text`,
        `ADD COLUMN IF NOT EXISTS "publishedUrl" text`,
        `ADD COLUMN IF NOT EXISTS "publishDate" date`,
        `ADD COLUMN IF NOT EXISTS "publishedAt" timestamptz`,
        `ADD COLUMN IF NOT EXISTS "shootDate" date`,
        `ADD COLUMN IF NOT EXISTS "shootTime" varchar`,
        `ADD COLUMN IF NOT EXISTS "shootLocation" varchar`,
        `ADD COLUMN IF NOT EXISTS "shootSessionId" uuid`,
        `ADD COLUMN IF NOT EXISTS "reworkComment" text`,
        `ADD COLUMN IF NOT EXISTS "sentToClientAt" timestamptz`,
        `ADD COLUMN IF NOT EXISTS "clientComment" text`,
        `ADD COLUMN IF NOT EXISTS "stageDeadlines" jsonb`,
        `ADD COLUMN IF NOT EXISTS kind varchar`,
        `ADD COLUMN IF NOT EXISTS items jsonb`,
        `ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false`,
        `ADD COLUMN IF NOT EXISTS "assigneeIds" jsonb`,
      ];
      for (const c of cols) {
        await this.repo.manager.query(`ALTER TABLE workflow_cards ${c}`);
      }
      await this.repo.manager.query(`
        CREATE TABLE IF NOT EXISTS shoot_sessions (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "projectId"   uuid NOT NULL,
          title         varchar,
          date          date,
          time          varchar,
          location      varchar,
          note          text,
          "createdById" uuid,
          "createdAt"   timestamp NOT NULL DEFAULT NOW(),
          "updatedAt"   timestamp NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS unit_events (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "cardId"    uuid NOT NULL,
          action      varchar NOT NULL,
          "fromStage" varchar,
          "toStage"   varchar,
          "actorId"   uuid,
          "actorName" varchar,
          message     text,
          comment     text,
          meta        jsonb,
          "createdAt" timestamp NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_unit_events_card ON unit_events ("cardId", "createdAt");
        CREATE TABLE IF NOT EXISTS workflow_settings (
          id          varchar PRIMARY KEY,
          data        jsonb,
          "updatedAt" timestamp NOT NULL DEFAULT NOW()
        );
      `);
    } catch (e: any) {
      this.logger.warn(`workflow_cards migration failed: ${e?.message || e}`);
    }
  }

  /** Отступы дедлайнов: системная настройка (ТЗ §11), фолбэк — дефолты. */
  async getDeadlineOffsets(): Promise<Record<string, Record<string, number>>> {
    try {
      const rows = await this.repo.manager.query(
        `SELECT data FROM workflow_settings WHERE id = 'deadline_offsets' LIMIT 1`,
      );
      const data = rows?.[0]?.data;
      if (data && data.reels && data.static) return data;
    } catch { /* fallback */ }
    return DEADLINE_OFFSETS;
  }

  async updateDeadlineOffsets(
    dto: { reels?: Record<string, number>; static?: Record<string, number> },
    viewer: Viewer,
  ) {
    if (!['admin', 'founder', 'co_founder', 'smm_director'].includes(viewer.role)) {
      throw new ForbiddenException('Настраивать дедлайны может только руководитель');
    }
    const merged = {
      reels: { ...DEADLINE_OFFSETS.reels, ...(dto.reels || {}) },
      static: { ...DEADLINE_OFFSETS.static, ...(dto.static || {}) },
    };
    await this.repo.manager.query(
      `INSERT INTO workflow_settings (id, data, "updatedAt") VALUES ('deadline_offsets', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, "updatedAt" = NOW()`,
      [merged],
    );
    return merged;
  }

  // ─── Доступ ───────────────────────────────────────────────────────────

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

  /** RBAC редактирования: менять данные доски могут только руководитель SMM,
   *  организатор и ADMIN-уровень (admin/founder/co_founder). Проверяем обе
   *  роли (основную и вторую). */
  private async assertCanManage(viewer: Viewer): Promise<void> {
    if (MANAGE_ROLES.includes(viewer.role)) return;
    const u = await this.userRepo.findOne({ where: { id: viewer.id } });
    if (u?.secondaryRole && MANAGE_ROLES.includes(u.secondaryRole)) return;
    throw new ForbiddenException('Изменять доску может только руководитель SMM или организатор');
  }

  /** Доступ к карточке для статус-действий: ADMIN-уровень, исполнитель самой
   *  карточки (в т.ч. среди элементов группы), управляющие роли или
   *  участник/менеджер проекта. Сами права на действие проверяет
   *  assertCanAct / assertStageRole. */
  private async assertCanAccessCard(card: WorkflowCard, viewer: Viewer): Promise<void> {
    if (PRIVILEGED.includes(viewer.role) || MANAGE_ROLES.includes(viewer.role)) return;
    if (this.isAssignee(card, viewer.id)) return;
    await this.assertCanEdit(card.projectId, viewer);
  }

  /** Является ли пользователь исполнителем карточки — учитывая нескольких
   *  исполнителей (assigneeIds) и назначения внутри элементов группы. */
  private isAssignee(card: WorkflowCard, uid: string): boolean {
    if (card.assigneeId === uid) return true;
    if (Array.isArray(card.assigneeIds) && card.assigneeIds.includes(uid)) return true;
    const items = (card.items || []) as any[];
    if (Array.isArray(items)) {
      return items.some(it =>
        it?.assigneeId === uid ||
        (Array.isArray(it?.assigneeIds) && it.assigneeIds.includes(uid)));
    }
    return false;
  }

  /** Загружает актёра с обеими ролями и именем (для RBAC и журнала). */
  private async loadActor(userId: string): Promise<Actor> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    return {
      id: userId,
      name: u?.name || 'Сотрудник',
      role: u?.role || '',
      secondaryRole: u?.secondaryRole || null,
    };
  }

  /** RBAC действия выхода этапа (ТЗ §12). */
  private assertCanAct(action: string, actor: Actor) {
    if (ALL_ACCESS.includes(actor.role)) return;
    const allowed = ACTION_ROLES[action] || [];
    if (allowed.includes(actor.role)) return;
    if (actor.secondaryRole && allowed.includes(actor.secondaryRole)) return;
    throw new ForbiddenException('У вас нет прав на это действие для текущего этапа');
  }

  /** RBAC по роли-владельцу ТЕКУЩЕГО этапа (для групповых действий, где этап
   *  меняется: организатор на «Организации», дизайнер на «Дизайне» и т.д.). */
  private assertStageRole(stage: string, actor: Actor) {
    if (ALL_ACCESS.includes(actor.role)) return;
    const roles = STAGE_ROLES[stage] || [];
    if (roles.includes(actor.role)) return;
    if (actor.secondaryRole && roles.includes(actor.secondaryRole)) return;
    throw new ForbiddenException('Нет прав для действия на этом этапе');
  }

  private broadcast(projectId: string) {
    try { this.gateway.broadcast('workflow:changed', { projectId }); } catch { /* best-effort */ }
  }

  // ─── Чтение ───────────────────────────────────────────────────────────

  async list(projectId: string, viewer: Viewer) {
    // B1: доска проекта видна только участнику/менеджеру/привилегированной роли.
    await this.assertCanEdit(projectId, viewer);
    return this.repo.find({
      where: { projectId },
      relations: ['assignee', 'createdBy'],
      order: { stage: 'ASC', position: 'ASC', createdAt: 'ASC' },
    }).then(cards => cards.map(c => this.toDto(c)));
  }

  async listAll(viewer: Viewer) {
    const projects = await this.projectRepo.createQueryBuilder('p')
      .select(['p.id', 'p.name', 'p.managerId'])
      .where('p."isArchived" = false')
      .andWhere(`p."projectType" = 'SMM'`)
      .getMany();
    if (projects.length === 0) return [];
    const nameMap = new Map(projects.map(p => [p.id, p.name]));

    const cards = await this.repo.find({
      where: { projectId: In(projects.map(p => p.id)) },
      relations: ['assignee', 'createdBy'],
      order: { stage: 'ASC', position: 'ASC', createdAt: 'ASC' },
    });

    let visible = cards;
    if (!SEE_ALL.includes(viewer.role)) {
      // Не-привилегированные: карточки проектов, где они участник/менеджер,
      // ПЛЮС карточки, где они исполнитель (в т.ч. один из нескольких) —
      // чтобы назначенная карточка появилась на их доске даже без членства.
      const memberRows: Array<{ projectsId: string }> = await this.repo.manager.query(
        `SELECT "projectsId" FROM project_members WHERE "usersId" = $1`,
        [viewer.id],
      );
      const myProjectIds = new Set<string>([
        ...projects.filter(p => (p as any).managerId === viewer.id).map(p => p.id),
        ...memberRows.map(r => r.projectsId),
      ]);
      visible = cards.filter(c => myProjectIds.has(c.projectId) || this.isAssignee(c, viewer.id));
    }

    return visible.map(c => ({
      ...this.toDto(c),
      project: { id: c.projectId, name: nameMap.get(c.projectId) || '' },
    }));
  }

  /** Очистить ВСЮ доску (для тестов) — только admin/founder/co_founder. */
  async clearAll(viewer: Viewer) {
    if (!['admin', 'founder', 'co_founder'].includes(viewer.role)) {
      throw new ForbiddenException('Очистить доску может только руководитель');
    }
    await this.repo.manager.query('DELETE FROM workflow_cards');
    await this.repo.manager.query('DELETE FROM unit_events').catch(() => {});
    await this.repo.manager.query('DELETE FROM shoot_sessions').catch(() => {});
    try { this.gateway.broadcast('workflow:changed', {}); } catch { /* best-effort */ }
    return { ok: true };
  }

  /** История событий карточки (ТЗ §9.7 — журнал в «Готово к публикации»). */
  async events(cardId: string, viewer: Viewer) {
    // B2: журнал доступен только тем, у кого есть доступ к проекту карточки.
    const card = await this.repo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanAccessCard(card, viewer);
    return this.eventRepo.find({
      where: { cardId },
      order: { createdAt: 'ASC' },
    });
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
      assigneeIds: c.assigneeIds || null,
      assignee: c.assignee ? {
        id: c.assignee.id,
        name: c.assignee.name,
        avatar: c.assignee.avatar || null,
        role: c.assignee.role,
        secondaryRole: c.assignee.secondaryRole || null,
      } : null,
      createdById: c.createdById,
      createdBy: c.createdBy ? { id: c.createdBy.id, name: c.createdBy.name, avatar: c.createdBy.avatar || null } : null,
      // Поля движка
      type: c.type,
      parentCardId: c.parentCardId,
      status: c.status,
      needsCover: c.needsCover,
      needsIntro: c.needsIntro,
      editingDone: c.editingDone,
      designDone: c.designDone,
      rawFootageUrl: c.rawFootageUrl,
      finalCutUrl: c.finalCutUrl,
      finalAssetUrl: c.finalAssetUrl,
      coverUrl: c.coverUrl,
      introUrl: c.introUrl,
      publishedUrl: c.publishedUrl,
      publishDate: c.publishDate,
      publishedAt: c.publishedAt,
      shootDate: c.shootDate,
      shootTime: c.shootTime,
      shootLocation: c.shootLocation,
      shootSessionId: c.shootSessionId,
      reworkComment: c.reworkComment,
      sentToClientAt: c.sentToClientAt,
      clientComment: c.clientComment,
      stageDeadlines: c.stageDeadlines,
      kind: c.kind,
      items: c.items,
      confirmed: c.confirmed,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────

  async create(projectId: string, dto: any, viewer: Viewer) {
    await this.assertCanManage(viewer);
    const title = String(dto?.title || '').trim();
    if (!title) throw new BadRequestException('Заголовок обязателен');
    const stage = WORKFLOW_STAGES.includes(dto?.stage) ? dto.stage : 'content_plan';
    const type: 'reels' | 'static' | null =
      dto?.type === 'reels' || dto?.type === 'static' ? dto.type : null;
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
      type,
      publishDate: dto?.publishDate || null,
      needsCover: dto?.needsCover !== undefined ? !!dto.needsCover : true,
      needsIntro: dto?.needsIntro !== undefined ? !!dto.needsIntro : true,
      status: 'active',
    });
    const saved = await this.repo.save(card);
    this.broadcast(projectId);
    return this.repo.findOne({ where: { id: saved.id }, relations: ['assignee'] })
      .then(c => this.toDto(c!));
  }

  /** M3: автогенерация плана месяца из тарифа — создаёт пустые слоты
   *  рилсов (reelsPerMonth) и макетов (designsPerMonth) в Контент-плане
   *  с равномерно распределёнными датами публикации. */
  async generatePlan(projectId: string, month: string | undefined, viewer: Viewer) {
    await this.assertCanManage(viewer);
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Проект не найден');
    if (!project.tariffId) throw new BadRequestException('У проекта не привязан тариф');
    const tariff = await this.tariffRepo.findOne({ where: { id: project.tariffId } });
    if (!tariff) throw new BadRequestException('Тариф проекта не найден');

    const reels = Math.max(0, Number(tariff.reelsPerMonth) || 0);
    // Макет = Post → берём из postsPerMonth.
    const statics = Math.max(0, Number(tariff.postsPerMonth) || 0);
    if (reels + statics === 0) throw new BadRequestException('В тарифе нет рилсов и макетов');

    // Месяц: 'YYYY-MM' или текущий.
    const now = new Date();
    let year = now.getFullYear();
    let mon0 = now.getMonth();
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      year = y; mon0 = m - 1;
    }
    const daysInMonth = new Date(year, mon0 + 1, 0).getDate();
    const dist = (count: number) => {
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const day = Math.min(daysInMonth, Math.max(1, Math.round(((i + 1) * daysInMonth) / (count + 1))));
        out.push(`${year}-${String(mon0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      }
      return out;
    };
    const reelDates = dist(reels);
    const staticDates = dist(statics);

    const [{ max }] = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = 'content_plan'`,
      [projectId],
    );
    let pos = Number(max) + 1;
    const toCreate: Partial<WorkflowCard>[] = [];
    for (let i = 0; i < reels; i++) {
      toCreate.push({
        projectId, stage: 'content_plan', position: pos++, status: 'active',
        type: 'reels', needsCover: true, needsIntro: true,
        title: `Рилс #${i + 1}`, contentType: 'reel',
        publishDate: reelDates[i], createdById: viewer.id,
      });
    }
    for (let i = 0; i < statics; i++) {
      toCreate.push({
        projectId, stage: 'content_plan', position: pos++, status: 'active',
        type: 'static', needsCover: false, needsIntro: false,
        title: `Макет #${i + 1}`, contentType: 'design',
        publishDate: staticDates[i], createdById: viewer.id,
      });
    }
    await this.repo.save(toCreate.map(c => this.repo.create(c)));
    this.broadcast(projectId);
    return { created: toCreate.length, reels, statics };
  }

  /** §9.1/§9.2: «Сгруппировать в съёмку» + пакетное «Подтвердить съёмку».
   *  Создаёт ShootSession и для всех выбранных рилсов на этапе Организация
   *  фиксирует дату/место/время и переводит их на Съёмку одним действием. */
  async createShootSession(
    projectId: string,
    dto: { date?: string; time?: string; location?: string; title?: string; cardIds?: string[] },
    viewer: Viewer,
  ) {
    await this.assertCanManage(viewer);
    const actor = await this.loadActor(viewer.id);
    this.assertCanAct('confirm_shoot', actor);
    if (!dto?.date) throw new BadRequestException('Укажите дату съёмки');
    const ids = (dto.cardIds || []).filter(Boolean);
    if (ids.length === 0) throw new BadRequestException('Выберите хотя бы одну карточку');

    // Сначала отбираем подходящие карточки (рилсы на этапе Организация),
    // чтобы не создавать пустую сессию-«сироту».
    const cards = await this.repo.find({ where: { id: In(ids), projectId } });
    const eligible = cards.filter(c => c.stage === 'organization' && this.isReelsCard(c));
    if (eligible.length === 0) {
      throw new BadRequestException('Нет подходящих рилсов на этапе «Организация» среди выбранных');
    }

    const session = await this.shootRepo.save(this.shootRepo.create({
      projectId,
      title: dto.title || null,
      date: dto.date,
      time: dto.time || null,
      location: dto.location || null,
      createdById: viewer.id,
    }));

    for (const card of eligible) {
      await this.repo.update(card.id, {
        shootSessionId: session.id,
        shootDate: dto.date,
        shootTime: dto.time || null,
        shootLocation: dto.location || null,
      });
      await this.moveToStage(card, 'shooting', actor, { message: `Съёмка (группа) на ${dto.date}` });
    }
    this.broadcast(projectId);
    return { ok: true, sessionId: session.id, moved: eligible.length };
  }

  /** Контент-план как групповая карточка: КП-инструкция остаётся в content_plan,
   *  рилсы/макеты уходят рабочими карточками «Рилсы» (→Съёмка) и «Макеты»
   *  (→Дизайн) в «Организацию». */
  async saveContentPlan(
    projectId: string,
    dto: { reels?: any[]; macros?: any[] },
    viewer: Viewer,
  ) {
    await this.assertCanManage(viewer);
    const crypto = require('crypto');
    const norm = (arr: any[] | undefined, itemKind: 'reel' | 'macro') =>
      (Array.isArray(arr) ? arr : []).map(it => ({
        id: it.id || crypto.randomUUID(),
        itemKind,
        title: String(it.title || '').slice(0, 300),
        publishDate: it.publishDate || null,
        description: it.description ? String(it.description).slice(0, 5000) : null,
        assigneeId: it.assigneeId || null,
        assigneeName: it.assigneeName || null,
        assigneeIds: Array.isArray(it.assigneeIds) ? it.assigneeIds.filter(Boolean) : (it.assigneeId ? [it.assigneeId] : []),
        assigneeNames: Array.isArray(it.assigneeNames) ? it.assigneeNames.filter(Boolean) : (it.assigneeName ? [it.assigneeName] : []),
        shootDate: it.shootDate || null,
        shootTime: it.shootTime || null,
        shootLocation: it.shootLocation || null,
      }));
    const reels = norm(dto.reels, 'reel');
    const macros = norm(dto.macros, 'macro');

    // 1) КП-карточка (одна на проект) — инструкция в content_plan.
    const kp = await this.repo.findOne({ where: { projectId, kind: 'kp' } });
    const kpData: any = { title: 'Контент-план', kind: 'kp', stage: 'content_plan', confirmed: true, status: 'active', items: [...reels, ...macros] };
    if (kp) {
      await this.repo.update(kp.id, kpData);
    } else {
      const [{ max }] = await this.repo.manager.query(
        `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = 'content_plan'`,
        [projectId],
      );
      await this.repo.save(this.repo.create({ projectId, position: Number(max) + 1, createdById: viewer.id, ...kpData }));
    }

    // 2) Рабочие карточки «Рилсы» и «Макеты» в «Организации».
    await this.upsertGroupCard(projectId, 'reels', 'Рилсы', reels, viewer);
    await this.upsertGroupCard(projectId, 'macros', 'Макеты', macros, viewer);

    this.broadcast(projectId);
    return { ok: true, reels: reels.length, macros: macros.length };
  }

  /** Создаёт/обновляет групповую карточку. При обновлении мерджит items по id,
   *  сохраняя уже заполненные на этапах поля (исполнитель/дата/время/место). */
  private async upsertGroupCard(
    projectId: string,
    kind: 'reels' | 'macros',
    title: string,
    items: any[],
    viewer: Viewer,
  ) {
    const existing = await this.repo.findOne({ where: { projectId, kind } });
    if (items.length === 0) {
      // В тарифе нет таких единиц — старую карточку (если была) убираем.
      if (existing) await this.repo.delete(existing.id);
      return;
    }
    if (existing) {
      const prevById = new Map((existing.items || []).map((it: any) => [it.id, it]));
      const merged = items.map(it => {
        const prev: any = prevById.get(it.id);
        return prev ? {
          ...it,
          assigneeId: prev.assigneeId ?? it.assigneeId,
          assigneeName: prev.assigneeName ?? it.assigneeName,
          assigneeIds: (prev.assigneeIds && prev.assigneeIds.length) ? prev.assigneeIds : it.assigneeIds,
          assigneeNames: (prev.assigneeNames && prev.assigneeNames.length) ? prev.assigneeNames : it.assigneeNames,
          shootDate: prev.shootDate ?? it.shootDate,
          shootTime: prev.shootTime ?? it.shootTime,
          shootLocation: prev.shootLocation ?? it.shootLocation,
        } : it;
      });
      await this.repo.update(existing.id, { items: merged, title });
    } else {
      // Рилсы → «Организация» (нужен организационный момент: дата/место съёмки).
      // Макеты → сразу «Дизайн» (организация не нужна, сразу выбор дизайнера).
      const initialStage = kind === 'macros' ? 'design' : 'organization';
      const [{ max }] = await this.repo.manager.query(
        `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = $2`,
        [projectId, initialStage],
      );
      await this.repo.save(this.repo.create({
        projectId, kind, title, stage: initialStage,
        position: Number(max) + 1, createdById: viewer.id, status: 'active', items,
      }));
    }
  }

  /** Обновление элементов групповой карточки (заполнение полей на этапах). */
  async updateItems(cardId: string, items: any[], viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanManage(viewer);
    const list = Array.isArray(items) ? items : [];
    const prevById = new Map((card.items || []).map((it: any) => [it.id, it]));
    await this.repo.update(cardId, { items: list });
    // Email/TG/in-app ВСЕМ вновь назначенным исполнителям элементов
    // (поддержка нескольких видеографов: диф по assigneeIds).
    const actor = await this.loadActor(viewer.id);
    const idsOf = (it: any): string[] =>
      (it?.assigneeIds && it.assigneeIds.length) ? it.assigneeIds.filter(Boolean)
        : (it?.assigneeId ? [it.assigneeId] : []);
    for (const it of list) {
      const prev: any = prevById.get(it.id);
      const prevIds = idsOf(prev);
      const added = idsOf(it).filter(id => !prevIds.includes(id));
      if (added.length) {
        await this.notifyAssigned(added, {
          title: it.title || card.title, projectId: card.projectId, type: card.kind,
          description: it.description, publishDate: it.publishDate,
          shootDate: it.shootDate, shootTime: it.shootTime, shootLocation: it.shootLocation,
        }, actor.name);
      }
    }
    this.broadcast(card.projectId);
    return this.repo.findOne({ where: { id: cardId }, relations: ['assignee', 'createdBy'] }).then(c => this.toDto(c!));
  }

  /** Карточки текущего исполнителя — для кабинета сотрудника. Одиночные, где
   *  он assignee, + групповые, где он назначен среди элементов. */
  async myCards(viewer: Viewer) {
    const uid = viewer.id;
    const cards = await this.repo.find({
      relations: ['assignee', 'createdBy'],
      order: { stage: 'ASC', position: 'ASC', createdAt: 'ASC' },
    });
    const mine = cards.filter(c => this.isAssignee(c, uid));
    if (mine.length === 0) return [];
    const projects = await this.projectRepo.find({ where: { id: In([...new Set(mine.map(c => c.projectId))]) } });
    const nameMap = new Map(projects.map(p => [p.id, p.name]));
    return mine.map(c => ({
      ...this.toDto(c),
      project: { id: c.projectId, name: nameMap.get(c.projectId) || '' },
    }));
  }

  async update(id: string, dto: any, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanManage(viewer);
    const patch: Partial<WorkflowCard> = {};
    if (dto.title !== undefined) {
      const t = String(dto.title || '').trim();
      if (!t) throw new BadRequestException('Заголовок обязателен');
      patch.title = t.slice(0, 300);
    }
    if (dto.description !== undefined) patch.description = dto.description ? String(dto.description).slice(0, 5000) : null;
    if (dto.contentType !== undefined) patch.contentType = dto.contentType ? String(dto.contentType).slice(0, 30) : null;
    if (dto.deadline !== undefined) patch.deadline = dto.deadline || null;
    if (dto.publishDate !== undefined) patch.publishDate = dto.publishDate || null;
    if (dto.type !== undefined && (dto.type === 'reels' || dto.type === 'static')) patch.type = dto.type;
    if (dto.needsCover !== undefined) patch.needsCover = !!dto.needsCover;
    if (dto.needsIntro !== undefined) patch.needsIntro = !!dto.needsIntro;
    const assigneeChanged = dto.assigneeId !== undefined && (dto.assigneeId || null) !== card.assigneeId;
    if (dto.assigneeId !== undefined) patch.assigneeId = dto.assigneeId || null;
    await this.repo.update(id, patch);
    // R15: уведомление при назначении исполнителя — in-app + Telegram + Email.
    if (assigneeChanged && patch.assigneeId) {
      const actor = await this.loadActor(viewer.id);
      await this.logEvent(id, 'assign', { actor, message: `Назначен исполнитель`, meta: { assigneeId: patch.assigneeId } });
      const m: any = { ...card, ...patch };
      await this.notifyAssigned([patch.assigneeId], {
        title: m.title, projectId: m.projectId, type: m.type,
        description: m.description, deadline: m.deadline, publishDate: m.publishDate,
        shootDate: m.shootDate, shootTime: m.shootTime, shootLocation: m.shootLocation,
      }, actor.name);
    }
    this.broadcast(card.projectId);
    return this.repo.findOne({ where: { id }, relations: ['assignee', 'createdBy'] })
      .then(c => this.toDto(c!));
  }

  async move(id: string, dto: { stage?: string; position?: number }, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanManage(viewer);

    const targetStage = dto.stage && WORKFLOW_STAGES.includes(dto.stage as any)
      ? dto.stage
      : card.stage;

    // ТЗ §10/§14: свободный drag разрешён только внутри колонки (reorder)
    // и в «Реклама». Прочие межэтапные переходы — только через transition()
    // (с проверкой роли и обязательных полей). Блокируем обход через API.
    const enteringAds = targetStage === 'ads' && card.stage !== 'ads';
    if (targetStage !== card.stage && targetStage !== 'ads') {
      throw new BadRequestException('Переходы между этапами выполняются через действия в карточке');
    }
    // В «Рекламу» можно перенести только опубликованную/готовую к публикации
    // карточку (ТЗ §9.9: вход из PUBLISHED или READY_TO_PUBLISH).
    if (enteringAds && !['published', 'ready_to_publish'].includes(card.stage)) {
      throw new BadRequestException('В «Рекламу» можно перенести только опубликованную или готовую к публикации карточку');
    }

    const siblings = await this.repo.find({
      where: { projectId: card.projectId, stage: targetStage },
      order: { position: 'ASC', createdAt: 'ASC' },
    }).then(list => list.filter(c => c.id !== id));

    const rawPos = dto.position;
    const idx = rawPos === undefined || rawPos === null
      ? siblings.length
      : Math.max(0, Math.min(Number(rawPos) || 0, siblings.length));
    siblings.splice(idx, 0, card);

    await this.repo.manager.transaction(async tx => {
      for (let i = 0; i < siblings.length; i++) {
        await tx.update(WorkflowCard, siblings[i].id, {
          position: i,
          ...(siblings[i].id === id ? { stage: targetStage } : {}),
        });
      }
    });

    // B6: вход в «Рекламу» — пишем журнал. Уведомление таргетолога идёт из
    // ProjectAdsService.create() (единственный путь в «Рекламу» — форма
    // кампании), поэтому здесь notifyStageRole не дублируем.
    if (enteringAds) {
      const actor = await this.loadActor(viewer.id);
      await this.logEvent(id, 'stage_enter', {
        fromStage: card.stage, toStage: 'ads', actor, message: 'Перенос в «Реклама»',
      });
    }

    this.broadcast(card.projectId);
    return { ok: true };
  }

  async remove(id: string, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanManage(viewer);
    await this.repo.delete(id);
    // Заодно удаляем дочернюю карточку обложки рилса, если есть.
    await this.repo.delete({ parentCardId: id });
    this.broadcast(card.projectId);
    return { ok: true };
  }

  // ─── Движок переходов (ТЗ §10) ────────────────────────────────────────

  /** Единая точка переходов: POST /workflow/:id/transition { action, payload }.
   *  Проверяет права, обязательные поля, выполняет побочные эффекты,
   *  пишет UnitEvent, шлёт уведомления. */
  async transition(id: string, action: string, payload: any, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    await this.assertCanAccessCard(card, viewer);
    const actor = await this.loadActor(viewer.id);
    // org_confirm проверяется по роли ТЕКУЩЕГО этапа (этап меняется), остальные —
    // по фиксированной карте действий.
    if (action === 'org_confirm') this.assertStageRole(card.stage, actor);
    else this.assertCanAct(action, actor);

    switch (action) {
      case 'confirm_plan':        await this.confirmPlan(card, payload, actor); break;
      case 'org_confirm':         await this.orgConfirm(card, actor); break;
      case 'confirm_shoot':       await this.confirmShoot(card, payload, actor); break;
      case 'assign_videographer': await this.assignVideographer(card, payload, actor); break;
      case 'shoot_done':          await this.shootDone(card, payload, actor); break;
      case 'editing_done':        await this.editingDone(card, payload, actor); break;
      case 'cover_done':          await this.coverDone(card, payload, actor); break;
      case 'layout_done':         await this.layoutDone(card, payload, actor); break;
      case 'qa_accept':           await this.qaAccept(card, actor); break;
      case 'qa_rework':           await this.qaRework(card, payload, actor); break;
      case 'mark_sent_to_client': await this.markSentToClient(card, actor); break;
      case 'client_approve':      await this.clientApprove(card, actor); break;
      case 'client_revisions':    await this.clientRevisions(card, payload, actor); break;
      case 'publish':             await this.publish(card, payload, actor); break;
      default: throw new BadRequestException(`Неизвестное действие: ${action}`);
    }

    this.broadcast(card.projectId);
    return this.repo.findOne({ where: { id }, relations: ['assignee', 'createdBy'] }).then(c => this.toDto(c!));
  }

  // R1/R2: «Подтвердить план»
  private async confirmPlan(card: WorkflowCard, _payload: any, actor: Actor) {
    if (card.stage !== 'content_plan') throw new BadRequestException('Подтвердить план можно только из Контент-плана');
    const type = card.type || (card.contentType === 'reel' ? 'reels' : 'static');
    const offsets = await this.getDeadlineOffsets();
    const deadlines = card.publishDate ? this.computeStageDeadlines(card.publishDate, type, offsets) : null;
    await this.repo.update(card.id, { type, stageDeadlines: deadlines, status: 'active' });
    card.type = type as any;
    card.stageDeadlines = deadlines;

    if (type === 'static') {
      // R1 → сразу в Дизайн.
      await this.moveToStage(card, 'design', actor, { message: 'План подтверждён → Дизайн' });
    } else {
      // R2 → Организация. Карточку обложки создаём только если рилсу нужна
      // обложка/заставка; иначе ветка дизайна считается готовой сразу
      // (join-гейт зависит только от монтажа).
      await this.moveToStage(card, 'organization', actor, { message: 'План подтверждён → Организация' });
      if (card.needsCover || card.needsIntro) {
        await this.createCoverCard(card, actor);
      } else {
        await this.repo.update(card.id, { designDone: true });
      }
    }
  }

  /** Создаёт под-карточку «Обложка/заставка» рилса в колонке Дизайн. */
  private async createCoverCard(reel: WorkflowCard, actor: Actor) {
    const [{ max }] = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = 'design'`,
      [reel.projectId],
    );
    const cover = this.repo.create({
      projectId: reel.projectId,
      title: `Обложка/заставка: ${reel.title}`,
      type: 'cover',
      parentCardId: reel.id,
      stage: 'design',
      position: Number(max) + 1,
      status: 'active',
      needsCover: true,
      needsIntro: reel.needsIntro,
      publishDate: reel.publishDate,
      deadline: reel.stageDeadlines?.design || reel.deadline || null,
      createdById: actor.id,
    });
    const saved = await this.repo.save(cover);
    await this.logEvent(saved.id, 'stage_enter', { toStage: 'design', actor, message: 'Создана карточка обложки/заставки' });
    await this.notifyStageRole(reel.projectId, 'design', `🎨 Обложка/заставка: ${reel.title}`, 'Создана карточка обложки/заставки рилса');
  }

  // Групповая «Готово» (все элементы вместе) → следующий этап маршрута группы.
  private async orgConfirm(card: WorkflowCard, actor: Actor) {
    const next = GROUP_NEXT[card.kind || '']?.[card.stage];
    if (!next) throw new BadRequestException('Нет следующего этапа для этой карточки');
    await this.moveToStage(card, next, actor, { message: `Группа → ${STAGE_LABELS[next] || next}` });
  }

  /** Вынести ОДИН элемент группы как самостоятельную карточку на следующий
   *  этап маршрута (зависит от текущего этапа группы). Остальные остаются в
   *  группе; если группа опустела — удаляем. Так элемент идёт независимо. */
  async advanceItem(cardId: string, itemId: string, viewer: Viewer) {
    const card = await this.repo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Карточка не найдена');
    if (card.kind !== 'reels' && card.kind !== 'macros') throw new BadRequestException('Не групповая карточка');
    await this.assertCanAccessCard(card, viewer);
    const actor = await this.loadActor(viewer.id);
    this.assertStageRole(card.stage, actor);
    const next = GROUP_NEXT[card.kind]?.[card.stage];
    if (!next) throw new BadRequestException('Нет следующего этапа');
    const items = card.items || [];
    const item = items.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('Элемент не найден');
    await this.spawnIndividualCard(card, item, next, actor);
    const rest = items.filter((i: any) => i.id !== itemId);
    if (rest.length === 0) await this.repo.delete(card.id);
    else await this.repo.update(card.id, { items: rest });
    this.broadcast(card.projectId);
    return { ok: true, remaining: rest.length };
  }

  /** Создаёт отдельную карточку из элемента группы на заданном этапе. */
  private async spawnIndividualCard(group: WorkflowCard, item: any, stage: string, actor: Actor) {
    const isReel = group.kind === 'reels';
    const type = isReel ? 'reels' : 'static';
    const offsets = await this.getDeadlineOffsets();
    const deadlines = item.publishDate ? this.computeStageDeadlines(item.publishDate, type, offsets) : null;
    const [{ max }] = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = $2`,
      [group.projectId, stage],
    );
    // Несколько исполнителей (видеографов): переносим всех; assigneeId —
    // основной (первый) для аватара/совместимости.
    const assigneeIds: string[] = (item.assigneeIds && item.assigneeIds.length)
      ? item.assigneeIds.filter(Boolean)
      : (item.assigneeId ? [item.assigneeId] : []);
    const saved = await this.repo.save(this.repo.create({
      projectId: group.projectId,
      title: item.title || (isReel ? 'Reels' : 'Макет'),
      description: item.description || null,
      contentType: isReel ? 'reel' : 'design',
      type,
      stage,
      position: Number(max) + 1,
      status: 'active',
      publishDate: item.publishDate || null,
      deadline: deadlines?.[stage] || null,
      stageDeadlines: deadlines,
      assigneeId: assigneeIds[0] || null,
      assigneeIds: assigneeIds.length ? assigneeIds : null,
      shootDate: item.shootDate || null,
      shootTime: item.shootTime || null,
      shootLocation: item.shootLocation || null,
      // Новая модель без отдельной обложки: ветка дизайна считается готовой,
      // join-гейт для рилса зависит только от монтажа.
      needsCover: false,
      needsIntro: false,
      designDone: true,
      createdById: group.createdById || actor.id,
    }));
    await this.logEvent(saved.id, 'stage_enter', { toStage: stage, actor, message: `Из контент-плана → ${STAGE_LABELS[stage] || stage}` });
    await this.notifyStageRole(group.projectId, stage, `➡️ ${STAGE_LABELS[stage] || stage}`, `«${saved.title}» на этапе «${STAGE_LABELS[stage] || stage}»`);
    if (assigneeIds.length) await this.notifyAssigned(assigneeIds, {
      title: saved.title, projectId: group.projectId, type: saved.type,
      description: saved.description, deadline: saved.deadline, publishDate: saved.publishDate,
      shootDate: saved.shootDate, shootTime: saved.shootTime, shootLocation: saved.shootLocation,
    }, actor.name);
  }

  // R3: «Подтвердить съёмку» (Организация → Съёмка)
  private async confirmShoot(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'organization') throw new BadRequestException('Доступно только на этапе Организация');
    const shootDate = payload?.shootDate || card.shootDate;
    if (!shootDate) throw new BadRequestException('Укажите дату съёмки');
    await this.repo.update(card.id, {
      shootDate,
      shootTime: payload?.shootTime ?? card.shootTime ?? null,
      shootLocation: payload?.shootLocation ?? card.shootLocation ?? null,
    });
    card.shootDate = shootDate;
    await this.moveToStage(card, 'shooting', actor, { message: `Съёмка назначена на ${shootDate}` });
  }

  // R4: назначение видеографа (без смены этапа)
  private async assignVideographer(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'shooting') throw new BadRequestException('Доступно только на этапе Съёмка');
    const assigneeId = payload?.assigneeId;
    if (!assigneeId) throw new BadRequestException('Выберите видеографа');
    await this.repo.update(card.id, { assigneeId });
    await this.logEvent(card.id, 'assign', { actor, message: 'Назначен видеограф', meta: { assigneeId } });
    await this.notify([assigneeId], '🎥 Съёмка', `Вам назначена съёмка: «${card.title}»`, card.projectId);
  }

  // R5: «Съёмка завершена» (Съёмка → Монтаж). Ссылка на исходники — необязательна.
  private async shootDone(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'shooting') throw new BadRequestException('Доступно только на этапе Съёмка');
    const rawFootageUrl = payload?.rawFootageUrl || card.rawFootageUrl;
    if (rawFootageUrl) {
      await this.repo.update(card.id, { rawFootageUrl });
      card.rawFootageUrl = rawFootageUrl;
    }
    await this.moveToStage(card, 'editing', actor, { message: 'Съёмка завершена → Монтаж' });
  }

  // R6: «Монтаж готов» → editingDone + join-гейт. Ссылка на монтаж — необязательна.
  private async editingDone(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'editing') throw new BadRequestException('Доступно только на этапе Монтаж');
    const finalCutUrl = payload?.finalCutUrl || card.finalCutUrl;
    await this.repo.update(card.id, { finalCutUrl: finalCutUrl || null, editingDone: true });
    card.finalCutUrl = finalCutUrl;
    card.editingDone = true;
    await this.logEvent(card.id, 'editing_done', { actor, message: 'Монтаж готов' });
    await this.runJoinCheck(card.id, actor);
  }

  // R7: обложка/заставка «Готово» (карточка type='cover') → designDone у родителя
  private async coverDone(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.type !== 'cover') throw new BadRequestException('Это действие — для карточки обложки/заставки');
    const coverUrl = payload?.coverUrl || card.coverUrl;
    if (!coverUrl) throw new BadRequestException('Прикрепите ссылку на обложку');
    const introUrl = payload?.introUrl || card.introUrl;
    if (card.needsIntro && !introUrl) throw new BadRequestException('Прикрепите ссылку на заставку (intro)');
    await this.repo.update(card.id, { coverUrl, introUrl: introUrl || null, status: 'done' });
    await this.logEvent(card.id, 'cover_done', { actor, message: 'Обложка/заставка готова' });
    if (card.parentCardId) {
      await this.repo.update(card.parentCardId, { designDone: true });
      await this.runJoinCheck(card.parentCardId, actor);
    }
  }

  // R8: «Макет готов» (static) → Внутренняя проверка
  private async layoutDone(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'design' || card.type === 'cover') throw new BadRequestException('Доступно только для макета на этапе Дизайн');
    const finalAssetUrl = payload?.finalAssetUrl || card.finalAssetUrl;
    if (!finalAssetUrl) throw new BadRequestException('Прикрепите ссылку на макет');
    await this.repo.update(card.id, { finalAssetUrl, designDone: true });
    card.finalAssetUrl = finalAssetUrl;
    await this.moveToStage(card, 'internal_review', actor, { message: 'Макет готов → Внутренняя проверка' });
  }

  /** Join-гейт (ТЗ §8): когда готовы и монтаж, и обложка — рилс уходит
   *  на Внутреннюю проверку. Иначе «ждёт обложку» и стоит в Монтаже. */
  private async runJoinCheck(reelId: string, actor: Actor) {
    const reel = await this.repo.findOne({ where: { id: reelId } });
    if (!reel) return;
    if (reel.editingDone && reel.designDone) {
      await this.repo.update(reel.id, { status: 'active' });
      reel.status = 'active';
      await this.moveToStage(reel, 'internal_review', actor, { message: 'Монтаж и обложка готовы → Внутренняя проверка' });
    } else if (reel.editingDone && !reel.designDone) {
      await this.repo.update(reel.id, { status: 'waiting_cover' });
      await this.logEvent(reel.id, 'waiting_cover', { actor, message: 'Ждёт обложку/заставку' });
    }
  }

  // R9: QA «Принято» → Согласование
  private async qaAccept(card: WorkflowCard, actor: Actor) {
    if (card.stage !== 'internal_review') throw new BadRequestException('Доступно только на Внутренней проверке');
    await this.repo.update(card.id, { status: 'active' });
    await this.moveToStage(card, 'client_approval', actor, { message: 'Принято QA → Согласование с клиентом' });
  }

  // R10: QA «На доработку» → возврат на ответственный этап
  private async qaRework(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'internal_review') throw new BadRequestException('Доступно только на Внутренней проверке');
    const comment = String(payload?.comment || '').trim();
    if (!comment) throw new BadRequestException('Комментарий обязателен');
    const isReels = this.isReelsCard(card);
    const back = isReels ? 'editing' : 'design';
    const reset = isReels ? { editingDone: false } : { designDone: false };
    await this.repo.update(card.id, { status: 'rework', reworkComment: comment, ...reset });
    card.status = 'rework';
    await this.logEvent(card.id, 'qa_rework', { actor, message: 'На доработку (QA)', comment });
    await this.moveToStage(card, back, actor, { message: `На доработку: ${comment}` });
  }

  // «Отправлено клиенту» — фиксируем время (без смены этапа)
  private async markSentToClient(card: WorkflowCard, actor: Actor) {
    if (card.stage !== 'client_approval') throw new BadRequestException('Доступно только на Согласовании');
    await this.repo.update(card.id, { sentToClientAt: new Date() });
    await this.logEvent(card.id, 'sent_to_client', { actor, message: 'Отправлено клиенту' });
  }

  // R11: «Клиент согласовал» → Готово к публикации
  private async clientApprove(card: WorkflowCard, actor: Actor) {
    if (card.stage !== 'client_approval') throw new BadRequestException('Доступно только на Согласовании');
    await this.repo.update(card.id, { status: 'active' });
    await this.moveToStage(card, 'ready_to_publish', actor, { message: 'Клиент согласовал → Готово к публикации' });
  }

  // R12: «Правки клиента» → возврат на ответственный этап
  private async clientRevisions(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'client_approval') throw new BadRequestException('Доступно только на Согласовании');
    const comment = String(payload?.comment || '').trim();
    if (!comment) throw new BadRequestException('Комментарий обязателен');
    const isReels = this.isReelsCard(card);
    const back = isReels ? 'editing' : 'design';
    const reset = isReels ? { editingDone: false } : { designDone: false };
    await this.repo.update(card.id, { status: 'rework', clientComment: comment, ...reset });
    await this.logEvent(card.id, 'client_revisions', { actor, message: 'Правки клиента', comment });
    await this.moveToStage(card, back, actor, { message: `Правки клиента: ${comment}` });
  }

  /** Рилс ли это (с учётом легаси-карточек без type, но с contentType='reel'). */
  private isReelsCard(card: WorkflowCard): boolean {
    return card.type === 'reels' || (card.type == null && card.contentType === 'reel');
  }

  // R13: «Опубликовано» → Опубликовано
  private async publish(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'ready_to_publish') throw new BadRequestException('Доступно только на «Готово к публикации»');
    const publishedUrl = payload?.publishedUrl || card.publishedUrl;
    if (!publishedUrl) throw new BadRequestException('Прикрепите ссылку на публикацию');
    const now = new Date();
    await this.repo.update(card.id, { publishedUrl, publishedAt: now, status: 'published' });
    card.publishedUrl = publishedUrl;
    await this.moveToStage(card, 'published', actor, { message: 'Опубликовано' });
  }

  // ─── Вспомогательное ──────────────────────────────────────────────────

  /** Перенос карточки на этап: ставит в конец колонки, обновляет дедлайн
   *  по stageDeadlines, пишет журнал и шлёт уведомление роли этапа. */
  private async moveToStage(card: WorkflowCard, newStage: string, actor: Actor, opts: { message?: string } = {}) {
    const [{ max }] = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = $2`,
      [card.projectId, newStage],
    );
    const deadline = card.stageDeadlines?.[newStage] || card.deadline || null;
    const fromStage = card.stage;
    await this.repo.update(card.id, { stage: newStage, position: Number(max) + 1, deadline });
    await this.logEvent(card.id, 'stage_enter', {
      fromStage, toStage: newStage, actor,
      message: opts.message || `Этап: ${STAGE_LABELS[newStage] || newStage}`,
    });
    // R15: уведомление роли нового этапа + текущему исполнителю.
    await this.notifyStageRole(card.projectId, newStage, `➡️ ${STAGE_LABELS[newStage] || newStage}`, `Карточка «${card.title}» на этапе «${STAGE_LABELS[newStage] || newStage}»`);
    if (card.assigneeId) {
      await this.notify([card.assigneeId], `➡️ ${STAGE_LABELS[newStage] || newStage}`, `Карточка «${card.title}» перешла на новый этап`, card.projectId);
    }
  }

  private async logEvent(cardId: string, action: string, data: {
    fromStage?: string | null; toStage?: string | null; actor?: Actor;
    message?: string; comment?: string; meta?: Record<string, any>;
  }) {
    try {
      await this.eventRepo.save(this.eventRepo.create({
        cardId,
        action,
        fromStage: data.fromStage ?? null,
        toStage: data.toStage ?? null,
        actorId: data.actor?.id ?? null,
        actorName: data.actor?.name ?? null,
        message: data.message ?? null,
        comment: data.comment ?? null,
        meta: data.meta ?? null,
      }));
    } catch (e: any) {
      this.logger.warn(`logEvent failed: ${e?.message || e}`);
    }
  }

  /** Уведомить пользователей проекта с ролью-владельцем этапа. */
  private async notifyStageRole(projectId: string, stage: string, title: string, message: string) {
    const roles = STAGE_ROLES[stage] || [];
    if (roles.length === 0) return;
    const ids = await this.findProjectUsersByRole(projectId, roles);
    await this.notify(ids, title, message, projectId);
  }

  /** Все активные пользователи с одной из ролей (основной или второй) —
   *  для выпадающих списков исполнителей на доске (видеографы/дизайнеры). */
  async assignees(roles: string[]) {
    const clean = (roles || []).filter(Boolean);
    if (clean.length === 0) return [];
    return this.userRepo.manager.query(
      `SELECT id, name, role, "secondaryRole" AS "secondaryRole", avatar
       FROM users
       WHERE "isActive" = true AND "isBlocked" = false
         AND (role = ANY($1) OR "secondaryRole" = ANY($1))
       ORDER BY name ASC`,
      [clean],
    );
  }

  /** Активные пользователи проекта (участник или менеджер) с одной из ролей. */
  private async findProjectUsersByRole(projectId: string, roles: string[]): Promise<string[]> {
    const rows = await this.userRepo.manager.query(
      `SELECT u.id FROM users u
       WHERE u."isActive" = true AND u."isBlocked" = false
         AND (u.role = ANY($2) OR u."secondaryRole" = ANY($2))
         AND (
           EXISTS (SELECT 1 FROM project_members pm WHERE pm."projectsId" = $1 AND pm."usersId" = u.id)
           OR EXISTS (SELECT 1 FROM projects p WHERE p.id = $1 AND p."managerId" = u.id)
         )`,
      [projectId, roles],
    );
    return rows.map((r: any) => r.id);
  }

  /** Уведомление в приложении (колокол) + Telegram (ТЗ §6 R15). */
  private async notify(userIds: string[], title: string, message: string, projectId: string) {
    const unique = [...new Set(userIds.filter(Boolean))];
    for (const uid of unique) {
      await this.notifications.create({
        userId: uid,
        type: NotificationType.STATUS_CHANGE,
        title,
        message,
        link: '/workflow-board',
      } as any).catch(() => {});
      this.telegram.sendToUser(uid, `<b>${title}</b>\n${message}`).catch(() => {});
    }
  }

  /** Уведомление о НАЗНАЧЕНИИ на карточку — 3 канала (in-app + Telegram +
   *  Email) с ПОЛНЫМИ данными карточки: тип, проект, дедлайн, дата публикации,
   *  съёмка, описание. Email — только при назначении (не на каждом переходе). */
  private async notifyAssigned(
    userIds: string[],
    details: {
      title: string;
      projectId: string;
      type?: string | null;
      description?: string | null;
      deadline?: string | null;
      publishDate?: string | null;
      shootDate?: string | null;
      shootTime?: string | null;
      shootLocation?: string | null;
    },
    actorName?: string,
  ) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;
    const project = await this.projectRepo.findOne({ where: { id: details.projectId } }).catch(() => null);
    const projectName = project?.name || 'проект';

    const fmtDate = (d?: string | null) => {
      if (!d) return '';
      const s = String(d).slice(0, 10);
      const [y, m, day] = s.split('-');
      return (y && m && day) ? `${day}.${m}.${y}` : s;
    };
    const typeLabel = details.type === 'reels' ? 'Рилс'
      : (details.type === 'static' || details.type === 'macros') ? 'Макет' : null;
    const deadline = fmtDate(details.deadline);
    const publishDate = fmtDate(details.publishDate);
    const shootDate = fmtDate(details.shootDate);
    const shoot = shootDate
      ? `${shootDate}${details.shootTime ? `, ${details.shootTime}` : ''}${details.shootLocation ? ` · ${details.shootLocation}` : ''}`
      : '';

    const title = '🎬 Вам назначена карточка';

    // CRM-колокольчик — сводка ключевых полей.
    const lines = [
      typeLabel ? `${typeLabel}: ${details.title}` : details.title,
      `Проект: ${projectName}`,
      deadline ? `Дедлайн: ${deadline}` : '',
      publishDate ? `Публикация: ${publishDate}` : '',
      shoot ? `Съёмка: ${shoot}` : '',
      details.description ? `Описание: ${details.description}` : '',
    ].filter(Boolean);
    const message = lines.join('\n');

    // Telegram — подробное сообщение.
    const tg = [
      `<b>${title}</b>`,
      `📌 <b>${details.title}</b>${typeLabel ? ` (${typeLabel})` : ''}`,
      `📁 Проект: ${projectName}`,
      deadline ? `📅 Дедлайн: ${deadline}` : '',
      publishDate ? `🗓 Публикация: ${publishDate}` : '',
      shoot ? `🎥 Съёмка: ${shoot}` : '',
      details.description ? `📝 ${details.description}` : '',
      actorName ? `👤 Назначил: ${actorName}` : '',
    ].filter(Boolean).join('\n');

    for (const uid of unique) {
      await this.notifications.create({
        userId: uid,
        type: NotificationType.STATUS_CHANGE,
        title,
        message,
        link: '/workflow-board',
      } as any).catch(() => {});
      this.telegram.sendToUser(uid, tg).catch(() => {});
      const u = await this.userRepo.findOne({ where: { id: uid } }).catch(() => null);
      if (u?.email) {
        this.mail.sendCardAssigned(u.email, u.name || 'Сотрудник', {
          title: details.title,
          projectName,
          typeLabel,
          description: details.description || null,
          deadline: deadline || null,
          publishDate: publishDate || null,
          shoot: shoot || null,
          assignedBy: actorName || null,
        }).catch(() => {});
      }
    }
  }

  /** Дедлайны этапов от publishDate (ТЗ §11). */
  private computeStageDeadlines(
    publishDate: string,
    type: string,
    offsetsAll: Record<string, Record<string, number>> = DEADLINE_OFFSETS,
  ): Record<string, string> {
    const offsets = offsetsAll[type] || offsetsAll.static || DEADLINE_OFFSETS.static;
    const out: Record<string, string> = {};
    for (const [stage, days] of Object.entries(offsets)) {
      out[stage] = this.dateMinusDays(publishDate, days);
    }
    return out;
  }

  private dateMinusDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
