import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import {
  ClientLead, ClientLeadStatus, ClientLeadDirection, LEAD_STATUSES_SETTABLE, LOST_REASONS, STAGE_PROBABILITY,
} from './client-lead.entity';
import { Task, TaskScope, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { User, UserRole } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction, ActivityLog } from '../activity-log/activity-log.entity';
import { AppGateway } from '../gateway/app.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../../common/html-escape';
import {
  COLD_CALL_EVENTS_SINCE, FUNNEL_ORDER, buildSalesKpi, currentVacationRange, dushanbeDay, dushanbeDayEnd,
  emailBecameSent, expandRanges, funnelStepIsForward, milestoneEquivalents, salesPeriod, workingDays,
} from './sales-kpi.logic';
import { salesRoleOf } from '../../common/sales-segment';
import { LeadEventKind, recordLeadEvent } from './lead-events';
import { loadSalesSettings, normsFor } from './sales-settings';
import {
  ACTIVE_STATUSES, LAST_ACTION_SQL, LeadListQuery, NEXT_ACTION_SQL, parseLeadListQuery, statusVariants,
} from './lead-list';
import { duplicateKeys, isDuplicate } from './lead-duplicates';
import { LeadActor, isLeadTop, leadDirectionOf, ownerCandidateError } from './lead-access';

/** Роли менеджеров продаж — для bulk-KPI и фильтров. */
const SALES_MANAGER_ROLES = [UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV];

/** Соответствие роли МП → направление лидов. */
const ROLE_TO_DIRECTION: Record<string, ClientLeadDirection> = {
  [UserRole.SALES_MANAGER_SMM]: ClientLeadDirection.SMM,
  [UserRole.SALES_MANAGER_DEV]: ClientLeadDirection.DEVELOPMENT,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Доска: выигранные и проигранные — только изменённые за 30 дней. */
const BOARD_CLOSED_DAYS = 30;
/** Доска без лимита 500, но с жёстким пределом — на случай мусорной базы. */
const BOARD_HARD_LIMIT = 3000;

/** Литерал SQL-списка из наших констант (не из запроса — инъекции нет). */
const sqlList = (values: readonly string[]) => values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');

/** Сортировка «ближайшее действие»: сначала активные лиды по сроку (самое
 *  просроченное сверху), потом закрытые и «на паузе» — их старые даты не
 *  должны висеть в начале списка. */
const NEXT_SORT_SQL =
  `CASE WHEN c.status::text IN (${sqlList(ACTIVE_STATUSES)}) AND c."onHold" = false THEN ${NEXT_ACTION_SQL} END`;

const timeOf = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

export interface ListFilters {
  search?: string;
  status?: ClientLeadStatus | string;
  interest?: string;
  sphere?: string;
  ownerId?: string;
  source?: string;
  /** Направление МП — лиды чужого направления скрываются. */
  direction?: ClientLeadDirection;
}

/** Откуда заведён лид — в событие «created». */
export type LeadVia = 'form' | 'direct' | 'voice' | 'site';

export interface CreateLeadOptions {
  via?: LeadVia;
  /** Создать, даже если есть похожие (то же, что dto.force). */
  force?: boolean;
}

/** Элемент ответа 409 «duplicate». */
export interface LeadDuplicate { id: string; name: string; status: string; ownerName: string | null }

/** Кто действует: id, роли (основная и вторая), имя. */
export type LeadUser = LeadActor & { role: string; name?: string };

export interface LeadListPage {
  items: ClientLead[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class ClientsService implements OnModuleInit {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(ClientLead) private repo: Repository<ClientLead>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(ActivityLog) private activityRepo: Repository<ActivityLog>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    private activityLog: ActivityLogService,
    private gateway: AppGateway,
    private notificationsService: NotificationsService,
    // Telegram — модуль @Global: импорт в ClientsModule не нужен, кольца
    // зависимостей не появляется. Optional — для тестов и запуска без бота.
    @Optional() private telegram?: TelegramService,
  ) {}

  /** На старте гарантируем оба пути учёта прогрессий по воронке:
   *   1) ALTER TYPE ... ADD VALUE IF NOT EXISTS 'LEAD_PROGRESS' для
   *      activity_logs (старый путь);
   *   2) CREATE TABLE IF NOT EXISTS lead_progress — отдельная таблица
   *      БЕЗ enum-зависимостей. KPI читает в первую очередь отсюда.
   *      Идемпотентно, не требует миграции, гарантированно работает. */
  async onModuleInit() {
    // Имя enum-типа берём из каталога (15.11.2026): захардкоженное
    // «activity_logs_action_enum» на базе, созданной иначе, тихо не находилось.
    try {
      const actionEnum = await this.enumTypeOf('activity_logs', 'action');
      if (actionEnum) {
        await this.activityRepo.manager.query(
          `ALTER TYPE "${actionEnum}" ADD VALUE IF NOT EXISTS 'LEAD_PROGRESS'`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`ALTER TYPE for LEAD_PROGRESS failed: ${e?.message || e}`);
    }
    // Значения статуса лида: на проде synchronize выключен — значения в
    // pg-enum добавляем идемпотентно сами. «meeting» и «contract» — этапы
    // единой воронки (15.11.2026, как миграция 1834 — для баз без миграций).
    try {
      const statusEnum = await this.enumTypeOf('client_leads', 'status');
      if (statusEnum) {
        for (const v of ['unknown', 'meeting', 'contract']) {
          await this.activityRepo.manager.query(`ALTER TYPE "${statusEnum}" ADD VALUE IF NOT EXISTS '${v}'`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`ALTER TYPE for client_leads_status failed: ${e?.message || e}`);
    }
    try {
      await this.activityRepo.manager.query(`
        CREATE TABLE IF NOT EXISTS lead_progress (
          id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      uuid NOT NULL,
          lead_id      uuid,
          lead_name    varchar,
          stage_from   varchar,
          stage_to     varchar,
          status_from  varchar,
          status_to    varchar,
          created_at   timestamp with time zone NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lead_progress_user_date
          ON lead_progress(user_id, created_at);
      `);
      // delta = +1 при движении вперёд по воронке, -1 при движении назад.
      // KPI «Продвижения по воронке» теперь = SUM(delta), а не COUNT(*) —
      // если менеджер откатил, цифра уменьшается, и нельзя «накручивать»
      // KPI гоняя один лид взад-вперёд.
      await this.activityRepo.manager.query(
        `ALTER TABLE lead_progress ADD COLUMN IF NOT EXISTS delta int NOT NULL DEFAULT 1`,
      );
      this.logger.log('lead_progress table ensured');
    } catch (e: any) {
      this.logger.error(`CREATE TABLE lead_progress failed: ${e?.message || e}`);
    }
    try {
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callType" varchar`,
      );
      // Повторный звонок — отдельная дата+время (не путать с встречей
      // nextContactAt). Рисуется в календаре менеджера оранжевым.
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "repeatCallAt" timestamp with time zone`,
      );
      await this.repo.manager.query(
        `CREATE INDEX IF NOT EXISTS idx_client_leads_repeat_call
         ON client_leads("repeatCallAt") WHERE "repeatCallAt" IS NOT NULL`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE client_leads callType/repeatCallAt failed: ${e?.message || e}`);
    }
    try {
      // lead_actions — журнал действий менеджера-СОБЫТИЙ (а не состояний).
      // kind='cold_call' пишется при отметке «Тип звонка = Холодный».
      // KPI «Холодные звонки» считает события за период — поэтому каждая
      // отметка надёжно +1, и звонок не «исчезает», если позже сменить
      // тип звонка у лида.
      await this.repo.manager.query(`
        CREATE TABLE IF NOT EXISTS lead_actions (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    uuid NOT NULL,
          lead_id    uuid,
          kind       varchar NOT NULL,
          created_at timestamp with time zone NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lead_actions_user_kind_date
          ON lead_actions(user_id, kind, created_at);
      `);
      // Встречи (kind=meeting) — события «встреча состоялась» (с 15.11.2026
      // их пишет SalesService в момент отметки, at = сейчас).
      await this.repo.manager.query(`
        ALTER TABLE lead_actions ADD COLUMN IF NOT EXISTS "at" timestamp with time zone;
        CREATE INDEX IF NOT EXISTS idx_lead_actions_user_kind_at
          ON lead_actions(user_id, kind, "at");
        CREATE INDEX IF NOT EXISTS idx_lead_actions_lead_kind
          ON lead_actions(lead_id, kind);
      `);
    } catch (e: any) {
      this.logger.error(`CREATE TABLE lead_actions failed: ${e?.message || e}`);
    }
    try {
      // emailStatus — точный признак отправленного письма. KPI
      // «Персональные письма» теперь = count(emailStatus='sent' AND
      // updatedAt в окне). Раньше была эвристика «есть email +
      // lastContactAt», которая ловила всё подряд.
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "emailStatus" varchar`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE client_leads emailStatus failed: ${e?.message || e}`);
    }
    try {
      // Последняя активность менеджера с клиентом — для колонки в Базе клиентов.
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "lastActivityAt" timestamp with time zone`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE client_leads lastActivityAt failed: ${e?.message || e}`);
    }
    try {
      // «Позвонить» — отметка руководителя для менеджера-владельца.
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callRequested" boolean NOT NULL DEFAULT false`,
      );
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callRequestedAt" timestamp with time zone`,
      );
      await this.repo.manager.query(
        `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callRequestedByName" varchar`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE client_leads callRequested failed: ${e?.message || e}`);
    }
    await this.ensureSalesFunnelSchema();
    await this.backfillLeadEvents();
  }

  /** Продажи, этап 2 (15.11.2026): то же, что миграция 1834, — для баз, где
   *  миграции не гоняют (локальная разработка). Идемпотентно; на проде
   *  миграция уже всё создала, и запросы ничего не меняют. */
  private async ensureSalesFunnelSchema(): Promise<void> {
    const q = (sql: string) => this.repo.manager.query(sql);
    try {
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "onHold" boolean NOT NULL DEFAULT false`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "nextStepAt" timestamptz NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "probability" integer NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "expectedCloseAt" date NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "lostReason" varchar(32) NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "meetingResult" varchar(16) NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "handoffAt" timestamptz NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "handoffById" uuid NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "handoffData" jsonb NULL`);
      await q(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "projectId" uuid NULL`);
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE client_leads (sales funnel) failed: ${e?.message || e}`);
    }
    try {
      // Лента событий лида — тот же DDL, что в миграции 1834.
      await q(`
        CREATE TABLE IF NOT EXISTS lead_events (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          lead_id    uuid NOT NULL,
          user_id    uuid NULL,
          kind       varchar(32) NOT NULL,
          data       jsonb NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await q(`CREATE INDEX IF NOT EXISTS idx_lead_events_lead_date ON lead_events (lead_id, created_at DESC)`);
    } catch (e: any) {
      this.logger.warn(`CREATE TABLE lead_events failed: ${e?.message || e}`);
    }
  }

  /** Имя pg-enum колонки (как в миграции 1826000000000); null — не enum. */
  private async enumTypeOf(table: string, column: string): Promise<string | null> {
    const rows: Array<{ typname: string }> = await this.activityRepo.manager.query(
      `SELECT t.typname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         JOIN pg_type t ON t.oid = a.atttypid AND t.typtype = 'e'
        WHERE c.relname = $1 AND a.attname = $2 AND NOT a.attisdropped`,
      [table, column],
    );
    return rows?.[0]?.typname ?? null;
  }

  /** Идемпотентная дозапись писем (14.11.2026): письма раньше считались по
   *  состоянию лида, теперь — по журналу lead_actions. Отмеченные «Написал»
   *  письма переносим в журнал; повторный запуск ничего не добавляет. Письмо
   *  датируем последней правкой лида — так его считал старый KPI.
   *  Встречи отсюда убраны (15.11.2026): встреча засчитывается, когда
   *  менеджер отметил «состоялась» (SalesService), а не по дате в карточке —
   *  иначе каждый перезапуск возвращал бы в KPI будущие встречи, которые
   *  миграция 1835 удалила. */
  private async backfillLeadEvents(): Promise<void> {
    try {
      const emails = await this.repo.manager.query(`
        INSERT INTO lead_actions (user_id, lead_id, kind, created_at)
        SELECT c."ownerId"::uuid, c.id, 'email', c."updatedAt"
        FROM client_leads c
        WHERE LOWER(COALESCE(c."emailStatus", '')) = 'sent' AND c."ownerId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM lead_actions la WHERE la.lead_id = c.id AND la.kind = 'email')
        RETURNING id`);
      const n = Array.isArray(emails) ? emails.length : 0;
      if (n) this.logger.log(`lead_actions backfill: emails=${n}`);
    } catch (e: any) {
      this.logger.warn(`lead_actions backfill failed: ${e?.message || e}`);
    }
  }

  /** Лёгкий lookup юзера по id — для controller'а чтобы определить
   *  направление КПИ. Возвращаем только нужные поля. */
  async findOwnerInfo(userId: string): Promise<{ id: string; name: string; role: string; secondaryRole: string | null } | null> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) return null;
    return { id: u.id, name: u.name, role: u.role, secondaryRole: (u as any).secondaryRole ?? null };
  }

  /** Bulk-KPI всех МП за период. Для дашборда основателя.
   *  Возвращает массив `{ user, employee, kpi }`. */
  async kpiForAllSalesManagers(from?: string, to?: string) {
    const users = await this.userRepo.find({
      where: { role: In(SALES_MANAGER_ROLES), isActive: true, isBlocked: false },
      order: { name: 'ASC' },
    });
    if (users.length === 0) return [];

    // Подтягиваем employee-record'ы одним запросом — без N+1.
    const userIds = users.map(u => u.id);
    const employees = await this.employeeRepo.find({ where: { userId: In(userIds) } });
    const empByUserId = new Map(employees.map(e => [e.userId, e]));

    return Promise.all(users.map(async (u) => {
      const direction = ROLE_TO_DIRECTION[u.role];
      const kpi = await this.kpi(u.id, direction, from, to).catch(() => null);
      const emp = empByUserId.get(u.id);
      return {
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          avatar: u.avatar || null,
        },
        employee: emp ? {
          id: emp.id,
          position: emp.position,
          department: emp.department,
        } : null,
        kpi,
      };
    }));
  }

  /** Продвижение по воронке (15.11.2026) — «вехи»: +1 только когда лид
   *  ВПЕРВЫЕ доходит до этапа (в lead_progress ещё нет записи +1 этого лида
   *  с таким этапом — от любого пользователя). Откат назад и уход в
   *  проигрыш — 0, без штрафа.
   *  Единая воронка (15.11.2026): этап — только status. Вехи, взятые раньше
   *  «этапом онбординга», эквивалентны новым этапам (milestoneEquivalents):
   *  лид, дошедший до «КП» в онбординге, за «КП» в воронке второй раз +1 не
   *  получит.
   *  Зачёт — владельцу лида, если он менеджер продаж (его воронка, даже когда
   *  карточку подвинул руководитель); иначе — тому, кто подвинул. */
  private async maybeLogProgress(
    before: { status?: string | null; name?: string; ownerId?: string | null },
    after: { status?: string | null; name?: string; ownerId?: string | null },
    actor: { id: string; name?: string },
    leadId?: string,
  ): Promise<void> {
    const to = after.status || '';
    const from = before.status || '';
    if (!to || to === from) return;
    if (!funnelStepIsForward(FUNNEL_ORDER[to], FUNNEL_ORDER[from])) return;

    // Веха уже взята этим лидом — повторный заход не засчитываем.
    try {
      if (await this.milestoneReached(leadId, to)) return;
    } catch (e: any) {
      // Не смогли проверить — не начисляем: лучше недосчитать, чем накрутить.
      this.logger.warn(`lead_progress milestone check failed: ${e?.message || e}`);
      return;
    }

    // Кому зачёт: владелец-МП (основной или второй ролью), иначе — автор.
    let creditUserId = actor.id;
    if (after.ownerId && after.ownerId !== actor.id) {
      const owner = await this.userRepo.findOne({
        where: { id: after.ownerId },
        select: ['id', 'role', 'secondaryRole'] as any,
      }).catch(() => null);
      if (owner && salesRoleOf(owner as any)) creditUserId = owner.id;
    }

    // ─── Первичный путь: lead_progress (без enum-зависимостей) ─────────
    // Этапы онбординга больше не пишем (stage_* = null) — колонки остались
    // как история и для проверки старых вех.
    try {
      await this.activityRepo.manager.query(
        `INSERT INTO lead_progress
           (user_id, lead_id, lead_name, stage_from, stage_to, status_from, status_to, delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [creditUserId, leadId || null, after.name || null, null, null, from || null, to, 1],
      );
    } catch (e: any) {
      this.logger.error(`lead_progress insert failed: ${e?.message || e}`);
    }

    // Legacy activity_logs (запасной счёт KPI и журнал действий): автор —
    // тот, кто подвинул; кому зачтено — в details. entityId — id лида
    // (15.11.2026): раньше был пустым, и из журнала нельзя было открыть лид.
    await this.activityLog.log({
      userId: actor.id,
      userName: actor.name,
      action: ActivityAction.LEAD_PROGRESS,
      entity: 'client_lead',
      entityId: leadId,
      entityName: after.name,
      details: {
        ownerId: after.ownerId,
        creditedTo: creditUserId,
        statusFrom: from || null,
        statusTo: to,
        advancedStatus: true,
      },
    });
    this.logger.log(`LEAD_PROGRESS +1 to user=${creditUserId} by=${actor.id} lead="${after.name}" ${from || '∅'}→${to}`);
  }

  /** Взята ли лидом веха этапа (с учётом старых этапов онбординга). */
  private async milestoneReached(leadId: string | undefined, status: string): Promise<boolean> {
    if (!leadId) return false;
    const eq = milestoneEquivalents(status);
    const rows: any[] = await this.activityRepo.manager.query(
      `SELECT 1 FROM lead_progress
        WHERE lead_id = $1::uuid AND delta > 0
          AND ((status_to = ANY($2::text[]) AND status_from IS DISTINCT FROM status_to)
            OR (stage_to = ANY($3::text[]) AND stage_from IS DISTINCT FROM stage_to))
        LIMIT 1`,
      [leadId, eq.statuses, eq.stages],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  // ─── Чтение ───────────────────────────────────────────────────────────

  /** Лид с владельцем — только id и имя пользователя (15.11.2026): раньше
   *  в каждом лиде уходила вся карточка пользователя (почта, роль, …). */
  private leadQuery(): SelectQueryBuilder<ClientLead> {
    return this.repo.createQueryBuilder('c')
      .leftJoin('c.owner', 'owner')
      .addSelect(['owner.id', 'owner.name']);
  }

  /** owner в ответе — { id, name } | null (SALES_SPEC §2). */
  private present(lead: ClientLead): ClientLead {
    const o: any = (lead as any).owner;
    (lead as any).owner = o && o.id ? { id: o.id, name: o.name ?? '' } : null;
    return lead;
  }

  /** Общие фильтры списков: поиск, направление, интерес, сфера, источник. */
  private applyCommonFilters(
    qb: SelectQueryBuilder<ClientLead>,
    f: { search?: string | null; interest?: string | null; sphere?: string | null; source?: string | null; direction?: string | null },
  ): void {
    if (f.search) {
      qb.andWhere(
        `(c.name ILIKE :s OR c.sphere ILIKE :s OR c.contactPerson ILIKE :s
          OR c.contactInfo ILIKE :s OR c.contactPhone ILIKE :s
          OR c.contactInstagram ILIKE :s OR c.contactEmail ILIKE :s
          OR c.address ILIKE :s)`,
        { s: `%${f.search}%` },
      );
    }
    if (f.interest) qb.andWhere('c.interest::text = :it', { it: f.interest });
    if (f.sphere) qb.andWhere('c.sphere = :sp', { sp: f.sphere });
    if (f.source) qb.andWhere('c.leadSource = :src', { src: f.source });
    // Направление: лиды своего направления + старые лиды без направления.
    if (f.direction) {
      qb.andWhere('(c.direction::text = :dir OR c.direction IS NULL)', { dir: f.direction });
    }
  }

  private applyOwnerFilter(qb: SelectQueryBuilder<ClientLead>, owner: string): void {
    if (owner === 'all') return;
    if (owner === 'none') qb.andWhere('c.ownerId IS NULL');
    else qb.andWhere('c.ownerId = :oid', { oid: owner });
  }

  /** GET /clients — массив до 500 лидов (голосовой помощник, старые экраны). */
  async findAll(f: ListFilters) {
    const qb = this.leadQuery();
    this.applyCommonFilters(qb, f);
    // Устаревший статус в фильтре — вместе с тем, как его показываем.
    if (f.status) qb.andWhere('c.status::text IN (:...st)', { st: statusVariants(String(f.status)) });
    if (f.ownerId) qb.andWhere('c.ownerId = :oid', { oid: f.ownerId });
    qb.orderBy('c.updatedAt', 'DESC');
    // Серверный LIMIT — фронт всё равно пагинирует по 5/10 на страницу,
    // тащить 5+к лидов одним JSON-ом смысла нет: и сервер тормозит,
    // и фронт-парсинг массива замедляет интерактивность.
    qb.limit(500);
    return (await qb.getMany()).map(l => this.present(l));
  }

  /** GET /clients/list (15.11.2026) — серверная пагинация, фильтры и
   *  сортировка по «ближайшему действию» (SALES_SPEC §4). Фильтры due —
   *  те же правила, что matchesDue() в lead-list.ts. */
  async list(query: LeadListQuery, user: LeadUser, direction?: ClientLeadDirection | null): Promise<LeadListPage> {
    const p = parseLeadListQuery(query || {}, { id: user.id, isSales: this.isSalesNotTop(user) });
    const now = new Date();
    const qb = this.leadQuery();
    this.applyCommonFilters(qb, { ...p, direction });
    this.applyOwnerFilter(qb, p.owner);
    if (p.statuses.length) qb.andWhere('c.status::text IN (:...st)', { st: p.statuses });
    if (p.hold !== null) qb.andWhere('c."onHold" = :hold', { hold: p.hold });
    if (p.due) {
      // Дела есть только у активных и не «на паузе» — как в ленте «Сегодня».
      qb.andWhere('c.status::text IN (:...activeSt)', { activeSt: ACTIVE_STATUSES })
        .andWhere('c."onHold" = false');
      if (p.due === 'overdue') {
        qb.andWhere(`${NEXT_ACTION_SQL} < :now`, { now });
      } else if (p.due === 'today') {
        qb.andWhere(`${NEXT_ACTION_SQL} >= :now AND ${NEXT_ACTION_SQL} <= :dayEnd`, {
          now, dayEnd: dushanbeDayEnd(dushanbeDay(now)),
        });
      } else {
        qb.andWhere(`(${LAST_ACTION_SQL} IS NULL OR ${LAST_ACTION_SQL} < :now)`, { now });
      }
    }
    switch (p.sort) {
      case 'updated':
        qb.orderBy('c.updatedAt', 'DESC');
        break;
      case 'created':
        qb.orderBy('c.createdAt', 'DESC');
        break;
      case 'potential':
        qb.orderBy('c.dealPotential', 'DESC', 'NULLS LAST').addOrderBy('c.updatedAt', 'DESC');
        break;
      default:
        qb.addSelect(NEXT_SORT_SQL, 'next_action_at')
          .orderBy('next_action_at', 'ASC', 'NULLS LAST')
          .addOrderBy('c.updatedAt', 'DESC');
    }
    // Связь владельца — многие-к-одному: строки не размножаются, offset/limit
    // безопасны (skip/take TypeORM здесь не нужен).
    qb.addOrderBy('c.id', 'ASC').offset((p.page - 1) * p.pageSize).limit(p.pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map(l => this.present(l)), total, page: p.page, pageSize: p.pageSize };
  }

  /** GET /clients/board (15.11.2026) — все активные лиды для доски + выигранные
   *  и проигранные, изменённые за 30 дней. Без лимита 500 (на доске должны
   *  быть все), но с жёстким пределом 3000. */
  async board(query: { owner?: string; search?: string }, user: LeadUser, direction?: ClientLeadDirection | null) {
    const p = parseLeadListQuery({ owner: query?.owner, search: query?.search }, { id: user.id, isSales: this.isSalesNotTop(user) });
    const qb = this.leadQuery();
    this.applyCommonFilters(qb, { search: p.search, direction });
    this.applyOwnerFilter(qb, p.owner);
    const since = new Date(Date.now() - BOARD_CLOSED_DAYS * 24 * 3600 * 1000);
    qb.andWhere(
      `(c.status::text IN (:...activeSt) OR (c.status::text IN ('won', 'lost') AND c."updatedAt" >= :since))`,
      { activeSt: ACTIVE_STATUSES, since },
    );
    qb.orderBy('c.updatedAt', 'DESC').limit(BOARD_HARD_LIMIT);
    return { items: (await qb.getMany()).map(l => this.present(l)) };
  }

  /** МП (основной или второй ролью), но не руководство — его списки по
   *  умолчанию «Мои». */
  private isSalesNotTop(user: LeadActor): boolean {
    return !!leadDirectionOf(user) && !isLeadTop(user);
  }

  async findOne(id: string, requesterDirection?: ClientLeadDirection) {
    // Не-uuid — «не найдено», а не 500 от Postgres.
    if (!UUID_RE.test(String(id || ''))) throw new NotFoundException('Client lead not found');
    const lead = await this.leadQuery().where('c.id = :id', { id }).getOne();
    if (!lead) throw new NotFoundException('Client lead not found');
    // Лид чужого направления открывать нельзя (старые лиды без направления — можно).
    if (requesterDirection && lead.direction && lead.direction !== requesterDirection) {
      throw new ForbiddenException('Лид не относится к вашему направлению');
    }
    return this.present(lead);
  }

  // ─── Создание ─────────────────────────────────────────────────────────

  /** POST /clients: владелец по правилам (15.11.2026, lead-access.ts).
   *   · МП — себе; другому МП своего направления — можно, «без владельца» — нет;
   *   · руководство — кого укажет (null — лид без владельца), не указал —
   *     себе, как раньше. */
  async createWithAuth(
    dto: Partial<ClientLead> & { force?: boolean },
    user: LeadUser,
    opts: CreateLeadOptions = {},
  ) {
    const top = isLeadTop(user);
    const asked = (dto as any).ownerId as string | null | undefined;
    const ownerId: string | null = top
      ? (asked === undefined ? user.id : asked ?? null)
      : (asked == null ? user.id : asked);
    if (ownerId && ownerId !== user.id) {
      const err = ownerCandidateError(user, await this.ownerCandidate(ownerId), dto.direction ?? null);
      if (err) throw new BadRequestException(err);
    }
    return this.create({ ...dto, ownerId }, ownerId, { id: user.id, name: user.name }, opts);
  }

  /** Создать лид (без проверки прав — их проверяет вызывающий: контроллер
   *  через createWithAuth, Директ — сам). Проверяет этап, причину проигрыша
   *  и дубли (409 { message: 'duplicate', duplicates }, если не force).
   *  Создание продвижения по воронке не даёт (15.11.2026): лид, заведённый
   *  сразу в «КП», — не работа по воронке, а ввод данных. */
  async create(
    dto: Partial<ClientLead> & { force?: boolean },
    ownerId?: string | null,
    actor?: { id: string; name?: string },
    opts: CreateLeadOptions = {},
  ) {
    const {
      force, meetingTaskId: _task, onboardingStage: _stage, id: _id, owner: _owner,
      createdAt: _c, updatedAt: _u, meetingResult: _m, ...clean
    } = (dto || {}) as any;
    const status = (clean.status ?? ClientLeadStatus.NEW) as ClientLeadStatus;
    this.assertSettableStatus(status);
    clean.status = status;
    if (status === ClientLeadStatus.LOST) {
      this.assertLostReason(clean.lostReason, clean.rejectionReason);
    } else {
      clean.lostReason = null;
    }
    const finalOwner: string | null = clean.ownerId !== undefined ? (clean.ownerId ?? null) : (ownerId ?? null);

    if (force !== true && opts.force !== true) {
      const duplicates = await this.findDuplicates({
        name: clean.name, contactPhone: clean.contactPhone, contactInstagram: clean.contactInstagram,
        direction: clean.direction ?? null,
      });
      if (duplicates.length) throw new ConflictException({ message: 'duplicate', duplicates });
    }

    const lead = this.repo.create({ ...clean, ownerId: finalOwner, lastActivityAt: new Date() } as Partial<ClientLead>);
    const saved = await this.repo.save(lead);
    // KPI «Холодные звонки»: если лид создаётся сразу с «Тип звонка =
    // Холодный» — логируем событие холодного звонка.
    if (String(saved.callType || '').toLowerCase() === 'cold' && saved.ownerId) {
      await this.logColdCall(saved.ownerId, saved.id);
    }
    // KPI «Письма» — событие, если лид заведён сразу с «Написал».
    await this.syncLeadEvents(null, saved, actor?.id);
    // Встреча у руководителя-владельца — задача-двойник в «Задачах».
    await this.syncMeetingTask(saved);
    // Лента событий: создан (+ встреча, шаг, письмо, если заведены сразу).
    await this.recordEvent(saved.id, actor?.id, 'created', {
      source: saved.leadSource ?? null,
      direction: saved.direction ?? null,
      via: opts.via ?? 'form',
      status: saved.status,
      ...(saved.onHold ? { onHold: true } : {}),
    });
    await this.logLeadChanges(null, saved, actor?.id);
    // Real-time: всем онлайн-юзерам обновить кэши лидов/KPI.
    try { this.gateway.broadcast('leads:changed', { leadId: saved.id, ownerId: saved.ownerId }); } catch {}
    return this.findOne(saved.id);
  }

  /** Похожие лиды того же направления (SALES_SPEC §4): телефон (9 цифр),
   *  Instagram, название. Лиды без направления — общие, сравниваем с ними
   *  тоже; новый лид без направления сравниваем со всеми. SQL отбирает с
   *  запасом, точное сравнение — lead-duplicates.ts. */
  async findDuplicates(probe: {
    name?: string | null; contactPhone?: string | null; contactInstagram?: string | null; direction?: string | null;
  }, excludeId?: string): Promise<LeadDuplicate[]> {
    const keys = duplicateKeys(probe);
    if (!keys.name && !keys.phone && !keys.instagram) return [];
    let rows: any[] = [];
    try {
      rows = await this.repo.manager.query(
        `SELECT c.id, c.name, c.status::text AS status, c."contactPhone", c."contactInstagram", c."contactInfo",
                u.name AS "ownerName"
           FROM client_leads c
           LEFT JOIN users u ON u.id = c."ownerId"
          WHERE ($1::text IS NULL OR c.direction IS NULL OR c.direction::text = $1)
            AND ($5::uuid IS NULL OR c.id <> $5::uuid)
            AND (
              ($2::text IS NOT NULL AND lower(btrim(regexp_replace(c.name, '[[:space:]]+', ' ', 'g'))) = $2)
              OR ($3::text IS NOT NULL AND (
                   right(regexp_replace(COALESCE(c."contactPhone", ''), '[^0-9]', '', 'g'), 9) = $3
                OR position($3 in regexp_replace(COALESCE(c."contactInfo", ''), '[^0-9]', '', 'g')) > 0))
              OR ($4::text IS NOT NULL AND (
                   position($4 in lower(COALESCE(c."contactInstagram", ''))) > 0
                OR position($4 in lower(COALESCE(c."contactInfo", ''))) > 0))
            )
          ORDER BY c."updatedAt" DESC
          LIMIT 50`,
        [probe.direction ?? null, keys.name, keys.phone, keys.instagram, excludeId ?? null],
      );
    } catch (e: any) {
      // Проверка дублей — подсказка, а не замок: сбой поиска не мешает работе.
      this.logger.warn(`duplicate check failed: ${e?.message || e}`);
      return [];
    }
    return (Array.isArray(rows) ? rows : [])
      .filter(r => isDuplicate(keys, r))
      .slice(0, 10)
      .map(r => ({ id: r.id, name: r.name, status: r.status, ownerName: r.ownerName ?? null }));
  }

  /** Лог события «холодный звонок» (kind='cold_call') в lead_actions.
   *  KPI «Холодные звонки» считает эти события за период. Best-effort. */
  private async logColdCall(userId: string, leadId: string): Promise<void> {
    try {
      // Один холодный звонок по лиду в день на менеджера (15.11.2026):
      // переключение «холодный → нейтральный → холодный» давало +1 за каждый круг.
      await this.repo.manager.query(
        `INSERT INTO lead_actions (user_id, lead_id, kind)
         SELECT $1::uuid, $2::uuid, 'cold_call'
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_actions
           WHERE user_id = $1::uuid AND lead_id = $2::uuid AND kind = 'cold_call'
             AND (created_at AT TIME ZONE 'Asia/Dushanbe')::date = (NOW() AT TIME ZONE 'Asia/Dushanbe')::date)`,
        [userId, leadId],
      );
    } catch (e: any) {
      this.logger.warn(`logColdCall failed: ${e?.message || e}`);
    }
  }

  /** KPI-событие «письмо» по изменению лида (before = null — лид новый).
   *  Встречи отсюда убраны (15.11.2026): назначение встречи в KPI больше
   *  ничего не пишет — lead_actions kind='meeting' пишет SalesService, когда
   *  менеджер отметил «состоялась». Best-effort: ошибка журнала не ломает
   *  сохранение лида. */
  private async syncLeadEvents(
    before: Pick<ClientLead, 'emailStatus'> | null,
    after: Pick<ClientLead, 'id' | 'ownerId' | 'emailStatus'>,
    actorId?: string,
  ): Promise<void> {
    // Письмо — владельцу лида (так считал и старый KPI); у ничьего — автору.
    const emailUser = after.ownerId || actorId;
    if (!emailUser || !emailBecameSent(before, after)) return;
    try {
      // Повторная отметка «Написал» в тот же день письма не добавляет.
      await this.repo.manager.query(
        `INSERT INTO lead_actions (user_id, lead_id, kind)
         SELECT $1::uuid, $2::uuid, 'email'
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_actions
           WHERE lead_id = $2::uuid AND kind = 'email'
             AND (created_at AT TIME ZONE 'Asia/Dushanbe')::date = (NOW() AT TIME ZONE 'Asia/Dushanbe')::date)`,
        [emailUser, after.id],
      );
    } catch (e: any) {
      this.logger.warn(`email event failed: ${e?.message || e}`);
    }
  }

  // ─── Лента событий (lead_events) ──────────────────────────────────────

  /** Запись события; сбой ленты не ломает действие с лидом. */
  private async recordEvent(leadId: string, userId: string | null | undefined, kind: LeadEventKind, data?: Record<string, any> | null) {
    try {
      await recordLeadEvent(this.repo.manager, { leadId, userId: userId ?? null, kind, data: data ?? null });
    } catch (e: any) {
      this.logger.warn(`lead event ${kind} failed: ${e?.message || e}`);
    }
  }

  /** События по разнице «до/после» (SALES_SPEC §3): этап, владелец,
   *  встреча, следующий шаг, пауза, письмо. before = null — лид новый
   *  (тогда пишем только то, что заведено сразу: встречу, шаг, письмо). */
  private async logLeadChanges(before: ClientLead | null, after: ClientLead, actorId?: string): Promise<void> {
    const uid = actorId ?? null;
    if (before) {
      if (after.status !== before.status) {
        await this.recordEvent(after.id, uid, 'stage', {
          from: before.status ?? null,
          to: after.status,
          ...(after.status === ClientLeadStatus.LOST && after.lostReason ? { lostReason: after.lostReason } : {}),
        });
      }
      if ((after.ownerId ?? null) !== (before.ownerId ?? null)) {
        const names = await this.namesOf([before.ownerId, after.ownerId]);
        await this.recordEvent(after.id, uid, 'owner', {
          fromId: before.ownerId ?? null,
          fromName: before.ownerId ? names.get(before.ownerId) ?? null : null,
          toId: after.ownerId ?? null,
          toName: after.ownerId ? names.get(after.ownerId) ?? null : null,
        });
      }
      if (!!after.onHold !== !!before.onHold) {
        await this.recordEvent(after.id, uid, 'hold', { onHold: !!after.onHold });
      }
    }
    const meetingAt = timeOf(after.nextContactAt);
    if (meetingAt !== null && meetingAt !== timeOf(before?.nextContactAt)) {
      await this.recordEvent(after.id, uid, 'meeting_set', { at: new Date(meetingAt).toISOString() });
    }
    const stepText = String(after.nextStep ?? '').trim();
    const stepAt = timeOf(after.nextStepAt);
    const stepChanged = before
      ? stepText !== String(before.nextStep ?? '').trim() || stepAt !== timeOf(before.nextStepAt)
      : !!stepText || stepAt !== null;
    if (stepChanged) {
      await this.recordEvent(after.id, uid, 'next_step', {
        text: stepText || null,
        at: stepAt !== null ? new Date(stepAt).toISOString() : null,
      });
    }
    // «Письмо» — когда «Статус письма» стал «Написал» (форма лида / голос).
    // Письма из шторки «Письмо» пишет SalesService.
    if (emailBecameSent(before, after)) {
      await this.recordEvent(after.id, uid, 'email', { via: 'status' });
    }
  }

  private async namesOf(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    try {
      const users = await this.userRepo.find({ where: { id: In(list) }, select: ['id', 'name'] as any });
      return new Map((users || []).map(u => [u.id, u.name]));
    } catch {
      return new Map();
    }
  }

  // ─── Правка ───────────────────────────────────────────────────────────

  /** Правка без проверки прав (её делает updateWithAuth). Возвращает лид
   *  с owner { id, name }. */
  async update(id: string, dto: Partial<ClientLead>, actorId?: string) {
    const before = await this.repo.findOne({ where: { id } });
    if (!before) throw new NotFoundException('Client lead not found');
    return this.applyUpdate(before, dto, actorId);
  }

  /** Поля, которые API не пишет: служебные и «этап онбординга» (единая
   *  воронка, 15.11.2026). undefined-ключи убираем — их не меняем. */
  private sanitizePatch(dto: Partial<ClientLead>): Record<string, any> {
    const {
      meetingTaskId: _t, onboardingStage: _s, force: _f, id: _id, owner: _o, createdAt: _c, updatedAt: _u,
      ...rest
    } = (dto || {}) as any;
    for (const k of Object.keys(rest)) if (rest[k] === undefined) delete rest[k];
    return rest;
  }

  private async applyUpdate(before: ClientLead, dto: Partial<ClientLead>, actorId?: string) {
    const patch = this.sanitizePatch(dto);
    // Старый текст «Контакты» (импорт, старая форма) правками не затираем
    // (16.11.2026): формы собирали его заново из телефона/Instagram/почты, и
    // всё, чего в этих полях нет (второй номер, заметки), пропадало
    // навсегда. Новые контакты живут в отдельных полях.
    if ('contactInfo' in patch && (before.contactInfo || '').trim()) delete patch.contactInfo;
    // Этап — только из единой воронки; null этапом не бывает.
    if (patch.status === null) delete patch.status;
    if (patch.status !== undefined && patch.status !== before.status) this.assertSettableStatus(patch.status);
    const statusAfter = (patch.status ?? before.status) as string;

    // «Проиграно» — только с причиной (SALES_SPEC §1). Проверяем при входе в
    // lost и при смене причины: правка старого проигранного лида (миграция
    // поставила ему «Другое» без текста) по другим полям не ломается.
    if (statusAfter === ClientLeadStatus.LOST) {
      const entering = before.status !== ClientLeadStatus.LOST;
      const reasonChanged = patch.lostReason !== undefined && patch.lostReason !== before.lostReason;
      if (entering || reasonChanged) {
        this.assertLostReason(
          patch.lostReason !== undefined ? patch.lostReason : before.lostReason,
          patch.rejectionReason !== undefined ? patch.rejectionReason : before.rejectionReason,
        );
      }
    } else if (patch.lostReason != null || before.lostReason != null) {
      // Вернули в работу — код причины больше не про этот лид (текст
      // rejectionReason остаётся как история).
      patch.lostReason = null;
    }

    // Встречу перенесли — итог прежней («состоялась»/«не состоялась») к новой
    // не относится (SALES_SPEC §2). Перенос важнее присланного итога.
    if (patch.nextContactAt !== undefined && timeOf(patch.nextContactAt) !== timeOf(before.nextContactAt)) {
      patch.meetingResult = null;
    }

    if (Object.keys(patch).length) await this.repo.update(before.id, patch as any);
    const after = await this.repo.findOne({ where: { id: before.id } });
    if (!after) throw new NotFoundException('Client lead not found');
    // Задача-двойник встречи руководителя-владельца: создать / обновить / удалить.
    await this.syncMeetingTask(after);
    // KPI: отметка «Написал» — событие в lead_actions.
    await this.syncLeadEvents(before, after, actorId);
    // Лента событий лида.
    await this.logLeadChanges(before, after, actorId);
    return this.findOne(after.id);
  }

  /** Update с проверкой прав (15.11.2026):
   *   · МП правит свои лиды и лиды без владельца своего направления;
   *     руководство — любые;
   *   · смена владельца — по правилам lead-access.ts;
   *   · продвижение по воронке → KPI (вехи). */
  async updateWithAuth(id: string, dto: Partial<ClientLead>, user: LeadUser) {
    const before = await this.repo.findOne({ where: { id } });
    if (!before) throw new NotFoundException('Client lead not found');
    const top = isLeadTop(user);
    if (!top) {
      const myDir = leadDirectionOf(user);
      if (myDir && before.direction && before.direction !== myDir) {
        throw new ForbiddenException('Лид не относится к вашему направлению');
      }
      if (before.ownerId && before.ownerId !== user.id) {
        throw new ForbiddenException('Вы можете редактировать только своих лидов');
      }
    }
    const askedOwner = (dto as any)?.ownerId as string | null | undefined;
    if (askedOwner !== undefined && (askedOwner ?? null) !== (before.ownerId ?? null)) {
      await this.assertOwnerChange(before, askedOwner ?? null, user);
    }
    // Правка менеджером = активность с клиентом.
    const updated = await this.applyUpdate(before, { ...dto, lastActivityAt: new Date() }, user.id);
    // KPI «Холодные звонки»: событие при ПЕРЕХОДЕ «Тип звонка» → Холодный
    // (был не-cold, стал cold). Считаем по событиям, не по состоянию —
    // звонок не пропадёт при последующей смене типа и каждый новый
    // холодный звонок надёжно даёт +1.
    const beforeCold = String(before.callType || '').toLowerCase() === 'cold';
    const afterCold = String(updated.callType || '').toLowerCase() === 'cold';
    if (!beforeCold && afterCold) {
      await this.logColdCall(user.id, id);
    }
    // KPI: продвижение по воронке (только этап — status).
    await this.maybeLogProgress(
      { status: before.status, name: before.name, ownerId: before.ownerId },
      { status: updated.status, name: updated.name, ownerId: updated.ownerId },
      user,
      id,
    );
    // Real-time: KPI «Холодные звонки» и др. пересчитаются у всех онлайн-юзеров.
    try { this.gateway.broadcast('leads:changed', { leadId: id, ownerId: updated.ownerId }); } catch {}
    return updated;
  }

  /** Смена владельца (SALES_SPEC §4): руководство — любой допустимый
   *  владелец или «без владельца»; МП — свой лид другому МП своего
   *  направления, лид без владельца — только себе. */
  private async assertOwnerChange(before: ClientLead, toId: string | null, actor: LeadUser): Promise<void> {
    const top = isLeadTop(actor);
    if (toId === null) {
      if (!top) throw new ForbiddenException('Снять владельца с лида может только руководство');
      return;
    }
    if (!top) {
      if (before.ownerId && before.ownerId !== actor.id) {
        throw new ForbiddenException('Передать можно только своего лида');
      }
      if (!before.ownerId && toId !== actor.id) {
        throw new ForbiddenException('Лид без владельца можно взять только себе');
      }
    }
    const err = ownerCandidateError(actor, await this.ownerCandidate(toId), before.direction ?? null);
    if (err) throw new BadRequestException(err);
  }

  private async ownerCandidate(id: string) {
    if (!UUID_RE.test(String(id || ''))) return null;
    return this.userRepo.findOne({
      where: { id },
      select: ['id', 'name', 'role', 'secondaryRole', 'isActive', 'isBlocked'] as any,
    }).catch(() => null);
  }

  /** POST /clients/:id/claim (15.11.2026) — «Взять себе» лид без владельца
   *  своего направления. Условие ownerId IS NULL — в самом UPDATE: двое
   *  нажали одновременно — лид достанется одному, второй получит 409. */
  async claim(id: string, user: LeadUser) {
    const lead = UUID_RE.test(String(id || '')) ? await this.repo.findOne({ where: { id } }) : null;
    if (!lead) throw new NotFoundException('Client lead not found');
    if (lead.ownerId === user.id) return this.findOne(id);
    if (lead.ownerId) {
      const name = (await this.namesOf([lead.ownerId])).get(lead.ownerId);
      throw new ConflictException(name ? `Лид уже ведёт ${name}` : 'У лида уже есть владелец');
    }
    const top = isLeadTop(user);
    const myDir = leadDirectionOf(user);
    if (!top) {
      if (!myDir) throw new ForbiddenException('Взять лид себе может менеджер продаж');
      if (lead.direction && lead.direction !== myDir) {
        throw new ForbiddenException('Лид не относится к вашему направлению');
      }
    }
    const patch: Partial<ClientLead> = { ownerId: user.id, lastActivityAt: new Date() };
    // Старый лид без направления становится лидом направления того, кто взял.
    if (!lead.direction && myDir) patch.direction = myDir as ClientLeadDirection;
    const res = await this.repo.update({ id, ownerId: IsNull() }, patch as any);
    if (!res?.affected) throw new ConflictException('Лид уже взял другой менеджер');
    const after = await this.repo.findOne({ where: { id } });
    if (after) {
      await this.syncMeetingTask(after);
      await this.logLeadChanges(lead, after, user.id);
    }
    try { this.gateway.broadcast('leads:changed', { leadId: id, ownerId: user.id }); } catch {}
    return this.findOne(id);
  }

  /** «Позвонить»: руководитель отмечает лидов → у менеджера-владельца
   *  задача обзвонить. Ставить (flag=true) может руководство (admin/founder,
   *  основной или второй ролью); снимать (flag=false) — оно же ИЛИ владелец
   *  лида (после звонка). */
  async setCallRequest(
    ids: string[],
    flag: boolean,
    actor: { id: string; role: string; secondaryRole?: string | null; name?: string },
  ) {
    const isBoss = isLeadTop(actor);
    if (flag && !isBoss) {
      throw new ForbiddenException('Назначать звонки может только руководитель');
    }
    const list = await this.repo.find({ where: { id: In(ids || []) } });
    const ownersToNotify = new Set<string>();
    // Разбивка по направлению — чтобы вернуть боссу, какой менеджер получит
    // звонки (СММ-клиента видит СММ-менеджер, Разработку — менеджер разработки).
    const byDirection = { smm: 0, development: 0, none: 0 };
    // Снимать отметку может руководитель, владелец лида ИЛИ любой менеджер для
    // лида без владельца (ничейный звонок виден всем в базе — кто позвонил, тот
    // и снял). Ставить (flag=true) — только босс.
    const eligible = list.filter(lead => (flag ? isBoss : (isBoss || lead.ownerId === actor.id || lead.ownerId == null)));
    const eligibleIds = eligible.map(l => l.id);
    for (const lead of eligible) {
      if (flag) {
        if (lead.direction === ClientLeadDirection.SMM) byDirection.smm++;
        else if (lead.direction === ClientLeadDirection.DEVELOPMENT) byDirection.development++;
        else byDirection.none++;
      }
      if (flag && lead.ownerId) ownersToNotify.add(lead.ownerId);
    }
    // ВАЖНО: обновляем колонки звонка raw-запросом и НЕ трогаем updatedAt —
    // иначе лид всплыл бы наверх списка (сортировка по updatedAt DESC), а нужно,
    // чтобы клиент оставался на своей странице. Полный список отмеченных
    // открывается фильтром «К звонку» на фронте.
    if (eligibleIds.length) {
      await this.repo.query(
        `UPDATE client_leads
           SET "callRequested" = $1,
               "callRequestedAt" = $2,
               "callRequestedByName" = $3
         WHERE id = ANY($4::uuid[])`,
        [
          flag,
          flag ? new Date() : null,
          flag ? (actor.name || 'Руководитель') : null,
          eligibleIds,
        ],
      );
      // «Позвонил» (снятие отметки) = звонок состоялся → активность с клиентом.
      // Обновляем lastActivityAt raw-запросом, не трогая updatedAt (позиция в
      // списке сохраняется).
      if (!flag) {
        await this.repo.query(
          `UPDATE client_leads SET "lastActivityAt" = NOW() WHERE id = ANY($1::uuid[])`,
          [eligibleIds],
        );
      }
    }
    const updated = eligibleIds.length;

    // Уведомляем менеджеров-владельцев о новых звонках от руководителя.
    if (flag) {
      const who = actor.name || 'Руководитель';
      const verb = `отметил${(actor.name || '').endsWith('а') ? 'а' : ''}`;
      for (const ownerId of ownersToNotify) {
        const mine = eligible.filter(l => l.ownerId === ownerId);
        const cnt = mine.length;
        const message = `${who} ${verb} ${cnt} ${cnt === 1 ? 'клиента' : 'клиентов'} для обзвона.`;
        await this.notificationsService.create({
          userId: ownerId,
          type: NotificationType.STATUS_CHANGE,
          title: '📞 Звонки от руководителя',
          message,
          link: '/clients?callRequested=1',
        }).catch(() => {});
        // И в Telegram (15.11.2026): колокольчик в CRM менеджер видит, только
        // когда открыл сайт, а звонить нужно сегодня. sendToUser сам молчит,
        // если бот не привязан или человек в отпуске.
        if (this.telegram) {
          const names = mine.slice(0, 5).map(l => `• ${escapeHtml(l.name)}`).join('\n');
          const more = cnt > 5 ? `\n…и ещё ${cnt - 5}` : '';
          const link = this.telegram.appUrl
            ? `\n\n<a href="${this.telegram.appUrl}/clients?callRequested=1">Открыть список</a>`
            : '';
          await this.telegram
            .sendToUser(ownerId, `📞 <b>Звонки от руководителя</b>\n${escapeHtml(message)}\n\n${names}${more}${link}`)
            .catch(() => undefined);
        }
      }
    }

    try { this.gateway.broadcast('leads:changed', {}); } catch {}
    this.logger.log(
      `setCallRequest by ${actor.role} ${actor.name || ''}: flag=${flag} ids=${(ids || []).length} updated=${updated} byDir=${JSON.stringify(byDirection)}`,
    );
    return { ok: true, updated, byDirection };
  }

  async remove(id: string) {
    const lead = UUID_RE.test(String(id || '')) ? await this.repo.findOne({ where: { id } }) : null;
    if (!lead) throw new NotFoundException('Client lead not found');
    // Если у лида была привязанная задача-встреча — удаляем её тоже.
    if (lead.meetingTaskId) {
      try { await this.taskRepo.delete(lead.meetingTaskId); } catch { /* ignore */ }
    }
    await this.repo.delete(lead.id);
    // Лента удалённого лида никому не нужна (таблица — журнал без внешних
    // ключей, сама не почистится). События KPI (lead_actions) остаются — работа была.
    await this.repo.manager.query(`DELETE FROM lead_events WHERE lead_id = $1::uuid`, [id]).catch(() => undefined);
    try { this.gateway.broadcast('leads:changed', { leadId: id, ownerId: lead.ownerId, deleted: true }); } catch {}
    return { message: 'Lead deleted' };
  }

  /** Remove с проверкой прав (15.11.2026): МП — только свои лиды своего
   *  направления; лиды без владельца — только руководство (раньше любой
   *  МП мог удалить общий лид, который ещё никто не взял). */
  async removeWithAuth(id: string, user: { id: string; role: string; secondaryRole?: string | null }) {
    if (!isLeadTop(user)) {
      const lead = UUID_RE.test(String(id || '')) ? await this.repo.findOne({ where: { id } }) : null;
      if (!lead) throw new NotFoundException('Client lead not found');
      if (!lead.ownerId) {
        throw new ForbiddenException('Лид без владельца может удалить только руководство');
      }
      if (lead.ownerId !== user.id) {
        throw new ForbiddenException('Вы можете удалять только своих лидов');
      }
    }
    return this.remove(id);
  }

  // ─── Проверки ─────────────────────────────────────────────────────────

  private assertSettableStatus(status: unknown): void {
    if (!LEAD_STATUSES_SETTABLE.includes(status as ClientLeadStatus)) {
      throw new BadRequestException('Неизвестный этап воронки');
    }
  }

  /** lost — с кодом причины; «Другое» — ещё и с текстом. */
  private assertLostReason(lostReason: unknown, rejectionReason: unknown): void {
    if (!lostReason || !(LOST_REASONS as readonly string[]).includes(String(lostReason))) {
      throw new BadRequestException('Укажите причину проигрыша');
    }
    if (lostReason === 'other' && !String(rejectionReason ?? '').trim()) {
      throw new BadRequestException('Опишите причину проигрыша');
    }
  }

  // ─── KPI ──────────────────────────────────────────────────────────────

  /**
   * KPI менеджера продаж за период (честный счёт, 14.11.2026).
   * Норма = дневная × рабочие дни (пн–сб по Душанбе), которые уже наступили,
   * без отпуска и отметок табеля; будущее не считаем. Дневные нормы — из
   * настроек продаж по направлению менеджера (15.11.2026, sales_settings;
   * нет настроек — по умолчанию). Факт — события:
   *  - продвижения по воронке — SUM(delta) из lead_progress;
   *  - новые компании — лиды, заведённые в периоде;
   *  - звонки — события lead_actions «cold_call»;
   *  - персональные письма — события «email»;
   *  - встречи — события «meeting»: менеджер отметил «состоялась»
   *    (пишет SalesService; назначение встречи в KPI ничего не даёт).
   * Правила нормы и общего процента — sales-kpi.logic.ts.
   */
  async kpi(ownerId: string, direction?: ClientLeadDirection, from?: string, to?: string) {
    const now = new Date();
    const p = salesPeriod(from, to, now);
    const base = () => {
      const qb = this.repo.createQueryBuilder('c').where('c.ownerId = :oid', { oid: ownerId });
      if (direction) qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: direction });
      return qb;
    };
    const safeCount = async (build: () => Promise<number>) => {
      try { return await build(); } catch { return 0; }
    };
    const countActions = (kind: string, column: string) => safeCount(async () => {
      const rows = await this.repo.manager.query(
        `SELECT COUNT(*)::int AS c FROM lead_actions
         WHERE user_id = $1 AND kind = $2 AND ${column} BETWEEN $3 AND $4`,
        [ownerId, kind, p.start, p.until],
      );
      return Number(rows?.[0]?.c || 0);
    });

    // Счётчики друг от друга не зависят — считаем разом. Всё — с начала
    // первого дня по Душанбе до min(конец периода, сейчас).
    const [settings, off, newCompanies, coldCalls, personalEmails, meetings, progressCount] = await Promise.all([
      loadSalesSettings(this.repo.manager),
      this.offDays(ownerId, p.fromIso, p.countedToIso, p.todayIso),
      safeCount(() => base()
        .andWhere('c.createdAt BETWEEN :from AND :to', { from: p.start, to: p.until })
        .getCount()),
      // «Звонки» — только события. Счёт по состоянию (callType=cold
      // и правка лида в периоде) остался лишь для периодов, целиком
      // закончившихся до появления событий: иначе прошлые месяцы обнулились
      // бы. В новых периодах он давал звонки без звонков — правку лида.
      p.toIso < COLD_CALL_EVENTS_SINCE
        ? safeCount(() => base()
          .andWhere(`LOWER(COALESCE(c."callType", '')) = 'cold'`)
          .andWhere('c.updatedAt BETWEEN :from AND :to', { from: p.start, to: p.until })
          .getCount())
        : countActions('cold_call', 'created_at'),
      // «Персональные письма» — событие на отметке «Написал».
      countActions('email', 'created_at'),
      // «Встречи» — отмеченные «состоялась»: at = момент отметки (SalesService).
      // Без at (старая запись) — по времени записи.
      countActions('meeting', 'COALESCE("at", created_at)'),
      // Чистый прогресс по воронке: +1 вперёд, −1 назад.
      this.funnelProgress(ownerId, p.start, p.until),
    ]);

    const workDays = workingDays(p.fromIso, p.toIso, p.todayIso, off).length;
    const result = buildSalesKpi({
      funnel_progress: progressCount,
      new_companies: newCompanies,
      cold_calls: coldCalls,
      personal_emails: personalEmails,
      meetings,
    }, workDays, normsFor(settings, direction));
    return {
      periodFrom: p.start.toISOString(),
      periodTo: p.end.toISOString(),
      ...result,
    };
  }

  /** Продвижения по воронке за период: SUM(delta) из lead_progress. Счёт
   *  по activity_logs — только если lead_progress недоступна (запрос упал):
   *  откатов там нет, и ноль в таблице — не повод брать завышенную цифру. */
  private async funnelProgress(userId: string, from: Date, to: Date): Promise<number> {
    try {
      const rows = await this.activityRepo.manager.query(
        `SELECT COALESCE(SUM(delta), 0)::int AS s FROM lead_progress
         WHERE user_id = $1 AND created_at BETWEEN $2 AND $3`,
        [userId, from, to],
      );
      return Math.max(0, Number(rows?.[0]?.s || 0));
    } catch (e: any) {
      this.logger.warn(`lead_progress KPI query failed: ${e?.message || e}`);
      return this.activityRepo
        .createQueryBuilder('a')
        .where('a.userId = :uid', { uid: userId })
        .andWhere('a.action = :act', { act: ActivityAction.LEAD_PROGRESS })
        .andWhere('a.createdAt BETWEEN :from AND :to', { from, to })
        .getCount()
        .catch(() => 0);
    }
  }

  /** Дни, когда менеджера нет на работе: отметки табеля (отпуск, отгул,
   *  больничный, праздник — shift_absences по userId) и отпуска из карточки
   *  сотрудника (employee_vacations и текущий статус «В отпуске»). Каждый
   *  источник отдельно: нет таблицы — считаем без него.
   *  Текущий статус без даты «с» — отпуск с сегодняшнего дня (15.11.2026):
   *  раньше он превращал весь прошлый период в выходные. */
  private async offDays(userId: string, fromIso: string, toIso: string, todayIso: string = dushanbeDay()): Promise<Set<string>> {
    if (fromIso > toIso) return new Set();
    const q = (sql: string, params: unknown[]): Promise<any[]> =>
      this.repo.manager.query(sql, params).catch(() => []);
    const [absences, vacations, current] = await Promise.all([
      q(`SELECT to_char(date, 'YYYY-MM-DD') AS day FROM shift_absences
         WHERE "employeeId"::text = $1 AND date BETWEEN $2::date AND $3::date`, [userId, fromIso, toIso]),
      q(`SELECT to_char("dateFrom", 'YYYY-MM-DD') AS "from", to_char("dateUntil", 'YYYY-MM-DD') AS until
         FROM employee_vacations
         WHERE "userId"::text = $1 AND "dateFrom" <= $3::date AND "dateUntil" >= $2::date`, [userId, fromIso, toIso]),
      q(`SELECT to_char("vacationFrom", 'YYYY-MM-DD') AS "from", to_char("vacationUntil", 'YYYY-MM-DD') AS until
         FROM employees WHERE "userId"::text = $1 AND status::text = 'vacation'`, [userId]),
    ]);
    return new Set([
      ...(absences || []).map(r => String(r.day)),
      ...expandRanges([...(vacations || []), ...(current || []).map(r => currentVacationRange(r, todayIso))], fromIso, toIso),
    ]);
  }

  /** Счётчики шапки страницы «Клиенты».
   *  openPotential — потенциал открытых сделок: без выигранных и проигранных
   *  (15.11.2026: выигранные — уже не «потенциал», а деньги проекта).
   *  forecast — прогноз: Σ потенциал × вероятность (своя или по этапу) / 100
   *  по активным этапам new…contract, кроме «на паузе». */
  async stats(direction?: ClientLeadDirection) {
    // Условие направления: свои лиды + старые без направления.
    const dirSql = '(c.direction = :dir OR c.direction IS NULL)';

    const statusQb = this.repo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status');
    if (direction) statusQb.where(dirSql, { dir: direction });
    const statusRows = await statusQb.getRawMany();
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = Number(r.count);

    const interestQb = this.repo
      .createQueryBuilder('c')
      // c.interest — Postgres enum. COALESCE требует одинаковых типов,
      // и 'none' НЕ существует в enum'е → каст в text спасает.
      .select('COALESCE(c.interest::text, \'none\')', 'interest')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.interest');
    if (direction) interestQb.where(dirSql, { dir: direction });
    const interestRows = await interestQb.getRawMany();
    const byInterest: Record<string, number> = {};
    for (const r of interestRows) byInterest[r.interest] = Number(r.count);

    const potentialQb = this.repo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.dealPotential), 0)', 'total')
      .where('c.status::text NOT IN (:...closed)', { closed: [ClientLeadStatus.WON, ClientLeadStatus.LOST] });
    if (direction) potentialQb.andWhere(dirSql, { dir: direction });
    const totalPotentialRow = await potentialQb.getRawOne();

    // Вероятность по этапу — из STAGE_PROBABILITY (наши константы, не ввод).
    const stageProbability = `CASE c.status::text ${Object.entries(STAGE_PROBABILITY)
      .map(([s, pct]) => `WHEN '${s}' THEN ${Number(pct) || 0}`).join(' ')} ELSE 0 END`;
    const forecastQb = this.repo
      .createQueryBuilder('c')
      .select(`COALESCE(SUM(COALESCE(c.dealPotential, 0) * COALESCE(c.probability, ${stageProbability}) / 100.0), 0)`, 'forecast')
      .where('c.status::text IN (:...forecastSt)', {
        forecastSt: ACTIVE_STATUSES.filter(s => s !== ClientLeadStatus.ON_HOLD),
      })
      .andWhere('c."onHold" = false');
    if (direction) forecastQb.andWhere(dirSql, { dir: direction });
    const forecastRow = await forecastQb.getRawOne().catch((e: any) => {
      this.logger.warn(`forecast query failed: ${e?.message || e}`);
      return null;
    });

    const openPotential = Number(totalPotentialRow?.total || 0);
    return {
      byStatus,
      byInterest,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      openPotential,
      // Двойник под именем из frontend/src/types/sales.ts (LeadStats).
      totalPotential: openPotential,
      forecast: Math.round(Number(forecastRow?.forecast || 0)),
    };
  }

  // ─── Задача-двойник встречи в «Задачах» ──────────────────────────────
  /** Встреча лида, которого ведёт НЕ менеджер продаж (руководитель), —
   *  личная задача владельцу на время встречи: она видна в «Задачах» и
   *  напоминает сама (lead-agenda такие встречи пропускает).
   *
   *  Logic:
   *   - менеджер продаж — задач не создаём (видит встречи в Календаре и
   *     «Сегодня»; задача становилась ложной «просрочкой»);
   *   - нет владельца, сделка закрыта (won/lost), «на паузе», встречи нет
   *     или по ней уже есть итог — задачу удаляем;
   *   - есть встреча → задача на её время; имя и контакты синхронизируются.
   *  «Новый лид: …» (follow-up без встречи) больше не создаём (15.11.2026):
   *  основатель, заводя лид для менеджера, получал себе пустую задачу.
   *
   *  Best-effort: ошибки логируются, CRUD клиента не валится. */
  private async syncMeetingTask(lead: ClientLead): Promise<void> {
    try {
      const dropTwin = async () => {
        if (!lead.meetingTaskId) return;
        await this.taskRepo.delete(lead.meetingTaskId).catch(() => {});
        await this.repo.update(lead.id, { meetingTaskId: null });
      };
      if (!lead.ownerId) return dropTwin();

      const owner = await this.userRepo.findOne({
        where: { id: lead.ownerId },
        select: ['id', 'role', 'secondaryRole'] as any,
      }).catch(() => null);
      // МП — по основной или второй роли (15.11.2026).
      if (owner && salesRoleOf(owner as any)) return dropTwin();

      const isClosed = lead.status === ClientLeadStatus.WON || lead.status === ClientLeadStatus.LOST;
      if (isClosed || lead.onHold || !lead.nextContactAt || lead.meetingResult) return dropTwin();

      // Точное время nextContactAt. Если пришла голая дата (полночь) —
      // ставим 12:00 по Душанбе (15.11.2026: setHours на сервере в UTC
      // ставил 17:00 по Душанбе). Голая дата — это полночь UTC (строка
      // 'YYYY-MM-DD') или полночь по Душанбе (дата из браузера).
      let deadline = new Date(lead.nextContactAt);
      const utcMidnight = deadline.getUTCHours() === 0 && deadline.getUTCMinutes() === 0;
      const localDay = dushanbeDay(deadline);
      const localMidnight = deadline.getTime() === new Date(`${localDay}T00:00:00+05:00`).getTime();
      if (utcMidnight || localMidnight) {
        const day = utcMidnight ? deadline.toISOString().slice(0, 10) : localDay;
        deadline = new Date(`${day}T12:00:00+05:00`);
      }
      const title = `Встреча с клиентом: ${lead.name}`;
      const description = this.buildMeetingTaskDescription(lead);

      if (lead.meetingTaskId) {
        const exists = await this.taskRepo.findOne({ where: { id: lead.meetingTaskId } });
        if (exists) {
          // originStage — от «этапа онбординга» (скрывал КП-задачи из
          // календаря); онбординга больше нет — сбрасываем.
          await this.taskRepo.update(lead.meetingTaskId, {
            title, description, assigneeId: lead.ownerId, originStage: null, deadline,
          });
          return;
        }
      }

      const created = this.taskRepo.create({
        title,
        description,
        deadline,
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.NEW,
        scope: TaskScope.PERSONAL,
        originStage: null,
        createdById: lead.ownerId,
        assigneeId: lead.ownerId,
      });
      const saved = await this.taskRepo.save(created);
      await this.repo.update(lead.id, { meetingTaskId: saved.id });
    } catch (err: any) {
      // Не валим CRUD клиента из-за проблем с авто-задачей.
      this.logger.warn(`syncMeetingTask failed: ${err?.message || err}`);
    }
  }

  private buildMeetingTaskDescription(lead: ClientLead): string {
    const lines: string[] = [];
    if (lead.sphere) lines.push(`Сфера: ${lead.sphere}`);
    if (lead.contactPerson) lines.push(`ЛПР: ${lead.contactPerson}`);
    if (lead.contactPhone)     lines.push(`Телефон: ${lead.contactPhone}`);
    if (lead.contactInstagram) lines.push(`Instagram: ${lead.contactInstagram}`);
    if (lead.contactEmail)     lines.push(`Email: ${lead.contactEmail}`);
    // Старое поле — для тех лидов, которые ещё не переразложили.
    if (lead.contactInfo && !lead.contactPhone && !lead.contactInstagram && !lead.contactEmail) {
      lines.push(`Контакты: ${lead.contactInfo}`);
    }
    if (lead.problem) lines.push(`Задача: ${lead.problem}`);
    if (lead.channel) lines.push(`Канал: ${lead.channel}`);
    if (lead.nextStep) lines.push(`Следующий шаг: ${lead.nextStep}`);
    return lines.join('\n');
  }
}
