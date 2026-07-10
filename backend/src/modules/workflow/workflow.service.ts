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
import { hasGrant } from '../auth/permissions';

interface Viewer { id: string; role: string }
interface Actor { id: string; name: string; role: string; secondaryRole: string | null; extraPermissions?: string[] | null }

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

/** Через сколько дней после публикации карточка уходит с доски в «Историю». */
const ARCHIVE_AFTER_DAYS = 6;

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
        `ADD COLUMN IF NOT EXISTS "editorIds" jsonb`,
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
        -- KPI считает закрытые этапы по автору события за период.
        CREATE INDEX IF NOT EXISTS idx_unit_events_actor ON unit_events ("actorId", "createdAt");
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
   *  роли (основную и вторую) + персональный грант content-plan.manage. */
  private async assertCanManage(viewer: Viewer): Promise<void> {
    if (MANAGE_ROLES.includes(viewer.role)) return;
    const u = await this.userRepo.findOne({ where: { id: viewer.id } });
    if (u?.secondaryRole && MANAGE_ROLES.includes(u.secondaryRole)) return;
    // Персональный доступ «Контент-план» — выдаётся на странице «Доступы сотрудников».
    if (hasGrant({ role: viewer.role, secondaryRole: u?.secondaryRole, extraPermissions: u?.extraPermissions }, 'content-plan.manage')) return;
    throw new ForbiddenException('Изменять доску может только руководитель SMM или организатор');
  }

  /** Доступ к карточке для статус-действий: ADMIN-уровень, исполнитель самой
   *  карточки (в т.ч. среди элементов группы), управляющие роли или
   *  участник/менеджер проекта. Сами права на действие проверяет
   *  assertCanAct / assertStageRole. */
  private async assertCanAccessCard(card: WorkflowCard, viewer: Viewer): Promise<void> {
    if (PRIVILEGED.includes(viewer.role) || MANAGE_ROLES.includes(viewer.role)) return;
    if (this.isAssignee(card, viewer.id)) return;
    // Персональный грант «полное управление доской» — доступ к любой карточке.
    const u = await this.userRepo.findOne({ where: { id: viewer.id } });
    if (hasGrant({ role: viewer.role, secondaryRole: u?.secondaryRole, extraPermissions: u?.extraPermissions }, 'content-plan.manage')) return;
    await this.assertCanEdit(card.projectId, viewer);
  }

  /** Является ли пользователь исполнителем карточки — учитывая нескольких
   *  исполнителей (assigneeIds), заранее назначенных монтажёров (editorIds —
   *  чтобы карточка была в кабинете монтажёра ещё на «Съёмке») и назначения
   *  внутри элементов группы. */
  private isAssignee(card: WorkflowCard, uid: string): boolean {
    if (card.assigneeId === uid) return true;
    if (Array.isArray(card.assigneeIds) && card.assigneeIds.includes(uid)) return true;
    if (Array.isArray(card.editorIds) && card.editorIds.includes(uid)) return true;
    const items = (card.items || []) as any[];
    if (Array.isArray(items)) {
      return items.some(it =>
        it?.assigneeId === uid ||
        (Array.isArray(it?.assigneeIds) && it.assigneeIds.includes(uid)) ||
        (Array.isArray(it?.editorIds) && it.editorIds.includes(uid)));
    }
    return false;
  }

  /** Карточка в «Истории» (архиве): прошла все этапы (Опубликовано) и с момента
   *  публикации прошло ≥ ARCHIVE_AFTER_DAYS дней. Такие убираем с доски —
   *  они доступны только в разделе «История». Считаем на лету (без отдельной
   *  колонки/крона — не рассинхронизируется). */
  private isArchivedCard(c: { stage?: string | null; publishedAt?: Date | string | null }): boolean {
    if (c.stage !== 'published' || !c.publishedAt) return false;
    const t = new Date(c.publishedAt).getTime();
    if (!Number.isFinite(t)) return false;
    return Date.now() - t >= ARCHIVE_AFTER_DAYS * 86400000;
  }

  /** Загружает актёра с обеими ролями и именем (для RBAC и журнала). */
  private async loadActor(userId: string): Promise<Actor> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    return {
      id: userId,
      name: u?.name || 'Сотрудник',
      role: u?.role || '',
      secondaryRole: u?.secondaryRole || null,
      extraPermissions: u?.extraPermissions || null,
    };
  }

  /** Руководитель производства (admin/founder/co_founder/smm_director/
   *  organizer) ЛИБО сотрудник с персональным грантом «полное управление
   *  доской» — может выполнять действие любого этапа (все статусы). */
  private isManager(actor: Actor): boolean {
    return MANAGE_ROLES.includes(actor.role)
      || (!!actor.secondaryRole && MANAGE_ROLES.includes(actor.secondaryRole))
      || hasGrant(actor, 'content-plan.manage');
  }

  /** RBAC действия выхода этапа (ТЗ §12). */
  private assertCanAct(action: string, actor: Actor) {
    if (this.isManager(actor)) return;
    const allowed = ACTION_ROLES[action] || [];
    if (allowed.includes(actor.role)) return;
    if (actor.secondaryRole && allowed.includes(actor.secondaryRole)) return;
    throw new ForbiddenException('У вас нет прав на это действие для текущего этапа');
  }

  /** RBAC по роли-владельцу ТЕКУЩЕГО этапа (для групповых действий, где этап
   *  меняется: организатор на «Организации», дизайнер на «Дизайне» и т.д.). */
  private assertStageRole(stage: string, actor: Actor) {
    if (this.isManager(actor)) return;
    const roles = STAGE_ROLES[stage] || [];
    if (roles.includes(actor.role)) return;
    if (actor.secondaryRole && roles.includes(actor.secondaryRole)) return;
    throw new ForbiddenException('Нет прав для действия на этом этапе');
  }

  private broadcast(projectId: string) {
    try { this.gateway.broadcast('workflow:changed', { projectId }); } catch { /* best-effort */ }
    // Прогресс SMM-проекта считается по доске — пересчитываем при любой
    // мутации (fire-and-forget, не блокируем ответ).
    if (projectId) this.recomputeProjectProgress(projectId).catch(() => {});
  }

  /** Прогресс проекта = доля «единиц контента», дошедших до публикации.
   *  Единица = одиночная карточка (kind=null, кроме обложек) ИЛИ элемент
   *  группы (items в Рилсы/Макеты). КП-карточка и обложки не считаются.
   *  Готово = одиночная карточка на этапе published. */
  private async recomputeProjectProgress(projectId: string): Promise<void> {
    try {
      const cards = await this.repo.find({ where: { projectId } });
      let total = 0;
      let done = 0;
      for (const c of cards) {
        if (c.kind === 'reels' || c.kind === 'macros') {
          total += Array.isArray(c.items) ? c.items.length : 0;
        } else if (c.kind === 'kp' || c.type === 'cover') {
          // КП-инструкция и карточки обложки/заставки — не единицы контента.
          continue;
        } else {
          total += 1;
          if (c.stage === 'published') done += 1;
        }
      }
      const progress = total > 0 ? Math.round((done / total) * 100) : 0;
      await this.projectRepo.update(projectId, { progress });
    } catch (e: any) {
      this.logger.warn(`recomputeProjectProgress failed: ${e?.message || e}`);
    }
  }

  // ─── Чтение ───────────────────────────────────────────────────────────

  /** Видит ли пользователь ВСЮ доску: роль из SEE_ALL (основная/вторая) ИЛИ
   *  персональный грант просмотра/полного управления доской. */
  private async canSeeWholeBoard(viewer: Viewer): Promise<boolean> {
    if (SEE_ALL.includes(viewer.role)) return true;
    const u = await this.userRepo.findOne({ where: { id: viewer.id } });
    if (u?.secondaryRole && SEE_ALL.includes(u.secondaryRole)) return true;
    const g = { role: viewer.role, secondaryRole: u?.secondaryRole, extraPermissions: u?.extraPermissions };
    return hasGrant(g, 'board.view') || hasGrant(g, 'content-plan.manage');
  }

  /** Карточки проекта в зоне видимости (полная доска или только свои) — без
   *  фильтра по архиву. База для list (доска без архива) и archiveForProject. */
  private async projectCards(projectId: string, viewer: Viewer) {
    // Полная доска проекта — участнику/менеджеру/привилегированной роли ИЛИ
    // сотруднику с грантом доски. Иначе (назначен исполнителем, но не участник) —
    // только свои карточки, чтобы назначение не упиралось в 403.
    let full = true;
    try {
      await this.assertCanEdit(projectId, viewer);
    } catch {
      full = false;
    }
    if (!full && await this.canSeeWholeBoard(viewer)) full = true;
    const cards = await this.repo.find({
      where: { projectId },
      relations: ['assignee', 'createdBy'],
      order: { stage: 'ASC', position: 'ASC', createdAt: 'ASC' },
    });
    if (full) return cards.map(c => this.toDto(c));
    const mine = cards.filter(c => this.isAssignee(c, viewer.id));
    if (mine.length === 0) throw new ForbiddenException('Нет доступа к доске этого проекта');
    return mine.map(c => this.toDto(c));
  }

  async list(projectId: string, viewer: Viewer) {
    // Доска проекта без архивных (опубликованы > ARCHIVE_AFTER_DAYS дней назад).
    return (await this.projectCards(projectId, viewer)).filter(c => !this.isArchivedCard(c));
  }

  /** «История» проекта — только архивные карточки (новые сверху). */
  async archiveForProject(projectId: string, viewer: Viewer) {
    return (await this.projectCards(projectId, viewer))
      .filter(c => this.isArchivedCard(c))
      .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
  }

  /** Все видимые карточки доски (без фильтра по архиву) — база для listAll
   *  (доска без архива) и archiveAll («История»). */
  private async visibleAllCards(viewer: Viewer) {
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
    if (!(await this.canSeeWholeBoard(viewer))) {
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

  async listAll(viewer: Viewer) {
    // Доска без архивных (опубликованы > ARCHIVE_AFTER_DAYS дней назад).
    return (await this.visibleAllCards(viewer)).filter(c => !this.isArchivedCard(c));
  }

  /** «История» по всем проектам — только архивные карточки (новые сверху). */
  async archiveAll(viewer: Viewer) {
    return (await this.visibleAllCards(viewer))
      .filter(c => this.isArchivedCard(c))
      .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
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
      editorIds: c.editorIds || null,
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
    // Несколько исполнителей: assigneeIds — список, assigneeId — основной (первый).
    // ВАЖНО: раньше create() сохранял только assigneeId и НЕ слал уведомления —
    // из-за этого назначенные при создании карточки не видели её и не получали
    // оповещений. Теперь поведение зеркалит update().
    const assigneeIds: string[] = Array.isArray(dto?.assigneeIds)
      ? dto.assigneeIds.filter(Boolean)
      : (dto?.assigneeId ? [dto.assigneeId] : []);
    const editorIds: string[] = Array.isArray(dto?.editorIds) ? dto.editorIds.filter(Boolean) : [];
    // Карточка, создаваемая НАПРЯМУЮ на этапе после «Контент-плана» (напр. сразу
    // на «Съёмке»), не проходит confirmPlan и под-карточку обложки не получает.
    // Поэтому для неё ветка дизайна сразу готова (designDone=true, needsCover=
    // false) — иначе join-гейт «ждёт обложку» заблокирует монтаж навсегда.
    const pastPlanning = stage !== 'content_plan';
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
      assigneeId: assigneeIds[0] || null,
      assigneeIds: assigneeIds.length ? assigneeIds : null,
      editorIds: editorIds.length ? editorIds : null,
      stage,
      position: Number(max) + 1,
      createdById: viewer.id,
      type,
      publishDate: dto?.publishDate || null,
      needsCover: pastPlanning ? false : (dto?.needsCover !== undefined ? !!dto.needsCover : true),
      needsIntro: pastPlanning ? false : (dto?.needsIntro !== undefined ? !!dto.needsIntro : true),
      designDone: pastPlanning,
      status: 'active',
    });
    const saved = await this.repo.save(card);
    // R15: уведомление ВСЕМ назначенным при создании — in-app + Telegram + Email.
    if (assigneeIds.length || editorIds.length) {
      const actor = await this.loadActor(viewer.id);
      const base = {
        title: saved.title, projectId, cardId: saved.id, type: saved.type,
        description: saved.description, deadline: saved.deadline, publishDate: saved.publishDate,
        shootDate: saved.shootDate, shootTime: saved.shootTime, shootLocation: saved.shootLocation,
      };
      if (assigneeIds.length) {
        await this.logEvent(saved.id, 'assign', { actor, message: 'Назначен исполнитель', meta: { assigneeIds } });
        await this.notifyAssigned(assigneeIds, base, actor.name);
      }
      // Монтажёрам, которых нет среди исполнителей (без дубля уведомления).
      const editorsOnly = editorIds.filter(id => !assigneeIds.includes(id));
      if (editorsOnly.length) {
        await this.logEvent(saved.id, 'assign', { actor, message: 'Назначен монтажёр', meta: { editorIds: editorsOnly } });
        await this.notifyAssigned(editorsOnly, { ...base, note: 'Назначены монтажёром — приступайте после съёмки.' }, actor.name);
      }
    }
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
    // Уведомляем видеографов о новой съёмке — по РОЛИ (без требования участия
    // в проекте, т.к. видеографы работают общим пулом) + заранее назначенных
    // на карточках. Иначе видеограф, не добавленный в проект, не узнаёт о съёмке.
    const preAssigned = [...new Set(
      eligible.flatMap(c => [c.assigneeId, ...((c.assigneeIds as string[]) || [])]).filter(Boolean) as string[],
    )];
    await this.notifyShootCreated(projectId, session, eligible, preAssigned, actor.name);
    this.broadcast(projectId);
    return { ok: true, sessionId: session.id, moved: eligible.length };
  }

  /** Уведомление о создании съёмки (3 канала) всем активным видеографам /
   *  руководителям видео (по роли, без требования участия в проекте) +
   *  заранее назначенным на карточках. Детали: дата/время/место, кол-во рилсов. */
  private async notifyShootCreated(
    projectId: string,
    session: { id: string; date?: string | null; time?: string | null; location?: string | null; title?: string | null },
    cards: WorkflowCard[],
    preAssigned: string[],
    actorName?: string,
  ) {
    const roleUsers: Array<{ id: string; name: string; email: string }> = await this.userRepo.query(
      `SELECT id, name, email FROM users
       WHERE "isActive" = true AND "isBlocked" = false
         AND (role IN ('videographer','video_director') OR "secondaryRole" IN ('videographer','video_director'))`,
    ).catch(() => []);
    let assignedUsers: Array<{ id: string; name: string; email: string }> = [];
    if (preAssigned.length) {
      assignedUsers = await this.userRepo.query(
        `SELECT id, name, email FROM users WHERE id = ANY($1) AND "isActive" = true AND "isBlocked" = false`,
        [preAssigned],
      ).catch(() => []);
    }
    const byId = new Map<string, { id: string; name: string; email: string }>();
    for (const u of [...roleUsers, ...assignedUsers]) byId.set(u.id, u);
    const recipients = [...byId.values()];
    if (!recipients.length) return;

    const project = await this.projectRepo.findOne({ where: { id: projectId } }).catch(() => null);
    const projectName = project?.name || 'проект';
    const fmtDate = (d?: string | null) => {
      if (!d) return '';
      const s = String(d).slice(0, 10); const [y, m, day] = s.split('-');
      return (y && m && day) ? `${day}.${m}.${y}` : s;
    };
    const when = `${fmtDate(session.date)}${session.time ? `, ${session.time}` : ''}`;
    const place = session.location ? ` · ${session.location}` : '';
    const reelsCount = cards.length;
    const titlesPreview = cards.slice(0, 5).map(c => `• ${c.title}`).join('\n')
      + (cards.length > 5 ? `\n…и ещё ${cards.length - 5}` : '');

    const title = '🎥 Новая съёмка назначена';
    const message = [
      `Проект: ${projectName}`,
      `Когда: ${when}${place}`,
      `Рилсов: ${reelsCount}`,
      actorName ? `Назначил: ${actorName}` : '',
    ].filter(Boolean).join('\n');

    const tg = [
      `<b>${title}</b>`,
      `📁 Проект: ${projectName}`,
      `🗓 Когда: <b>${when}</b>${place}`,
      `🎬 Рилсов: <b>${reelsCount}</b>`,
      titlesPreview,
      actorName ? `👤 Назначил: ${actorName}` : '',
      `\n👉 Откройте «Доску проектов», этап «Съёмка».`,
    ].filter(Boolean).join('\n');

    const emailBody =
      `Назначена <strong>новая съёмка</strong> по проекту <strong>«${projectName}»</strong>.<br><br>` +
      `🗓 Когда: <strong>${when}</strong>${session.location ? ` · ${session.location}` : ''}<br>` +
      `🎬 Рилсов: <strong>${reelsCount}</strong><br>` +
      (actorName ? `<br>Назначил: ${actorName}.` : '') +
      `<br><br>Откройте «Доску проектов» (этап «Съёмка»), чтобы приступить.`;

    for (const u of recipients) {
      await this.createInApp(u.id, title, message);
      this.telegram.sendToUser(u.id, tg, this.cardButtons(cards[0]?.id)).catch(() => {});
      if (u.email) {
        this.mail.sendGenericNotification(u.email, u.name || 'Видеограф', title, emailBody)
          .catch((e: any) => this.logger.warn(`shoot-created mail failed for ${u.id}: ${e?.message || e}`));
      }
    }
    await this.notifySupervisor(cards[0]?.id || '', null, {
      title: '🎥 Новая съёмка',
      message: `Назначена съёмка на ${when}${place} — рилсов ${reelsCount} (проект «${projectName}»)`,
    });
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
        // Монтажёры, выбранные заранее на «Съёмке» — переходят в исполнители на «Монтаже».
        editorIds: Array.isArray(it.editorIds) ? it.editorIds.filter(Boolean) : [],
        editorNames: Array.isArray(it.editorNames) ? it.editorNames.filter(Boolean) : [],
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

    // Уведомляем организаторов — ТОЛЬКО при первом создании КП (не при правке),
    // чтобы не спамить. 3 канала: in-app + Telegram + Email.
    if (!kp) {
      const actor = await this.loadActor(viewer.id);
      await this.notifyContentPlanCreated(projectId, reels.length, macros.length, actor.name);
    }

    this.broadcast(projectId);
    return { ok: true, reels: reels.length, macros: macros.length };
  }

  /** Уведомление организаторам о создании контент-плана (3 канала) с
   *  подробностями: проект, кол-во рилсов/макетов, кто создал. */
  private async notifyContentPlanCreated(projectId: string, reelsCount: number, macrosCount: number, actorName?: string) {
    const organizers: Array<{ id: string; name: string; email: string }> = await this.userRepo.query(
      `SELECT id, name, email FROM users
       WHERE "isActive" = true AND "isBlocked" = false
         AND (role = 'organizer' OR "secondaryRole" = 'organizer')`,
    ).catch(() => []);
    if (!organizers.length) return;
    const project = await this.projectRepo.findOne({ where: { id: projectId } }).catch(() => null);
    const projectName = project?.name || 'проект';

    const title = '📋 Контент-план создан — нужно организовать';
    const parts: string[] = [];
    if (reelsCount > 0) parts.push(`рилсов: ${reelsCount} (на «Организацию» — организуйте съёмки)`);
    if (macrosCount > 0) parts.push(`макетов: ${macrosCount} (на «Дизайн»)`);
    const message = `Проект «${projectName}»: создан контент-план — ${parts.join('; ')}.${actorName ? ` Создал: ${actorName}.` : ''}`;

    const tg = [
      `<b>${title}</b>`,
      `📁 Проект: ${projectName}`,
      reelsCount > 0 ? `🎬 Рилсов: <b>${reelsCount}</b> — этап «Организация»: назначьте дату/время/место съёмки и видеографов.` : '',
      macrosCount > 0 ? `🖼 Макетов: <b>${macrosCount}</b> — этап «Дизайн».` : '',
      actorName ? `👤 Создал: ${actorName}` : '',
      `\n👉 Откройте «Доску проектов» и приступите к организации.`,
    ].filter(Boolean).join('\n');

    const emailBody =
      `Создан новый <strong>контент-план</strong> по проекту <strong>«${projectName}»</strong>.<br><br>` +
      (reelsCount > 0 ? `🎬 Рилсов: <strong>${reelsCount}</strong> — на этапе «Организация»: нужно организовать съёмки (дата/время/место + видеографы).<br>` : '') +
      (macrosCount > 0 ? `🖼 Макетов: <strong>${macrosCount}</strong> — на этапе «Дизайн».<br>` : '') +
      (actorName ? `<br>Создал: ${actorName}.` : '') +
      `<br><br>Откройте «Доску проектов», чтобы приступить к организации.`;

    for (const o of organizers) {
      await this.createInApp(o.id, title, message);
      this.telegram.sendToUser(o.id, tg).catch(() => {});
      if (o.email) {
        this.mail.sendGenericNotification(o.email, o.name || 'Организатор', title, emailBody).catch(() => {});
      }
    }
    // Руководитель СММ — знает о создании контент-плана.
    await this.notifySupervisor('', null, {
      title: '📋 Контент-план создан',
      message: `Создан контент-план: рилсов ${reelsCount}, макетов ${macrosCount} (проект «${projectName}»)`,
    });
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
        // Приоритет ЯВНО переданным из КП непустым значениям (правка состава
        // исполнителей/монтажёров в форме не должна молча теряться); иначе —
        // сохраняем уже заполненное на этапах prev.
        return prev ? {
          ...it,
          assigneeIds: (it.assigneeIds && it.assigneeIds.length) ? it.assigneeIds : (prev.assigneeIds || it.assigneeIds),
          assigneeNames: (it.assigneeNames && it.assigneeNames.length) ? it.assigneeNames : (prev.assigneeNames || it.assigneeNames),
          assigneeId: (it.assigneeIds && it.assigneeIds.length) ? it.assigneeIds[0] : (prev.assigneeId ?? it.assigneeId),
          assigneeName: (it.assigneeNames && it.assigneeNames.length) ? it.assigneeNames[0] : (prev.assigneeName ?? it.assigneeName),
          editorIds: (it.editorIds && it.editorIds.length) ? it.editorIds : (prev.editorIds || it.editorIds),
          editorNames: (it.editorNames && it.editorNames.length) ? it.editorNames : (prev.editorNames || it.editorNames),
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
    const editorsOf = (it: any): string[] =>
      (it?.editorIds && it.editorIds.length) ? it.editorIds.filter(Boolean) : [];
    for (const it of list) {
      const prev: any = prevById.get(it.id);
      const prevIds = idsOf(prev);
      const added = idsOf(it).filter(id => !prevIds.includes(id));
      if (added.length) {
        await this.notifyAssigned(added, {
          title: it.title || card.title, projectId: card.projectId, cardId: card.id, type: card.kind,
          description: it.description, publishDate: it.publishDate,
          shootDate: it.shootDate, shootTime: it.shootTime, shootLocation: it.shootLocation,
        }, actor.name);
      }
      // Вновь выбранные монтажёры (editorIds) — уведомляем по 3 каналам.
      const prevEditors = editorsOf(prev);
      const addedEditors = editorsOf(it).filter(id => !prevEditors.includes(id));
      if (addedEditors.length) {
        await this.notifyAssigned(addedEditors, {
          title: it.title || card.title, projectId: card.projectId, cardId: card.id, type: card.kind,
          description: it.description, publishDate: it.publishDate,
          shootDate: it.shootDate, shootTime: it.shootTime, shootLocation: it.shootLocation,
          note: 'Назначены монтажёром — приступайте после съёмки.',
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
    // Архивные (опубликованы > ARCHIVE_AFTER_DAYS дней назад) в кабинет не тянем.
    const mine = cards.filter(c => this.isAssignee(c, uid) && !this.isArchivedCard(c));
    if (mine.length === 0) return [];
    const projects = await this.projectRepo.find({ where: { id: In([...new Set(mine.map(c => c.projectId))]) } });
    const nameMap = new Map(projects.map(p => [p.id, p.name]));
    return mine.map(c => ({
      ...this.toDto(c),
      project: { id: c.projectId, name: nameMap.get(c.projectId) || '' },
    }));
  }

  /** Просроченные карточки доски в зоне видимости пользователя — для
   *  дашбордов (замена просрочек по задачам). Карточка просрочена, если
   *  deadline < сегодня, этап не финальный и статус не закрыт. */
  async overdueCards(viewer: Viewer) {
    const all = await this.listAll(viewer);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return all.filter((c: any) => {
      if (!c.deadline || c.kind === 'kp') return false;
      if (['published', 'ads'].includes(c.stage)) return false;
      if (['done', 'published'].includes(c.status || '')) return false;
      const d = new Date(c.deadline); d.setHours(0, 0, 0, 0);
      return d < todayStart;
    });
  }

  /** Глобальная занятость дат по ВСЕМ проектам — для подсветки календаря при
   *  планировании. Единицы: элементы групповых карточек (Рилсы/Макеты) и
   *  одиночные карточки (кроме КП-инструкции и обложек). По каждой:
   *  публикация (reel/macro) + съёмка (shoot). Съёмки схлопываются до одной
   *  метки на проект+день (групповая съёмка нескольких рилсов — одно событие). */
  async publicationLoad(): Promise<Array<{ date: string; kind: 'reel' | 'macro' | 'shoot'; projectId: string; project: string; title: string }>> {
    const cards = await this.repo.find();
    const projects = await this.projectRepo.find({ select: ['id', 'name'] as any });
    const nameOf = new Map(projects.map(p => [p.id, p.name]));
    const out: Array<{ date: string; kind: 'reel' | 'macro' | 'shoot'; projectId: string; project: string; title: string }> = [];
    const shootSeen = new Set<string>();
    const day = (v: any): string | null => {
      if (!v) return null;
      const s = String(v).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };
    const push = (date: string | null, kind: 'reel' | 'macro' | 'shoot', projectId: string, title: string) => {
      if (!date) return;
      if (kind === 'shoot') {
        const key = `${projectId}|${date}`;
        if (shootSeen.has(key)) return;
        shootSeen.add(key);
      }
      out.push({ date, kind, projectId, project: nameOf.get(projectId) || 'Проект', title });
    };

    for (const c of cards) {
      if (c.kind === 'kp' || c.type === 'cover') continue; // КП — дубль групп, обложки — не единицы
      if (c.kind === 'reels' || c.kind === 'macros') {
        const isReels = c.kind === 'reels';
        for (const it of (c.items || []) as any[]) {
          push(day(it?.publishDate), isReels ? 'reel' : 'macro', c.projectId, it?.title || (isReels ? 'Reels' : 'Макет'));
          if (isReels) push(day(it?.shootDate) || null, 'shoot', c.projectId, 'Съёмка');
        }
        if (isReels) push(day(c.shootDate), 'shoot', c.projectId, 'Съёмка');
      } else {
        const kind = c.type === 'reels' ? 'reel' : 'macro';
        push(day(c.publishDate), kind, c.projectId, c.title || (kind === 'reel' ? 'Reels' : 'Макет'));
        if (kind === 'reel') push(day(c.shootDate), 'shoot', c.projectId, 'Съёмка');
      }
    }
    return out;
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
    // Несколько исполнителей: assigneeIds — список, assigneeId — основной.
    const prevIds: string[] = (card.assigneeIds && card.assigneeIds.length)
      ? card.assigneeIds : (card.assigneeId ? [card.assigneeId] : []);
    let newlyAssigned: string[] = [];
    if (dto.assigneeIds !== undefined) {
      const ids = Array.isArray(dto.assigneeIds) ? dto.assigneeIds.filter(Boolean) : [];
      patch.assigneeIds = ids.length ? ids : null;
      patch.assigneeId = ids[0] || null;
      newlyAssigned = ids.filter(id => !prevIds.includes(id));
    } else if (dto.assigneeId !== undefined) {
      patch.assigneeId = dto.assigneeId || null;
      patch.assigneeIds = dto.assigneeId ? [dto.assigneeId] : null;
      if (dto.assigneeId && !prevIds.includes(dto.assigneeId)) newlyAssigned = [dto.assigneeId];
    }
    // Монтажёры, выбранные заранее на карточке «Съёмка» (editorIds). Станут
    // исполнителями при переходе Съёмка → Монтаж; здесь уведомляем о назначении.
    const prevEditors: string[] = (card.editorIds && card.editorIds.length) ? card.editorIds : [];
    let newlyEditors: string[] = [];
    if (dto.editorIds !== undefined) {
      const ids = Array.isArray(dto.editorIds) ? dto.editorIds.filter(Boolean) : [];
      patch.editorIds = ids.length ? ids : null;
      newlyEditors = ids.filter(id => !prevEditors.includes(id));
    }
    await this.repo.update(id, patch);
    // R15: уведомление ВСЕМ вновь назначенным — in-app + Telegram + Email.
    if (newlyAssigned.length || newlyEditors.length) {
      const actor = await this.loadActor(viewer.id);
      const m: any = { ...card, ...patch };
      if (newlyAssigned.length) {
        await this.logEvent(id, 'assign', { actor, message: `Назначен исполнитель`, meta: { assigneeIds: newlyAssigned } });
        await this.notifyAssigned(newlyAssigned, {
          title: m.title, projectId: m.projectId, cardId: id, type: m.type,
          description: m.description, deadline: m.deadline, publishDate: m.publishDate,
          shootDate: m.shootDate, shootTime: m.shootTime, shootLocation: m.shootLocation,
        }, actor.name);
      }
      // Без дубля: монтажёров, которых только что уведомили как исполнителей, пропускаем.
      newlyEditors = newlyEditors.filter(id => !newlyAssigned.includes(id));
      if (newlyEditors.length) {
        await this.logEvent(id, 'assign', { actor, message: `Назначен монтажёр`, meta: { editorIds: newlyEditors } });
        await this.notifyAssigned(newlyEditors, {
          title: m.title, projectId: m.projectId, cardId: id, type: m.type,
          description: m.description, deadline: m.deadline, publishDate: m.publishDate,
          shootDate: m.shootDate, shootTime: m.shootTime, shootLocation: m.shootLocation,
          note: 'Назначены монтажёром — приступайте после съёмки.',
        }, actor.name);
      }
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
    await this.notifyStageRole(reel.projectId, 'design', `🎨 Обложка/заставка: ${reel.title}`, 'Создана карточка обложки/заставки рилса', saved.id);
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
    // Несколько исполнителей: переносим всех; assigneeId — основной (первый).
    // На этапе «Монтаж» исполнители = заранее выбранные монтажёры (editorIds),
    // иначе — обычные исполнители элемента (видеографы).
    const editorIds: string[] = (item.editorIds && item.editorIds.length)
      ? item.editorIds.filter(Boolean) : [];
    const baseAssignees: string[] = (item.assigneeIds && item.assigneeIds.length)
      ? item.assigneeIds.filter(Boolean)
      : (item.assigneeId ? [item.assigneeId] : []);
    const assigneeIds: string[] = (stage === 'editing' && editorIds.length)
      ? editorIds : baseAssignees;
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
      // Авто-дедлайн убран: дедлайн этапа ставит руководитель вручную
      // (иначе расчёт от даты публикации мог попасть в прошлое).
      deadline: null,
      stageDeadlines: deadlines,
      assigneeId: assigneeIds[0] || null,
      assigneeIds: assigneeIds.length ? assigneeIds : null,
      // Если карточка ушла на «Съёмку» — монтажёров несём дальше (editorIds),
      // чтобы shootDone перевёл их в исполнители на «Монтаже».
      editorIds: (stage !== 'editing' && editorIds.length) ? editorIds : null,
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
    // fromStage = этап группы: элемент реально продвинулся с него на `stage`.
    // Нужно для KPI («этапов выполнено») — иначе переход выглядит как создание.
    await this.logEvent(saved.id, 'stage_enter', {
      fromStage: group.stage, toStage: stage, actor,
      message: `Из контент-плана → ${STAGE_LABELS[stage] || stage}`,
      meta: { units: 1, deadline: group.deadline || null },
    });
    await this.notifyStageRole(group.projectId, stage, `➡️ ${STAGE_LABELS[stage] || stage}`, `«${saved.title}» на этапе «${STAGE_LABELS[stage] || stage}»`, saved.id);
    if (assigneeIds.length) await this.notifyAssigned(assigneeIds, {
      title: saved.title, projectId: group.projectId, cardId: saved.id, type: saved.type,
      description: saved.description, deadline: saved.deadline, publishDate: saved.publishDate,
      shootDate: saved.shootDate, shootTime: saved.shootTime, shootLocation: saved.shootLocation,
    }, actor.name);
    // Если карточку вынесли на «Съёмку» с заранее выбранными монтажёрами —
    // уведомляем их сразу (на «Монтаже» editorIds уже стали assigneeIds выше).
    if (stage !== 'editing' && editorIds.length) {
      const editorsOnly = editorIds.filter(id => !assigneeIds.includes(id));
      if (editorsOnly.length) await this.notifyAssigned(editorsOnly, {
        title: saved.title, projectId: group.projectId, cardId: saved.id, type: saved.type,
        description: saved.description, deadline: saved.deadline, publishDate: saved.publishDate,
        shootDate: saved.shootDate, shootTime: saved.shootTime, shootLocation: saved.shootLocation,
        note: 'Назначены монтажёром — приступайте после съёмки.',
      }, actor.name);
    }
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

  // R4: назначение видеографа (без смены этапа). Поддержка нескольких +
  // согласованная запись assigneeId/assigneeIds + уведомление только новым.
  private async assignVideographer(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'shooting') throw new BadRequestException('Доступно только на этапе Съёмка');
    const ids: string[] = Array.isArray(payload?.assigneeIds)
      ? payload.assigneeIds.filter(Boolean)
      : (payload?.assigneeId ? [payload.assigneeId] : []);
    if (!ids.length) throw new BadRequestException('Выберите видеографа');
    const prevIds = [card.assigneeId, ...((card.assigneeIds as string[]) || [])].filter(Boolean) as string[];
    await this.repo.update(card.id, { assigneeId: ids[0], assigneeIds: ids });
    const newly = ids.filter(id => !prevIds.includes(id));
    if (newly.length) {
      await this.logEvent(card.id, 'assign', { actor, message: 'Назначен видеограф', meta: { assigneeIds: newly } });
      await this.notifyAssigned(newly, {
        title: card.title, projectId: card.projectId, cardId: card.id, type: card.type,
        description: card.description, deadline: card.deadline, publishDate: card.publishDate,
        shootDate: card.shootDate, shootTime: card.shootTime, shootLocation: card.shootLocation,
      }, actor.name);
    }
  }

  // R5: «Съёмка завершена» (Съёмка → Монтаж). Ссылка на исходники — необязательна.
  private async shootDone(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'shooting') throw new BadRequestException('Доступно только на этапе Съёмка');
    const patch: Partial<WorkflowCard> = {};
    const rawFootageUrl = payload?.rawFootageUrl || card.rawFootageUrl;
    if (rawFootageUrl) {
      patch.rawFootageUrl = rawFootageUrl;
      card.rawFootageUrl = rawFootageUrl;
    }
    // Кто был исполнителем съёмки (видеографы) — чтобы не оставить их
    // исполнителями «Монтажа».
    const prevAssignees = [card.assigneeId, ...((card.assigneeIds as string[]) || [])].filter(Boolean) as string[];
    // На «Монтаже» исполнители = заранее выбранные монтажёры (editorIds).
    const editorIds = (card.editorIds || []).filter(Boolean);
    let addedEditors: string[] = [];
    if (editorIds.length) {
      patch.assigneeId = editorIds[0];
      patch.assigneeIds = editorIds;
      patch.editorIds = null; // промоушен выполнен — список монтажёров больше не нужен
      card.assigneeId = editorIds[0];
      card.assigneeIds = editorIds;
      card.editorIds = null;
      addedEditors = editorIds.filter(id => !prevAssignees.includes(id));
    } else {
      // Монтажёров заранее не выбрали — снимаем видеографов с исполнителей,
      // чтобы карточка «Монтаж» не висела на них. Монтажёра назначат на доске
      // (через update — с уведомлением). Роль video_editor проекта уведомит
      // notifyStageRole внутри moveToStage.
      patch.assigneeId = null;
      patch.assigneeIds = null;
      card.assigneeId = null;
      card.assigneeIds = null;
    }
    await this.repo.update(card.id, patch);
    // Полноценное 3-канальное «вам назначена карточка» монтажёрам в момент,
    // когда монтаж реально начинается (Email + поля + кнопки). moveToStage
    // дубль исполнителям не шлём (skipAssigneeNotify).
    if (addedEditors.length) {
      await this.notifyAssigned(addedEditors, {
        title: card.title, projectId: card.projectId, cardId: card.id, type: card.type,
        description: card.description, deadline: card.deadline, publishDate: card.publishDate,
        shootDate: card.shootDate, shootTime: card.shootTime, shootLocation: card.shootLocation,
        note: 'Съёмка завершена — можно приступать к монтажу.',
      }, actor.name);
    }
    await this.moveToStage(card, 'editing', actor, { message: 'Съёмка завершена → Монтаж', skipAssigneeNotify: addedEditors.length > 0 });
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
    // Ссылки на обложку/заставку — необязательны (чтобы кнопка «Сделал» из бота
    // работала; ссылки можно прикрепить на доске).
    const coverUrl = payload?.coverUrl || card.coverUrl || null;
    const introUrl = payload?.introUrl || card.introUrl || null;
    await this.repo.update(card.id, { coverUrl, introUrl, status: 'done' });
    await this.logEvent(card.id, 'cover_done', { actor, message: 'Обложка/заставка готова' });
    if (card.parentCardId) {
      await this.repo.update(card.parentCardId, { designDone: true });
      await this.runJoinCheck(card.parentCardId, actor);
    }
  }

  // R8: «Макет готов» (static) → Внутренняя проверка
  private async layoutDone(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'design' || card.type === 'cover') throw new BadRequestException('Доступно только для макета на этапе Дизайн');
    // Ссылка на макет — необязательна (кнопка «Сделал» из бота; ссылку можно
    // прикрепить на доске).
    const finalAssetUrl = payload?.finalAssetUrl || card.finalAssetUrl || null;
    await this.repo.update(card.id, { finalAssetUrl, designDone: true });
    card.finalAssetUrl = finalAssetUrl;
    await this.moveToStage(card, 'internal_review', actor, { message: 'Макет готов → Внутренняя проверка' });
  }

  /** Кто закрыл монтаж этой карточки (последнее событие editing_done).
   *  Нужен, чтобы зачёт за этап получил монтажёр, а не тот, кто случайно
   *  разблокировал join-гейт. Фолбэк — переданный актор. */
  private async editorCreditActor(cardId: string, fallback: Actor): Promise<Actor> {
    try {
      const ev = await this.eventRepo.findOne({
        where: { cardId, action: 'editing_done' },
        order: { createdAt: 'DESC' },
      });
      if (ev?.actorId) return await this.loadActor(ev.actorId);
    } catch { /* фолбэк ниже */ }
    return fallback;
  }

  /** Join-гейт (ТЗ §8): когда готовы и монтаж, и обложка — рилс уходит
   *  на Внутреннюю проверку. Иначе «ждёт обложку» и стоит в Монтаже. */
  private async runJoinCheck(reelId: string, actor: Actor) {
    const reel = await this.repo.findOne({ where: { id: reelId } });
    if (!reel) return;
    // Ветка дизайна готова, если designDone=true ИЛИ под-карточки обложки/
    // заставки вообще нет (карточка создана напрямую / новая модель). Иначе
    // монтаж завис бы навсегда, ожидая обложку, которой не существует.
    let designReady = reel.designDone;
    if (!designReady) {
      const coverCount = await this.repo.count({ where: { parentCardId: reel.id, type: 'cover' } });
      if (coverCount === 0) {
        designReady = true;
        await this.repo.update(reel.id, { designDone: true });
        reel.designDone = true;
      }
    }
    if (reel.editingDone && designReady) {
      await this.repo.update(reel.id, { status: 'active' });
      reel.status = 'active';
      // Переход «Монтаж → Внутренняя проверка» — заслуга МОНТАЖЁРА, даже если
      // гейт разблокировал дизайнер, закрывший обложку последним. Берём автора
      // события editing_done, иначе KPI зачтёт этап не тому.
      const credit = await this.editorCreditActor(reel.id, actor);
      await this.moveToStage(reel, 'internal_review', credit, { message: 'Монтаж готов → Внутренняя проверка' });
    } else if (reel.editingDone && !designReady) {
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
    await this.notifyRework(card, comment, isReels, 'qa', actor.name);
  }

  // «Отправлено клиенту» — фиксируем время (без смены этапа)
  private async markSentToClient(card: WorkflowCard, actor: Actor) {
    if (card.stage !== 'client_approval') throw new BadRequestException('Доступно только на Согласовании');
    await this.repo.update(card.id, { sentToClientAt: new Date() });
    await this.logEvent(card.id, 'sent_to_client', { actor, message: 'Отправлено клиенту' });
    await this.notifySupervisor(card.id, actor.id, {
      title: `📤 Отправлено клиенту: ${card.title}`,
      message: `«${card.title}» отправлена клиенту на согласование.`,
    });
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
    await this.notifyRework(card, comment, isReels, 'client', actor.name);
  }

  /** Рилс ли это (с учётом легаси-карточек без type, но с contentType='reel'). */
  private isReelsCard(card: WorkflowCard): boolean {
    return card.type === 'reels' || (card.type == null && card.contentType === 'reel');
  }

  // R13: «Опубликовано» → Опубликовано
  private async publish(card: WorkflowCard, payload: any, actor: Actor) {
    if (card.stage !== 'ready_to_publish') throw new BadRequestException('Доступно только на «Готово к публикации»');
    // Ссылка на публикацию — необязательна (кнопка «Сделал» из бота).
    const publishedUrl = payload?.publishedUrl || card.publishedUrl || null;
    const now = new Date();
    await this.repo.update(card.id, { publishedUrl, publishedAt: now, status: 'published' });
    card.publishedUrl = publishedUrl;
    await this.moveToStage(card, 'published', actor, { message: 'Опубликовано' });
  }

  // ─── Вспомогательное ──────────────────────────────────────────────────

  /** Перенос карточки на этап: ставит в конец колонки, обновляет дедлайн
   *  по stageDeadlines, пишет журнал и шлёт уведомление роли этапа. */
  private async moveToStage(card: WorkflowCard, newStage: string, actor: Actor, opts: { message?: string; skipAssigneeNotify?: boolean } = {}) {
    const [{ max }] = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max FROM workflow_cards WHERE "projectId" = $1 AND stage = $2`,
      [card.projectId, newStage],
    );
    // Авто-дедлайн убран: при переходе НЕ подставляем дедлайн из stageDeadlines,
    // сохраняем тот, что выставлен вручную.
    const deadline = card.deadline || null;
    const fromStage = card.stage;
    await this.repo.update(card.id, { stage: newStage, position: Number(max) + 1, deadline });
    // units — сколько единиц контента продвинулось (у групповой карточки это
    // все её элементы); deadline — снимок срока этапа на момент перехода.
    // Оба поля читает KPI («этапов выполнено» / «соблюдено дедлайнов»).
    const units = (card.kind === 'reels' || card.kind === 'macros')
      ? Math.max(1, ((card.items as any[]) || []).length) : 1;
    await this.logEvent(card.id, 'stage_enter', {
      fromStage, toStage: newStage, actor,
      message: opts.message || `Этап: ${STAGE_LABELS[newStage] || newStage}`,
      meta: { units, deadline },
    });
    // R15: уведомление роли нового этапа + текущим исполнителям — с кнопками
    // «Сделал/Не сделал» в Telegram (нельзя для финальных этапов).
    const actionable = !['published', 'ads'].includes(newStage);
    const buttons = actionable ? this.cardButtons(card.id) : undefined;
    await this.notifyStageRole(card.projectId, newStage, `➡️ ${STAGE_LABELS[newStage] || newStage}`, `Карточка «${card.title}» на этапе «${STAGE_LABELS[newStage] || newStage}»`, actionable ? card.id : undefined);
    const assignees = [card.assigneeId, ...((card.assigneeIds as string[]) || [])].filter(Boolean) as string[];
    // skipAssigneeNotify — когда вызывающий уже отправил исполнителям полное
    // «вам назначена карточка» (shootDone для монтажёров), не дублируем.
    if (assignees.length && !opts.skipAssigneeNotify) {
      await this.notify(assignees, `➡️ ${STAGE_LABELS[newStage] || newStage}`, `Карточка «${card.title}» перешла на этап «${STAGE_LABELS[newStage] || newStage}»`, card.projectId, buttons);
    }
    // Руководитель СММ (Навруз) — знает КАЖДЫЙ шаг. Email + кнопки на его
    // рабочих этапах (внутренняя проверка / согласование), иначе только CRM+TG.
    const sLabel = STAGE_LABELS[newStage] || newStage;
    const proj = await this.projectRepo.findOne({ where: { id: card.projectId } }).catch(() => null);
    const pn = proj?.name || '';
    const supMsg = newStage === 'internal_review'
      ? `«${card.title}» сдан на внутреннюю проверку — нужно проверить и принять/вернуть (проект «${pn}»)`
      : newStage === 'client_approval'
        ? `«${card.title}» на согласовании с клиентом (проект «${pn}»)`
        : `«${card.title}» → этап «${sLabel}» (проект «${pn}»)`;
    await this.notifySupervisor(card.id, actor.id, {
      title: `📋 ${sLabel}: ${card.title}`,
      message: supMsg,
      email: ['internal_review', 'client_approval'].includes(newStage),
      buttons: actionable,
    });
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

  /** Уведомить пользователей проекта с ролью-владельцем этапа.
   *  cardId — если передан, в Telegram добавляются кнопки «Сделал/Не сделал». */
  private async notifyStageRole(projectId: string, stage: string, title: string, message: string, cardId?: string) {
    const roles = STAGE_ROLES[stage] || [];
    if (roles.length === 0) return;
    const ids = await this.findProjectUsersByRole(projectId, roles);
    await this.notify(ids, title, message, projectId, this.cardButtons(cardId));
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

  /** Inline-кнопки «Сделал / Не сделал» для карточки в Telegram. */
  private cardButtons(cardId?: string): { text: string; callback_data: string }[][] | undefined {
    if (!cardId) return undefined;
    return [[
      { text: '✅ Сделал', callback_data: `wf:done:${cardId}` },
      { text: '🚫 Не сделал', callback_data: `wf:skip:${cardId}` },
    ]];
  }

  /** In-app уведомление (колокол) — ГАРАНТИРОВАННЫЙ канал (не зависит от TG/
   *  email). Сбой логируем, а не глотаем молча: это последняя линия доставки. */
  private async createInApp(userId: string, title: string, message: string) {
    try {
      await this.notifications.create({
        userId, type: NotificationType.STATUS_CHANGE, title, message, link: '/workflow-board',
      } as any);
    } catch (e: any) {
      this.logger.warn(`in-app notify failed for ${userId}: ${e?.message || e}`);
    }
  }

  /** Уведомление в приложении (колокол) + Telegram (ТЗ §6 R15).
   *  buttons — опциональные inline-кнопки для Telegram. */
  private async notify(userIds: string[], title: string, message: string, projectId: string, buttons?: { text: string; callback_data: string }[][]) {
    const unique = [...new Set(userIds.filter(Boolean))];
    for (const uid of unique) {
      await this.createInApp(uid, title, message);
      this.telegram.sendToUser(uid, `<b>${title}</b>\n${message}`, buttons).catch(() => {});
    }
  }

  /** Уведомить руководителей СММ (Навруза) о СОБЫТИИ доски — он должен знать
   *  каждый шаг. in-app + Telegram всегда; Email — по флагу (его рабочие
   *  этапы). buttons — кнопки «Сделал/Не сделал» (может закрыть этап из бота).
   *  Уведомляем всех активных smm_director независимо от участия в проекте. */
  private async notifySupervisor(
    cardId: string,
    actorId: string | null,
    opts: { title: string; message: string; email?: boolean; buttons?: boolean },
  ) {
    const dirs: Array<{ id: string; name: string; email: string }> = await this.userRepo.query(
      `SELECT id, name, email FROM users
       WHERE "isActive" = true AND "isBlocked" = false
         AND (role = 'smm_director' OR "secondaryRole" = 'smm_director')`,
    ).catch(() => []);
    if (!dirs.length) return;
    const buttons = opts.buttons ? this.cardButtons(cardId) : undefined;
    for (const d of dirs) {
      if (actorId && d.id === actorId) continue; // не дублируем собственное действие
      await this.createInApp(d.id, opts.title, opts.message);
      this.telegram.sendToUser(d.id, `<b>${opts.title}</b>\n${opts.message}`, buttons).catch(() => {});
      if (opts.email && d.email) {
        this.mail.sendGenericNotification(d.email, d.name || 'Руководитель', opts.title, opts.message).catch(() => {});
      }
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
      cardId?: string;
      type?: string | null;
      description?: string | null;
      deadline?: string | null;
      publishDate?: string | null;
      shootDate?: string | null;
      shootTime?: string | null;
      shootLocation?: string | null;
      /** Доп. пояснение роли — напр. «Назначены монтажёром (после съёмки)». */
      note?: string | null;
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
      details.note ? details.note : '',
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
      details.note ? `🎞 ${details.note}` : '',
      deadline ? `📅 Дедлайн: ${deadline}` : '',
      publishDate ? `🗓 Публикация: ${publishDate}` : '',
      shoot ? `🎥 Съёмка: ${shoot}` : '',
      details.description ? `📝 ${details.description}` : '',
      actorName ? `👤 Назначил: ${actorName}` : '',
    ].filter(Boolean).join('\n');

    for (const uid of unique) {
      await this.createInApp(uid, title, message);
      this.telegram.sendToUser(uid, tg, this.cardButtons(details.cardId)).catch(() => {});
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
        }).catch((e: any) => this.logger.warn(`card-assigned mail failed for ${uid}: ${e?.message || e}`));
      } else {
        this.logger.debug(`user ${uid} has no email — card-assigned mail skipped`);
      }
    }
  }

  /** Уведомление о доработке (QA / правки клиента) — 3 канала + комментарий +
   *  кнопки «Сделал/Не сделал». Шлём исполнителям карточки. */
  private async notifyRework(card: WorkflowCard, comment: string, isReels: boolean, kind: 'qa' | 'client', actorName?: string) {
    const backLabel = isReels ? 'Монтаж' : 'Дизайн';
    const source = kind === 'qa' ? 'Внутренняя проверка' : 'Правки клиента';
    const project = await this.projectRepo.findOne({ where: { id: card.projectId } }).catch(() => null);
    const title = `↩ Доработка (${backLabel})`;
    const message = `«${card.title}» — на доработку: ${comment}`;
    const ids = [...new Set([card.assigneeId, ...((card.assigneeIds as string[]) || [])].filter(Boolean) as string[])];
    for (const uid of ids) {
      await this.createInApp(uid, title, message);
      this.telegram.sendToUser(uid, `<b>${title}</b>\n${message}\n📋 ${source}${actorName ? ` · ${actorName}` : ''}`, this.cardButtons(card.id)).catch(() => {});
      const u = await this.userRepo.findOne({ where: { id: uid } }).catch(() => null);
      if (u?.email) {
        const body = `Карточка <strong>«${card.title}»</strong> (проект «${project?.name || ''}») отправлена на доработку — этап «${backLabel}».<br><br>💬 Комментарий (${source}): ${comment}<br><br>Откройте «Доску проектов», исправьте и отметьте «Сделал».`;
        this.mail.sendGenericNotification(u.email, u.name || 'Сотрудник', `↩ Доработка: ${card.title}`, body).catch(() => {});
      }
    }
    // Руководитель СММ должен знать о доработке.
    await this.notifySupervisor(card.id, null, {
      title: `↩ Доработка: ${card.title}`,
      message: `«${card.title}» отправлена на доработку (${kind === 'qa' ? 'внутренняя проверка' : 'правки клиента'}): ${comment}`,
      buttons: true,
    });
  }

  /** Уведомление руководителю СММ, что сотрудник отметил «не сделано». */
  private async notifyNotDone(card: WorkflowCard, whoName: string) {
    const leads: Array<{ id: string; name: string; email: string }> = await this.userRepo.query(
      `SELECT id, name, email FROM users
       WHERE "isActive" = true AND "isBlocked" = false
         AND (role = 'smm_director' OR "secondaryRole" = 'smm_director')`,
    ).catch(() => []);
    if (!leads.length) return;
    const project = await this.projectRepo.findOne({ where: { id: card.projectId } }).catch(() => null);
    const stageLabel = STAGE_LABELS[card.stage] || card.stage;
    const title = '🚫 Сотрудник отметил «не сделано»';
    const message = `${whoName}: ещё не сделал «${card.title}» · этап «${stageLabel}» · проект «${project?.name || ''}»`;
    for (const l of leads) {
      await this.createInApp(l.id, title, message);
      this.telegram.sendToUser(l.id, `<b>${title}</b>\n${message}`).catch(() => {});
      if (l.email) {
        this.mail.sendGenericNotification(l.email, l.name || 'Руководитель', title,
          `<strong>${whoName}</strong> отметил, что ещё не сделал карточку <strong>«${card.title}»</strong> (этап «${stageLabel}», проект «${project?.name || ''}»).`).catch(() => {});
      }
    }
  }

  /** Обработка нажатия inline-кнопки бота: «Сделал» (форвард этапа) /
   *  «Не сделал» (эскалация руководителю СММ). Возвращает текст для ответа. */
  async handleBotAction(cardId: string, action: 'done' | 'skip', userId: string): Promise<{ text: string }> {
    const card = await this.repo.findOne({ where: { id: cardId } });
    if (!card) return { text: 'Карточка не найдена или уже закрыта.' };
    const u = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
    const viewer: Viewer = { id: userId, role: u?.role || '' };

    if (action === 'skip') {
      await this.notifyNotDone(card, u?.name || 'Сотрудник');
      return { text: '🚫 Отмечено: не сделано. Руководитель СММ уведомлён.' };
    }

    // «Сделал» — двигаем карточку вперёд.
    try {
      if (card.kind === 'reels' || card.kind === 'macros') {
        const items = (card.items || []).filter((it: any) =>
          it.assigneeId === userId || (Array.isArray(it.assigneeIds) && it.assigneeIds.includes(userId)));
        if (!items.length) return { text: 'В этой карточке нет элементов, назначенных на вас.' };
        let moved = 0;
        for (const it of items) { try { await this.advanceItem(cardId, it.id, viewer); moved++; } catch { /* пропускаем */ } }
        return { text: moved ? `✅ Готово: переведено элементов — ${moved}.` : 'Не удалось — откройте «Доску проектов».' };
      }
      const FORWARD: Record<string, string> = {
        content_plan: 'confirm_plan', organization: 'confirm_shoot', shooting: 'shoot_done',
        editing: 'editing_done', design: 'layout_done', internal_review: 'qa_accept',
        client_approval: 'client_approve', ready_to_publish: 'publish',
      };
      const action2 = (card.stage === 'design' && card.type === 'cover') ? 'cover_done' : FORWARD[card.stage];
      if (!action2) return { text: 'На этом этапе кнопка недоступна — откройте «Доску проектов».' };
      await this.transition(cardId, action2, {}, viewer);
      return { text: '✅ Готово — карточка переведена на следующий этап.' };
    } catch (e: any) {
      return { text: e?.message || 'Не удалось. Откройте «Доску проектов».' };
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
