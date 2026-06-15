import { Injectable, NotFoundException, ForbiddenException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClientLead, ClientLeadStatus, ClientLeadInterest, ClientLeadDirection } from './client-lead.entity';
import { Task, TaskScope, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { User, UserRole } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction, ActivityLog } from '../activity-log/activity-log.entity';
import { AppGateway } from '../gateway/app.gateway';

/** Роли менеджеров продаж — для bulk-KPI и фильтров. */
const SALES_MANAGER_ROLES = [UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV];

/** Соответствие роли МП → направление лидов. */
const ROLE_TO_DIRECTION: Record<string, ClientLeadDirection> = {
  [UserRole.SALES_MANAGER_SMM]: ClientLeadDirection.SMM,
  [UserRole.SALES_MANAGER_DEV]: ClientLeadDirection.DEVELOPMENT,
};

/** Порядок продвижения лида по статусу — для подсчёта «прогрессий вперёд». */
const STATUS_ORDER: Record<string, number> = {
  new:         0,
  waiting:     1,
  negotiating: 2,
  proposal:    3,
  won:         4,
  // терминальные — не считаются прогрессом
  lost:        -1,
  on_hold:     -1,
};

/** Порядок этапов онбординга. cancelled = -1 значит «отмена не считается
 *  прогрессом» — KPI менеджеру за переход в эту колонку не начисляется. */
const STAGE_ORDER: Record<string, number> = {
  negotiation:    1,
  meeting:        2,
  kp_creation:    3,
  contract:       4,
  implementation: 5,
  cancelled:      -1,
};

export interface ListFilters {
  search?: string;
  status?: ClientLeadStatus;
  interest?: ClientLeadInterest;
  sphere?: string;
  ownerId?: string;
  source?: string;
  /** Направление МП — лиды чужого направления скрываются. */
  direction?: ClientLeadDirection;
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
  ) {}

  /** На старте гарантируем оба пути учёта прогрессий по воронке:
   *   1) ALTER TYPE ... ADD VALUE IF NOT EXISTS 'LEAD_PROGRESS' для
   *      activity_logs (старый путь);
   *   2) CREATE TABLE IF NOT EXISTS lead_progress — отдельная таблица
   *      БЕЗ enum-зависимостей. KPI читает в первую очередь отсюда.
   *      Идемпотентно, не требует миграции, гарантированно работает. */
  async onModuleInit() {
    try {
      await this.activityRepo.manager.query(
        `ALTER TYPE "activity_logs_action_enum" ADD VALUE IF NOT EXISTS 'LEAD_PROGRESS'`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TYPE for LEAD_PROGRESS failed: ${e?.message || e}`);
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
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE client_leads callType failed: ${e?.message || e}`);
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
  }

  /** Лёгкий lookup юзера по id — для controller'а чтобы определить
   *  направление КПИ. Возвращаем только нужные поля. */
  async findOwnerInfo(userId: string): Promise<{ id: string; name: string; role: string } | null> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) return null;
    return { id: u.id, name: u.name, role: u.role };
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

  /** Если статус ИЛИ этап онбординга у лида сдвинулись — пишем событие
   *  LEAD_PROGRESS с дельтой +1 (вперёд) или -1 (назад). KPI «Продвижения
   *  по воронке» считает SUM(delta), а не COUNT — иначе можно «накручивать»
   *  KPI, гоняя один лид взад-вперёд. cancelled — не считается ни тем, ни
   *  тем (STAGE_ORDER=-1 → ни forward, ни backward). */
  private async maybeLogProgress(
    before: { status?: string | null; onboardingStage?: string | null; name?: string; ownerId?: string | null },
    after: { status?: string | null; onboardingStage?: string | null; name?: string; ownerId?: string | null },
    actor: { id: string; name?: string },
    leadId?: string,
  ): Promise<void> {
    // Хелпер: считаем дельту по двум значениям order'а. Только если ОБА
    // валидные (>0) — иначе игнорируем (cancelled / lost / on_hold).
    const deltaOf = (toOrder: number | undefined, fromOrder: number | undefined): 0 | 1 | -1 => {
      const t = toOrder ?? 0;
      const f = fromOrder ?? 0;
      // cancelled/lost/on_hold == -1 → не учитываем переходы в них.
      if (t <= 0) return 0;
      // Из «нулевого» состояния (создание лида с уже выставленным этапом)
      // в реальный этап = +1.
      if (t > f) return 1;
      if (t < f && f > 0) return -1;
      return 0;
    };
    const statusChanged = after.status && after.status !== before.status;
    const stageChanged  = after.onboardingStage && after.onboardingStage !== before.onboardingStage;
    const statusDelta = statusChanged
      ? deltaOf(STATUS_ORDER[after.status as string], STATUS_ORDER[before.status || ''])
      : 0;
    const stageDelta = stageChanged
      ? deltaOf(STAGE_ORDER[after.onboardingStage as string], STAGE_ORDER[before.onboardingStage || ''])
      : 0;
    // Берём ту дельту, что не ноль. Если оба сдвинулись в одну сторону —
    // считаем как один шаг (одна запись), чтобы не задвоить.
    const delta = stageDelta !== 0 ? stageDelta : statusDelta;
    if (delta === 0) return;

    // ─── Первичный путь: lead_progress (без enum-зависимостей) ─────────
    try {
      await this.activityRepo.manager.query(
        `INSERT INTO lead_progress
           (user_id, lead_id, lead_name, stage_from, stage_to, status_from, status_to, delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          actor.id,
          leadId || null,
          after.name || null,
          before.onboardingStage || null,
          after.onboardingStage || null,
          before.status || null,
          after.status || null,
          delta,
        ],
      );
    } catch (e: any) {
      this.logger.error(`lead_progress insert failed: ${e?.message || e}`);
    }

    // На уровне entity-флагов — что произошло, для legacy activity_logs.
    const advancedStatus = statusDelta > 0;
    const advancedStage = stageDelta > 0;

    // Legacy activity_logs: пишем ТОЛЬКО при движении вперёд (delta > 0).
    // Backward в activity_logs не пишем — там схема не позволяет хранить
    // знак, и KPI с этого источника считается COUNT (получили бы задвоение).
    if (delta > 0) {
      await this.activityLog.log({
        userId: actor.id,
        userName: actor.name,
        action: ActivityAction.LEAD_PROGRESS,
        entity: 'client_lead',
        entityId: undefined,
        entityName: after.name,
        details: {
          ownerId: after.ownerId,
          statusFrom: before.status ?? null,
          statusTo: after.status ?? null,
          stageFrom: before.onboardingStage ?? null,
          stageTo: after.onboardingStage ?? null,
          advancedStatus: !!advancedStatus,
          advancedStage: !!advancedStage,
        },
      });
    }
    this.logger.log(
      `LEAD_PROGRESS (delta=${delta}) by user=${actor.id} lead="${after.name}" ` +
      `${before.onboardingStage ?? '∅'}→${after.onboardingStage ?? '∅'} / ` +
      `${before.status ?? '∅'}→${after.status ?? '∅'}`,
    );
  }

  async findAll(f: ListFilters) {
    const qb = this.repo.createQueryBuilder('c')
      .leftJoinAndSelect('c.owner', 'owner');
    if (f.search) {
      qb.andWhere(
        `(c.name ILIKE :s OR c.sphere ILIKE :s OR c.contactPerson ILIKE :s
          OR c.contactInfo ILIKE :s OR c.contactPhone ILIKE :s
          OR c.contactInstagram ILIKE :s OR c.contactEmail ILIKE :s
          OR c.address ILIKE :s)`,
        { s: `%${f.search}%` },
      );
    }
    if (f.status) qb.andWhere('c.status = :st', { st: f.status });
    if (f.interest) qb.andWhere('c.interest = :it', { it: f.interest });
    if (f.sphere) qb.andWhere('c.sphere = :sp', { sp: f.sphere });
    if (f.ownerId) qb.andWhere('c.ownerId = :oid', { oid: f.ownerId });
    if (f.source) qb.andWhere('c.leadSource = :src', { src: f.source });
    // Направление: лиды своего направления + старые лиды без направления.
    if (f.direction) {
      qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: f.direction });
    }
    qb.orderBy('c.updatedAt', 'DESC');
    // Серверный LIMIT — фронт всё равно пагинирует по 5/10 на страницу,
    // тащить 5+к лидов одним JSON-ом смысла нет: и сервер тормозит,
    // и фронт-парсинг массива замедляет интерактивность.
    qb.limit(500);
    return qb.getMany();
  }

  async findOne(id: string, requesterDirection?: ClientLeadDirection) {
    const lead = await this.repo.findOne({ where: { id }, relations: ['owner'] });
    if (!lead) throw new NotFoundException('Client lead not found');
    // Лид чужого направления открывать нельзя (старые лиды без направления — можно).
    if (requesterDirection && lead.direction && lead.direction !== requesterDirection) {
      throw new ForbiddenException('Лид не относится к вашему направлению');
    }
    return lead;
  }

  async create(
    dto: Partial<ClientLead>,
    ownerId?: string,
    actor?: { id: string; name?: string },
  ) {
    const lead = this.repo.create({ ...dto, ownerId: dto.ownerId ?? ownerId });
    const saved = await this.repo.save(lead);
    // Если при создании указана дата встречи — авто-генерируем личную задачу.
    await this.syncMeetingTask(saved);
    // KPI: если лид создаётся СРАЗУ с продвинутым статусом или onboardingStage
    // (например, МП имел холодный звонок и заводит клиента уже в «negotiating»
    // или с этапом «meeting» в онбординге) — это тоже прогресс. Логируем как
    // переход из «пустого» состояния → текущего.
    if (actor) {
      await this.maybeLogProgress(
        { status: null, onboardingStage: null, name: saved.name, ownerId: saved.ownerId },
        { status: saved.status, onboardingStage: saved.onboardingStage, name: saved.name, ownerId: saved.ownerId },
        actor,
        saved.id,
      );
    }
    // Real-time: всем онлайн-юзерам обновить кэши лидов/KPI.
    try { this.gateway.broadcast('leads:changed', { leadId: saved.id, ownerId: saved.ownerId }); } catch {}
    return this.findOne(saved.id);
  }

  async update(id: string, dto: Partial<ClientLead>) {
    const existing = await this.findOne(id);
    // meetingTaskId — внутреннее поле, выставляется только сервером.
    const { meetingTaskId: _ignored, ...safe } = dto as any;
    await this.repo.update(id, safe);
    const updated = await this.findOne(id);
    // Авто-синхронизация задачи-встречи: создать / обновить / удалить
    // в зависимости от изменений nextContactAt, name, onboardingStage.
    await this.syncMeetingTask(updated, existing);
    return this.findOne(updated.id);
  }

  /** Update с ownership-проверкой. Менеджер продаж может править ТОЛЬКО
   *  свои лиды. Админ/основатель/сооснователь — любые.
   *  Дополнительно логирует прогрессии воронки в activity_log → KPI. */
  async updateWithAuth(
    id: string,
    dto: Partial<ClientLead>,
    user: { id: string; role: string; name?: string },
  ) {
    const isAdmin = ['admin', 'founder', 'co_founder'].includes(user.role);
    const before = await this.repo.findOne({ where: { id } });
    if (!before) throw new NotFoundException('Client lead not found');
    if (!isAdmin && before.ownerId && before.ownerId !== user.id) {
      throw new ForbiddenException('Вы можете редактировать только своих лидов');
    }
    const updated = await this.update(id, dto);
    // KPI: лог прогрессий вперёд по status / onboardingStage.
    await this.maybeLogProgress(
      { status: before.status, onboardingStage: before.onboardingStage, name: before.name, ownerId: before.ownerId },
      { status: updated.status, onboardingStage: updated.onboardingStage, name: updated.name, ownerId: updated.ownerId },
      user,
      id,
    );
    // Real-time: KPI «Холодные звонки» и др. пересчитаются у всех онлайн-юзеров.
    try { this.gateway.broadcast('leads:changed', { leadId: id, ownerId: updated.ownerId }); } catch {}
    return updated;
  }

  async remove(id: string) {
    const lead = await this.findOne(id);
    // Если у лида была привязанная задача-встреча — удаляем её тоже.
    if (lead.meetingTaskId) {
      try { await this.taskRepo.delete(lead.meetingTaskId); } catch { /* ignore */ }
    }
    await this.repo.remove(lead);
    try { this.gateway.broadcast('leads:changed', { leadId: id, ownerId: lead.ownerId, deleted: true }); } catch {}
    return { message: 'Lead deleted' };
  }

  /** Remove с ownership-проверкой. */
  async removeWithAuth(id: string, user: { id: string; role: string }) {
    const isAdmin = ['admin', 'founder', 'co_founder'].includes(user.role);
    if (!isAdmin) {
      const lead = await this.repo.findOne({ where: { id } });
      if (!lead) throw new NotFoundException('Client lead not found');
      if (lead.ownerId && lead.ownerId !== user.id) {
        throw new ForbiddenException('Вы можете удалять только своих лидов');
      }
    }
    return this.remove(id);
  }

  /**
   * KPI менеджера продаж за период.
   * Wave 11: ключевая метрика — «прогрессии воронки», т.е. сколько раз МП
   * сдвинул лидов на шаг вперёд по status или onboardingStage. Считается
   * из activity_logs (action = LEAD_PROGRESS).
   *
   * Дополнительные показатели остаются для контекста:
   *  - новые компании в базе (createdAt в окне)
   *  - холодные звонки (channel ∈ call/whatsapp/telegram, updatedAt в окне)
   *  - персональные письма (channel=email или есть contactEmail, lastContactAt)
   *  - встречи / созвоны (nextContactAt в окне периода = в день встречи)
   */
  async kpi(ownerId: string, direction?: ClientLeadDirection, from?: string, to?: string) {
    // Окно по умолчанию — сегодняшний день. Если переданы from/to (YYYY-MM-DD),
    // считаем за указанный интервал. Конец дня всегда захватываем целиком.
    const today = new Date();
    const parseLocalDate = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };
    const periodFrom = from ? parseLocalDate(from) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    periodFrom.setHours(0, 0, 0, 0);
    const periodTo = to ? parseLocalDate(to) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    periodTo.setHours(23, 59, 59, 999);
    const base = () => {
      const qb = this.repo.createQueryBuilder('c').where('c.ownerId = :oid', { oid: ownerId });
      if (direction) qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: direction });
      return qb;
    };

    const safeCount = async (build: () => Promise<number>) => {
      try { return await build(); } catch { return 0; }
    };

    const newCompanies = await safeCount(() => base()
      .andWhere('c.createdAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    // «Холодные звонки» — теперь считаются по ЯВНОМУ полю callType='cold',
    // которое менеджер выбирает в форме клиента селектом «Тип звонка»
    // (Холодный / Нейтральный / Горячий). Это точная цифра, а не эвристика
    // по каналу. updatedAt в окне — значит менеджер «трогал» лида в периоде.
    const coldCalls = await safeCount(() => base()
      .andWhere(`LOWER(COALESCE(c."callType", '')) = 'cold'`)
      .andWhere('c.updatedAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    // «Персональные письма» — теперь считаются по ЯВНОМУ полю
    // emailStatus='sent' («Написал»), которое менеджер выбирает в форме
    // клиента селектом «Письмо». updatedAt в окне — менеджер «трогал»
    // лида в этом периоде. Точная цифра вместо эвристики по channel/email.
    const personalEmails = await safeCount(() => base()
      .andWhere(`LOWER(COALESCE(c."emailStatus", '')) = 'sent'`)
      .andWhere('c.updatedAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    // Встречи засчитываются в KPI того ДНЯ, на который они назначены:
    // nextContactAt попадает в выбранное окно [periodFrom, periodTo].
    // (Раньше был «горизонт +14 дней» — будущие встречи капали в KPI
    //  сегодняшнего дня; теперь привязка строго к дате встречи.)
    const meetings = await safeCount(() => base()
      .andWhere('c.nextContactAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    // Главная метрика: чистый прогресс по воронке.
    // Источник №1 (первичный) — SUM(delta) из lead_progress: +1 forward,
    // -1 backward. Менеджер не может «накручивать», гоняя лид взад-вперёд.
    // Источник №2 (fallback) — COUNT из activity_logs, только если в
    // lead_progress 0 (миграция не прошла / новый деплой ещё не подхватился).
    const progressFromTable = await safeCount(async () => {
      const rows = await this.activityRepo.manager.query(
        `SELECT COALESCE(SUM(delta), 0)::int AS s FROM lead_progress
         WHERE user_id = $1 AND created_at BETWEEN $2 AND $3`,
        [ownerId, periodFrom, periodTo],
      );
      return Math.max(0, Number(rows?.[0]?.s || 0));
    });
    const progressFromActivity = await safeCount(() =>
      this.activityRepo
        .createQueryBuilder('a')
        .where('a.userId = :uid', { uid: ownerId })
        .andWhere('a.action = :act', { act: ActivityAction.LEAD_PROGRESS })
        .andWhere('a.createdAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
        .getCount(),
    );
    const progressCount = progressFromTable > 0 ? progressFromTable : progressFromActivity;

    const items = [
      { key: 'funnel_progress', label: 'Продвижения по воронке',  target: 20, value: progressCount },
      { key: 'new_companies',   label: 'Новые компании в базе',   target: 30, value: newCompanies },
      { key: 'cold_calls',      label: 'Холодные звонки',         target: 10, value: coldCalls },
      { key: 'personal_emails', label: 'Персональные письма',     target: 10, value: personalEmails },
      { key: 'meetings',        label: 'Встречи / созвоны',       target: 2,  value: meetings },
    ].map(i => ({
      ...i,
      percent: i.target > 0 ? Math.min(100, Math.round((i.value / i.target) * 100)) : 0,
      done: i.value >= i.target,
    }));

    const overall = Math.round(items.reduce((acc, i) => acc + (i.value / i.target) * 100, 0) / items.length);
    return {
      periodFrom: periodFrom.toISOString(),
      periodTo: periodTo.toISOString(),
      overallPercent: Math.min(100, Math.max(0, overall)),
      items,
    };
  }

  /** Aggregated counters for the Clients page header */
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
      .where('c.status NOT IN (:...bad)', { bad: ['lost'] });
    if (direction) potentialQb.andWhere(dirSql, { dir: direction });
    const totalPotentialRow = await potentialQb.getRawOne();

    return {
      byStatus,
      byInterest,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      openPotential: Number(totalPotentialRow?.total || 0),
    };
  }

  // ─── Авто-синхронизация задачи в Календаре МП ────────────────────────
  /** Поддерживает 1:1 связь между ClientLead и личной задачей менеджера
   *  (scope='personal'). Любое касание клиента сразу видно в Календаре МП.
   *
   *  Logic:
   *   - закрытая сделка (won/lost) или нет владельца → удалить задачу;
   *   - есть nextContactAt → задача-встреча на этот момент времени;
   *   - нет nextContactAt → follow-up задача на сегодня 10:00, чтобы лид
   *     не «потерялся» и МП помнил перезвонить;
   *   - имя клиента / этап онбординга / контакты меняются — заголовок и
   *     описание задачи синхронизируются.
   *
   *  Best-effort: ошибки логируются, CRUD клиента не валится. */
  private async syncMeetingTask(lead: ClientLead, previous?: ClientLead): Promise<void> {
    try {
      const hasOwner = !!lead.ownerId;
      if (!hasOwner) return;

      // МП по продажам (sales_manager_smm / sales_manager_dev) не должны
      // получать клиентские лиды в раздел «Задачи» — иначе после срока
      // встречи задача становится «просрочкой» и засоряет дашборд.
      // Они видят клиентов в Базе клиентов + Календаре (по nextContactAt).
      // Если задача когда-то создавалась — удаляем её здесь же.
      const owner = await this.userRepo.findOne({
        where: { id: lead.ownerId },
        select: ['id', 'role'],
      }).catch(() => null);
      if (owner && SALES_MANAGER_ROLES.includes(owner.role as any)) {
        if (lead.meetingTaskId) {
          await this.taskRepo.delete(lead.meetingTaskId).catch(() => {});
          await this.repo.update(lead.id, { meetingTaskId: null });
        }
        return;
      }

      // Закрытая сделка — задача в календаре больше не нужна, удаляем.
      const isClosed = lead.status === ClientLeadStatus.WON || lead.status === ClientLeadStatus.LOST;
      if (isClosed) {
        if (lead.meetingTaskId) {
          await this.taskRepo.delete(lead.meetingTaskId).catch(() => {});
          await this.repo.update(lead.id, { meetingTaskId: null });
        }
        return;
      }

      const nextDate = lead.nextContactAt ? new Date(lead.nextContactAt) : null;
      const isScheduled = !!nextDate;

      let deadline: Date;
      let title: string;

      if (isScheduled) {
        // Точное время nextContactAt. Если пришла голая дата (00:00) —
        // ставим 12:00 как разумный дефолт.
        deadline = new Date(nextDate as Date);
        if (deadline.getHours() === 0 && deadline.getMinutes() === 0) {
          deadline.setHours(12, 0, 0, 0);
        }
        title = this.buildMeetingTaskTitle(lead);
      } else {
        // Follow-up по новому/активному лиду. Дедлайн — сегодня 10:00.
        // Если задача уже существовала, её дедлайн НЕ перезаписываем (МП
        // мог сам перетащить в календаре), просто обновляем title/desc.
        deadline = new Date();
        deadline.setHours(10, 0, 0, 0);
        title = this.buildFollowUpTaskTitle(lead);
      }

      const description = this.buildMeetingTaskDescription(lead);

      // Запоминаем этап клиента в задаче — нужно, чтобы фронт/бэк могли
      // скрывать КП-задачи из общих списков (они должны быть видны только
      // в Онбординге на колонке «КП»).
      const originStage = lead.onboardingStage || null;

      if (lead.meetingTaskId) {
        const exists = await this.taskRepo.findOne({ where: { id: lead.meetingTaskId } });
        if (exists) {
          // Дату обновляем только если у клиента есть конкретное расписание
          // (nextContactAt). Иначе сохраняем то, куда МП утащил задачу руками.
          const patch: any = { title, description, assigneeId: lead.ownerId, originStage };
          if (isScheduled) patch.deadline = deadline;
          await this.taskRepo.update(lead.meetingTaskId, patch);
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
        originStage,
        createdById: lead.ownerId,
        assigneeId: lead.ownerId,
      });
      const saved = await this.taskRepo.save(created);
      await this.repo.update(lead.id, { meetingTaskId: saved.id });
    } catch (err: any) {
      // Не валим CRUD клиента из-за проблем с авто-задачей.
      // eslint-disable-next-line no-console
      console.warn('syncMeetingTask failed:', err?.message);
    }
  }

  private buildMeetingTaskTitle(lead: ClientLead): string {
    const stage = lead.onboardingStage ? this.stageLabel(lead.onboardingStage) : null;
    if (stage) return `${stage} с клиентом: ${lead.name}`;
    return `Встреча с клиентом: ${lead.name}`;
  }

  /** Заголовок follow-up задачи (когда у лида нет назначенной встречи). */
  private buildFollowUpTaskTitle(lead: ClientLead): string {
    const stage = lead.onboardingStage ? this.stageLabel(lead.onboardingStage) : null;
    if (stage) return `${stage}: ${lead.name}`;
    return `Новый лид: ${lead.name}`;
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
    return lines.join('\n');
  }

  private stageLabel(stage: string): string {
    const map: Record<string, string> = {
      negotiation:    'Переговор',
      meeting:        'Встреча',
      kp_creation:    'КП',
      contract:       'Договор',
      implementation: 'Реализация',
      cancelled:      'Отмена',
    };
    return map[stage] || 'Встреча';
  }
}
