import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { Task } from '../tasks/task.entity';
import { WorkSession } from '../auth/work-session.entity';
import { StoryLog } from '../stories/story.entity';
import { Project } from '../projects/project.entity';
import { ClientLead, ClientLeadDirection } from '../clients/client-lead.entity';
import { ActivityLog, ActivityAction } from '../activity-log/activity-log.entity';
import { ClientsService } from '../clients/clients.service';

/** Универсальная KPI-метрика. */
export interface KpiItem {
  key: string;
  label: string;
  target: number;
  value: number;
  percent: number;
  done: boolean;
}

/** Сводный ответ KPI одного юзера. */
export interface UserKpi {
  userId: string;
  role: string;
  periodFrom: string;
  periodTo: string;
  overallPercent: number;
  items: KpiItem[];
}

const TOP_ROLES = new Set<string>([
  UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
]);
const PM_ROLES = new Set<string>([
  UserRole.VIDEO_DIRECTOR, UserRole.SMM_DIRECTOR,
]);
const SALES_ROLES = new Set<string>([
  UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV,
]);
const SMM_ROLES = new Set<string>([
  UserRole.SMM_SPECIALIST, UserRole.STORYMAKER,
]);

/** Порядок этапов доски для определения ДВИЖЕНИЯ ВПЕРЁД. «Монтаж» и «Дизайн» —
 *  параллельные ветки (рилс/макет), поэтому у них одинаковый ранг. Переход
 *  считается прогрессом, когда ранг нового этапа больше ранга прежнего;
 *  возвраты на доработку (QA / правки клиента) не засчитываются. */
const STAGE_RANK: Record<string, number> = {
  content_plan: 0, organization: 1, shooting: 2, editing: 3, design: 3,
  internal_review: 4, client_approval: 5, ready_to_publish: 6, published: 7, ads: 8,
};
/** SQL-таблица рангов для JOIN'ов (та же, что STAGE_RANK). */
const STAGE_RANK_VALUES = Object.entries(STAGE_RANK)
  .map(([s, r]) => `('${s}',${r})`).join(',');

const STAGE_LABELS: Record<string, string> = {
  content_plan: 'Контент-план', organization: 'Организация', shooting: 'Съёмка',
  editing: 'Монтаж', design: 'Дизайн', internal_review: 'Внутренняя проверка',
  client_approval: 'Согласование с клиентом', ready_to_publish: 'Готово к публикации',
  published: 'Опубликовано', ads: 'Реклама',
};

/** Истории ведёт только сторисмейкер — метрика «Историй опубликовано»
 *  показывается лишь ему (основная или вторая роль). */
function isStoryMaker(user: { role?: string | null; secondaryRole?: string | null }): boolean {
  return user.role === UserRole.STORYMAKER || user.secondaryRole === UserRole.STORYMAKER;
}

/** Базовые таргеты на 30-дневный период. Для других периодов скейлим
 *  пропорционально (см. scaleTarget ниже). */
interface RoleTargets {
  tasksDone: number;
  hoursLogged: number;
  deadlineRate: number; // % — НЕ скейлится, это качественная метрика
  activityDays: number;
  storiesPosted?: number;
  projectsManaged?: number; // НЕ скейлится — это snapshot
}

function targetsFor(role: string): RoleTargets {
  if (PM_ROLES.has(role)) {
    return {
      tasksDone: 30, hoursLogged: 160, deadlineRate: 95, activityDays: 22,
      projectsManaged: 5,
    };
  }
  if (SALES_ROLES.has(role)) {
    return { tasksDone: 10, hoursLogged: 160, deadlineRate: 85, activityDays: 22 };
  }
  if (SMM_ROLES.has(role)) {
    return {
      tasksDone: 25, hoursLogged: 160, deadlineRate: 90, activityDays: 22,
      storiesPosted: 80,
    };
  }
  // Любая «рабочая» роль (designer / developer / videographer /
  // video_editor / organizer / employee) — стандартный набор.
  return { tasksDone: 20, hoursLogged: 160, deadlineRate: 90, activityDays: 22 };
}

@Injectable()
export class KpiService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(WorkSession) private sessionRepo: Repository<WorkSession>,
    @InjectRepository(StoryLog) private storyRepo: Repository<StoryLog>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(ClientLead) private leadRepo: Repository<ClientLead>,
    @InjectRepository(ActivityLog) private activityRepo: Repository<ActivityLog>,
    private clientsService: ClientsService,
  ) {}

  /** Разрезаем строку YYYY-MM-DD в локальную полночь без UTC-сдвига. */
  private parseDate(s?: string): Date | undefined {
    if (!s) return undefined;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  private periodRange(from?: string, to?: string) {
    const now = new Date();
    const periodFrom = this.parseDate(from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
    periodFrom.setHours(0, 0, 0, 0);
    const periodTo = this.parseDate(to) ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
    periodTo.setHours(23, 59, 59, 999);
    // Число КАЛЕНДАРНЫХ дней периода включительно. Считаем по полуночям обеих
    // дат: раньше ceil() от разницы с 23:59:59.999 плюс ещё +1 давали лишний
    // день (июль = 32, «Сегодня» = 2) и завышали нормы. Round — страховка от
    // перевода часов.
    const fromMidnight = new Date(periodFrom.getFullYear(), periodFrom.getMonth(), periodFrom.getDate());
    const toMidnight = new Date(periodTo.getFullYear(), periodTo.getMonth(), periodTo.getDate());
    const days = Math.max(1, Math.round((toMidnight.getTime() - fromMidnight.getTime()) / 86400_000) + 1);
    return { periodFrom, periodTo, days };
  }

  /** Скейлинг таргета: базовые числа даны на 30 дней. Для другого
   *  периода — пропорционально, минимум 1. */
  private scaleTarget(base: number, days: number): number {
    return Math.max(1, Math.round(base * days / 30));
  }

  /** CTE «выполненные этапы доски» — общая база для сводки и детализации.
   *  Параметры запроса: $2 = начало периода, $3 = конец.
   *
   *  Источник 1 (fwd): forward-переходы карточки (stage_enter, ранг нового
   *    этапа выше прежнего). Возвраты на доработку не считаются. DISTINCT ON
   *    (cardId, toStage) — этап каждой карточки засчитывается ОДИН раз, даже
   *    если после доработки её провели повторно; зачёт получает тот, кто
   *    провёл её последним. units из meta (у групповой карточки — все её
   *    элементы), дедлайн — снимок срока на момент перехода.
   *  Источник 2 (covers): «обложка/заставка готова» — работа дизайнера,
   *    которая не двигает карточку по этапам, но является выполненным этапом.
   *
   *  Не считаем: карточки-обложки в источнике 1 (их создание пишет событие от
   *  автора плана — фантомный зачёт), КП-инструкцию и перенос в «Рекламу»
   *  (это ручной drag руководителя, а не производственный этап). */
  private boardEventsCte(): string {
    return `WITH stage_rank(stage, r) AS (VALUES ${STAGE_RANK_VALUES}),
      fwd AS (
        SELECT DISTINCT ON (e."cardId", e."toStage")
               e.id, 'stage'::text AS src, e."fromStage", e."toStage",
               e."actorId"::text AS uid,
               COALESCE((e.meta->>'units')::int, 1) AS units,
               e."createdAt" AS at,
               NULLIF(COALESCE(e.meta->>'deadline', c.deadline::text), '')::date AS dl,
               c.title AS title
        FROM unit_events e
        LEFT JOIN workflow_cards c ON c.id = e."cardId"
        LEFT JOIN stage_rank rf ON rf.stage = e."fromStage"
        LEFT JOIN stage_rank rt ON rt.stage = e."toStage"
        WHERE e.action = 'stage_enter'
          AND e."actorId" IS NOT NULL
          AND e."createdAt" BETWEEN $2 AND $3
          AND rt.r IS NOT NULL
          AND rt.r > COALESCE(rf.r, -1)
          AND e."toStage" <> 'ads'
          AND COALESCE(c.type, '') <> 'cover'
          AND COALESCE(c.kind, '') <> 'kp'
        ORDER BY e."cardId", e."toStage", e."createdAt" DESC
      ),
      covers AS (
        SELECT DISTINCT ON (e."cardId")
               e.id, 'cover'::text AS src, NULL::varchar AS "fromStage", 'design'::varchar AS "toStage",
               e."actorId"::text AS uid, 1 AS units, e."createdAt" AS at,
               NULLIF(c.deadline::text, '')::date AS dl, c.title AS title
        FROM unit_events e
        LEFT JOIN workflow_cards c ON c.id = e."cardId"
        WHERE e.action = 'cover_done'
          AND e."actorId" IS NOT NULL
          AND e."createdAt" BETWEEN $2 AND $3
        ORDER BY e."cardId", e."createdAt" DESC
      ),
      ev AS (SELECT * FROM fwd UNION ALL SELECT * FROM covers)`;
  }

  /** KPI одного юзера. Внутри использует bulk-методы (с массивом из одного
   *  id) — переиспользуем код. */
  async getUserKpi(userId: string, from?: string, to?: string): Promise<UserKpi | null> {
    const list = await this.bulkKpi([userId], from, to);
    return list[0] || null;
  }

  /** KPI всех активных не-top сотрудников. Для дашборда основателя.
   *  Делает 5 групповых SQL-агрегаций → быстро даже на 100+ юзерах. */
  async getAllKpi(from?: string, to?: string): Promise<UserKpi[]> {
    // Выбираем всех активных юзеров кроме admin/founder/co_founder.
    const users = await this.userRepo.find({
      where: { isActive: true, isBlocked: false },
      order: { name: 'ASC' },
    });
    const candidates = users.filter(u => !TOP_ROLES.has(u.role));
    if (candidates.length === 0) return [];
    return this.bulkKpi(candidates.map(u => u.id), from, to, candidates);
  }

  /** Эффективный bulk-расчёт KPI для списка userId. */
  private async bulkKpi(
    userIds: string[],
    from?: string,
    to?: string,
    preloadedUsers?: User[],
  ): Promise<UserKpi[]> {
    if (userIds.length === 0) return [];
    const { periodFrom, periodTo, days } = this.periodRange(from, to);

    // 1) Юзеры — если не передали, грузим сами
    const users = preloadedUsers
      ?? await this.userRepo.find({ where: { id: In(userIds) } });
    const userMap = new Map(users.map(u => [u.id, u]));

    // 2) Параллельно гонимся за всеми агрегациями.
    // Wave 14: убрали запрос hours/time_logs — метрика «Часов залогировано»
    // выпилена, считать её больше не нужно.
    const [tasksRows, sessionRows, storyRows, projectRows, boardRows] = await Promise.all([
      this.taskRepo.manager.query(
        `SELECT "assigneeId" AS uid,
                COUNT(*)::int AS done_count,
                COUNT(*) FILTER (
                  WHERE deadline IS NULL OR COALESCE("reviewedAt", "updatedAt") <= deadline
                )::int AS on_time_count
         FROM tasks
         WHERE "assigneeId" = ANY($1::uuid[])
           AND status::text = 'done'
           AND "updatedAt" BETWEEN $2 AND $3
         GROUP BY "assigneeId"`,
        [userIds, periodFrom, periodTo],
      ),
      this.sessionRepo.manager.query(
        `SELECT "userId" AS uid, COUNT(DISTINCT date)::int AS days
         FROM work_sessions
         WHERE "userId" = ANY($1::uuid[])
           AND date::date BETWEEN $2::date AND $3::date
         GROUP BY "userId"`,
        [userIds, periodFrom, periodTo],
      ),
      this.storyRepo.manager.query(
        `SELECT "employeeId" AS uid, COALESCE(SUM("storiesCount"), 0)::int AS total
         FROM story_logs
         WHERE "employeeId" = ANY($1::uuid[])
           AND date BETWEEN $2 AND $3
         GROUP BY "employeeId"`,
        [userIds, periodFrom, periodTo],
      ).catch(() => [] as any[]),
      this.projectRepo.manager.query(
        `SELECT "managerId" AS uid, COUNT(*)::int AS cnt
         FROM projects
         WHERE "managerId" = ANY($1::uuid[])
           AND "isArchived" = false
         GROUP BY "managerId"`,
        [userIds],
      ),
      // Доска проектов: ЭТАПЫ, закрытые сотрудником за период (не только
      // публикация). Фильтр по сотрудникам — ПОСЛЕ дедупликации, иначе при
      // доработке зачёт мог бы уйти не последнему исполнителю.
      this.projectRepo.manager.query(
        `${this.boardEventsCte()}
         SELECT uid, SUM(units)::int AS done_count,
                SUM(CASE WHEN dl IS NULL OR at::date <= dl THEN units ELSE 0 END)::int AS on_time_count
         FROM ev WHERE uid = ANY($1::text[]) GROUP BY uid`,
        [userIds, periodFrom, periodTo],
      ).catch(() => [] as any[]),
    ]);

    // 3) Индексируем по userId для быстрого доступа
    const tasksByUid = new Map<string, { done: number; onTime: number }>();
    for (const r of tasksRows) {
      tasksByUid.set(r.uid, { done: Number(r.done_count) || 0, onTime: Number(r.on_time_count) || 0 });
    }
    const activityByUid = new Map<string, number>();
    for (const r of sessionRows) activityByUid.set(r.uid, Number(r.days) || 0);
    const storiesByUid = new Map<string, number>();
    for (const r of storyRows) storiesByUid.set(r.uid, Number(r.total) || 0);
    const projectsByUid = new Map<string, number>();
    for (const r of projectRows) projectsByUid.set(r.uid, Number(r.cnt) || 0);
    const boardByUid = new Map<string, { done: number; onTime: number }>();
    for (const r of boardRows) boardByUid.set(r.uid, { done: Number(r.done_count) || 0, onTime: Number(r.on_time_count) || 0 });

    // 4) Для МП — запросы к ClientsService, параллельно
    const salesIds = userIds.filter(uid => {
      const u = userMap.get(uid);
      return u && SALES_ROLES.has(u.role);
    });
    const salesKpis = new Map<string, any>();
    await Promise.all(salesIds.map(async (uid) => {
      const u = userMap.get(uid)!;
      const direction = u.role === UserRole.SALES_MANAGER_SMM ? 'smm' as any
        : u.role === UserRole.SALES_MANAGER_DEV ? 'development' as any
        : undefined;
      const kpi = await this.clientsService.kpi(uid, direction, from, to).catch(() => null);
      if (kpi) salesKpis.set(uid, kpi);
    }));

    // 5) Собираем финальный результат для каждого userId
    return userIds.map(uid => {
      const user = userMap.get(uid);
      if (!user || TOP_ROLES.has(user.role)) {
        return null;
      }
      const targets = targetsFor(user.role);
      const t = tasksByUid.get(uid) || { done: 0, onTime: 0 };
      const actDays = activityByUid.get(uid) || 0;
      const stories = storiesByUid.get(uid) || 0;
      const projects = projectsByUid.get(uid) || 0;

      const items: KpiItem[] = [];

      // Wave 14: убрали tasks_done и hours_logged — они показывали 0 за период
      // и читались как баг рассинхрона с БД (StatCard рядом считает по всему
      // времени и показывает другие числа). Оставляем только deadline_rate
      // и activity_days как универсальные. Подсчёт `t.done`/`hours` ниже
      // всё ещё нужен для deadline_rate.

      // KPI по Доске проектов — для всех ролей, КРОМЕ менеджеров продаж и
      // разработчиков (они остаются на задачах).
      const isBoardRole = !SALES_ROLES.has(user.role) && user.role !== UserRole.DEVELOPER;
      if (isBoardRole) {
        const board = boardByUid.get(uid) || { done: 0, onTime: 0 };
        const cardsTarget = this.scaleTarget(targets.tasksDone, days);
        items.push({
          key: 'cards_done',
          label: 'Этапов выполнено',
          target: cardsTarget,
          value: board.done,
          percent: Math.min(100, Math.round(board.done / cardsTarget * 100)),
          done: board.done >= cardsTarget,
        });
        const dr = board.done > 0 ? Math.round((board.onTime / board.done) * 100) : 0;
        items.push({
          key: 'deadline_rate',
          label: 'Соблюдено дедлайнов',
          target: targets.deadlineRate,
          value: dr,
          percent: board.done > 0 ? Math.min(100, Math.round(dr / targets.deadlineRate * 100)) : 0,
          done: board.done > 0 && dr >= targets.deadlineRate,
        });
      } else {
        // Разработчики / менеджеры продаж — соблюдение дедлайнов по задачам.
        const deadlineRate = t.done > 0 ? Math.round((t.onTime / t.done) * 100) : 0;
        items.push({
          key: 'deadline_rate',
          label: 'Соблюдено дедлайнов',
          target: targets.deadlineRate,
          value: deadlineRate,
          percent: t.done > 0 ? Math.min(100, Math.round(deadlineRate / targets.deadlineRate * 100)) : 0,
          done: t.done > 0 && deadlineRate >= targets.deadlineRate,
        });
      }

      const activityTarget = Math.min(days, this.scaleTarget(targets.activityDays, days));
      items.push({
        key: 'activity_days',
        label: 'Активных дней',
        target: activityTarget,
        value: actDays,
        percent: Math.min(100, Math.round(actDays / activityTarget * 100)),
        done: actDays >= activityTarget,
      });

      // Бонус-метрики по роли. Истории ведёт только сторисмейкер — у
      // SMM-специалиста этой метрики нет (цели по историям к нему не относятся).
      // Вторая роль «сторисмейкер» тоже даёт метрику (базовая норма 80/30дн).
      if (isStoryMaker(user)) {
        const storiesTarget = this.scaleTarget(targets.storiesPosted ?? 80, days);
        items.push({
          key: 'stories_posted',
          label: 'Историй опубликовано',
          target: storiesTarget,
          value: stories,
          percent: Math.min(100, Math.round(stories / storiesTarget * 100)),
          done: stories >= storiesTarget,
        });
      }

      if (PM_ROLES.has(user.role) && targets.projectsManaged) {
        items.push({
          key: 'projects_managed',
          label: 'Проектов под управлением',
          target: targets.projectsManaged,
          value: projects,
          percent: Math.min(100, Math.round(projects / targets.projectsManaged * 100)),
          done: projects >= targets.projectsManaged,
        });
      }

      if (SALES_ROLES.has(user.role)) {
        const salesKpi = salesKpis.get(uid);
        if (salesKpi?.items) {
          // Префиксуем sales-ключи чтобы не пересекались с универсальными.
          for (const it of salesKpi.items as KpiItem[]) {
            items.push({ ...it, key: `sales_${it.key}` });
          }
        }
      }

      // Overall: среднее процентов всех метрик
      const overall = items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.percent, 0) / items.length)
        : 0;

      return {
        userId: uid,
        role: user.role,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        overallPercent: Math.min(100, Math.max(0, overall)),
        items,
      } as UserKpi;
    }).filter(Boolean) as UserKpi[];
  }

  /** Детализация конкретной KPI-метрики — для модалки «открыть подробно».
   *  Возвращает массив записей с консистентной структурой:
   *    { id, title, subtitle, date, link?, meta? }
   *  где link — куда вести при клике на запись.
   */
  async getMetricDetails(
    userId: string,
    metric: string,
    from?: string,
    to?: string,
  ): Promise<Array<{
    id: string;
    title: string;
    subtitle?: string | null;
    date?: string | null;
    link?: string | null;
    meta?: Record<string, any>;
  }>> {
    const { periodFrom, periodTo } = this.periodRange(from, to);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return [];
    const direction: ClientLeadDirection | undefined =
      user.role === UserRole.SALES_MANAGER_SMM ? ClientLeadDirection.SMM
      : user.role === UserRole.SALES_MANAGER_DEV ? ClientLeadDirection.DEVELOPMENT
      : undefined;

    // Общий хелпер: где есть direction — фильтруем лиды по нему + старые без направления.
    const applyDirection = (qb: any) => {
      if (direction) qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: direction });
      return qb;
    };

    // Нормализуем ключ: SalesDashboard передаёт `new_companies` (без префикса),
    // EmployeeKpiCard — `sales_new_companies` (с префиксом). Внутри switch
    // всегда работаем с префиксом sales_*. Универсальные метрики остаются как есть.
    const UNIVERSAL_KEYS = new Set(['deadline_rate', 'activity_days', 'stories_posted', 'projects_managed', 'cards_done']);
    const isBoardRole = user.role !== UserRole.SALES_MANAGER_SMM
      && user.role !== UserRole.SALES_MANAGER_DEV
      && user.role !== UserRole.DEVELOPER
      && !TOP_ROLES.has(user.role);
    // Этапы, закрытые сотрудником за период (для cards_done и board-варианта
    // deadline_rate). Та же база, что у сводки — цифры всегда сходятся.
    const boardStages = async () => this.projectRepo.manager.query(
      `${this.boardEventsCte()}
       SELECT * FROM ev WHERE uid = $1 ORDER BY at DESC`,
      [userId, periodFrom, periodTo],
    ).catch(() => [] as any[]);

    /** Строка детализации по закрытому этапу. */
    const stageRow = (e: any) => {
      const onTime = !e.dl || new Date(e.at) <= new Date(new Date(e.dl).setHours(23, 59, 59, 999));
      const units = Number(e.units) || 1;
      const what = e.src === 'cover'
        ? 'Обложка/заставка готова'
        : `${e.fromStage ? (STAGE_LABELS[e.fromStage] || e.fromStage) : '—'} → ${STAGE_LABELS[e.toStage] || e.toStage}`;
      return {
        id: e.id,
        title: e.title || 'Карточка удалена',
        subtitle: `${what}${units > 1 ? ` · ${units} шт.` : ''} · ${onTime ? '✓ в срок' : '⚠ с опозданием'}`,
        date: e.at ? new Date(e.at).toISOString() : null,
        link: '/workflow-board',
        meta: { onTime, deadline: e.dl, units },
      };
    };
    const normalized = UNIVERSAL_KEYS.has(metric)
      ? metric
      : (metric.startsWith('sales_') ? metric : `sales_${metric}`);

    switch (normalized) {
      // ─── Sales: продвижения по воронке ────────────────────────────────
      // Источник №1 — lead_progress (новая таблица, без enum), №2 —
      // activity_logs (legacy). Берём оба, дедуплицируем по дате+лиду.
      case 'sales_funnel_progress': {
        const tableRows: any[] = await this.activityRepo.manager.query(
          `SELECT id, lead_id, lead_name, stage_from, stage_to, status_from, status_to, created_at
           FROM lead_progress
           WHERE user_id = $1 AND created_at BETWEEN $2 AND $3
           ORDER BY created_at DESC`,
          [userId, periodFrom, periodTo],
        ).catch(() => []);
        const legacyRows = await this.activityRepo
          .createQueryBuilder('a')
          .where('a.userId = :uid', { uid: userId })
          .andWhere('a.action = :act', { act: ActivityAction.LEAD_PROGRESS })
          .andWhere('a.createdAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
          .orderBy('a.createdAt', 'DESC')
          .getMany().catch(() => []);

        const fromTable = (tableRows || []).map(r => ({
          id: r.id,
          title: r.lead_name || 'Лид',
          subtitle: [
            r.status_to && r.status_from ? `${r.status_from} → ${r.status_to}` : null,
            r.stage_to && r.stage_from !== r.stage_to
              ? `этап: ${r.stage_from ?? '—'} → ${r.stage_to}`
              : (r.stage_to ? `этап: ${r.stage_to}` : null),
          ].filter(Boolean).join(' · ') || null,
          date: r.created_at ? new Date(r.created_at).toISOString() : null,
          // Deep-link на конкретного клиента — открывает форму
          // редактирования в ClientsPage. Если lead_id потерян (старые
          // записи) — ссылка просто на /clients.
          link: r.lead_id ? `/clients?id=${r.lead_id}` : '/clients',
        }));
        const fromActivity = legacyRows.map(r => {
          const d = r.details || {};
          const status = d.statusTo && d.statusFrom ? `${d.statusFrom} → ${d.statusTo}` : null;
          const stage = d.stageTo && d.stageFrom !== d.stageTo
            ? `этап: ${d.stageFrom ?? '—'} → ${d.stageTo}`
            : (d.stageTo ? `этап: ${d.stageTo}` : null);
          return {
            id: r.id,
            title: r.entityName || 'Лид',
            subtitle: [status, stage].filter(Boolean).join(' · ') || null,
            date: r.createdAt?.toISOString() || null,
            // У activity_logs нет lead_id — entityId раньше тоже
            // ставился в undefined. Ссылка остаётся общая.
            link: '/clients',
          };
        });

        // Возвращаем более длинный массив — он точнее (дедуп руками по дате
        // не делаем, потому что одна запись пишется в оба источника один раз).
        return fromTable.length >= fromActivity.length ? fromTable : fromActivity;
      }

      // ─── Sales: новые компании в базе (created в период) ───────────────
      case 'sales_new_companies': {
        const qb = this.leadRepo.createQueryBuilder('c')
          .where('c.ownerId = :uid', { uid: userId })
          .andWhere('c.createdAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
          .orderBy('c.createdAt', 'DESC');
        const leads = await applyDirection(qb).getMany();
        return leads.map(l => ({
          id: l.id,
          title: l.name,
          subtitle: [l.sphere, l.contactPerson || l.contactPhone || l.contactInstagram || l.contactEmail]
            .filter(Boolean).join(' · ') || null,
          date: l.createdAt?.toISOString() || null,
          link: `/clients?id=${l.id}`,
          meta: { potential: l.dealPotential },
        }));
      }

      // ─── Sales: холодные звонки ────────────────────────────────────────
      // СОБЫТИЙНЫЙ учёт: каждая отметка «Холодный» = событие в lead_actions.
      // Fallback на состояние (callType='cold') если событий ещё нет.
      case 'sales_cold_calls': {
        const rows = await this.leadRepo.manager.query(
          `SELECT la.id, la.created_at AS date, la.lead_id,
                  cl.name, cl.channel, cl."contactPhone", cl."contactInstagram", cl."contactPerson"
           FROM lead_actions la
           LEFT JOIN client_leads cl ON cl.id = la.lead_id
           WHERE la.user_id = $1 AND la.kind = 'cold_call'
             AND la.created_at BETWEEN $2 AND $3
           ORDER BY la.created_at DESC`,
          [userId, periodFrom, periodTo],
        ).catch(() => [] as any[]);
        if (rows.length > 0) {
          return rows.map((r: any) => ({
            id: r.lead_id || r.id,
            title: r.name || 'Лид удалён',
            subtitle: [r.channel, r.contactPhone || r.contactInstagram || r.contactPerson]
              .filter(Boolean).join(' · ') || null,
            date: r.date ? new Date(r.date).toISOString() : null,
            link: r.lead_id ? `/clients?id=${r.lead_id}` : undefined,
          }));
        }
        const qb = this.leadRepo.createQueryBuilder('c')
          .where('c.ownerId = :uid', { uid: userId })
          .andWhere(`LOWER(COALESCE(c."callType", '')) = 'cold'`)
          .andWhere('c.updatedAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
          .orderBy('c.updatedAt', 'DESC');
        const leads = await applyDirection(qb).getMany();
        return leads.map(l => ({
          id: l.id,
          title: l.name,
          subtitle: [l.channel, l.contactPhone || l.contactInstagram || l.contactPerson]
            .filter(Boolean).join(' · ') || null,
          date: l.updatedAt?.toISOString() || null,
          link: `/clients?id=${l.id}`,
        }));
      }

      // ─── Sales: персональные письма ────────────────────────────────────
      // По полю emailStatus='sent' («Написал») — точный учёт отправленных
      // писем вместо эвристики через channel/contactEmail.
      case 'sales_personal_emails': {
        const qb = this.leadRepo.createQueryBuilder('c')
          .where('c.ownerId = :uid', { uid: userId })
          .andWhere(`LOWER(COALESCE(c."emailStatus", '')) = 'sent'`)
          .andWhere('c.updatedAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
          .orderBy('c.updatedAt', 'DESC');
        const leads = await applyDirection(qb).getMany();
        return leads.map(l => ({
          id: l.id,
          title: l.name,
          subtitle: [l.contactEmail || l.channel, l.contactPerson].filter(Boolean).join(' · ') || null,
          date: l.updatedAt ? new Date(l.updatedAt).toISOString() : null,
          link: `/clients?id=${l.id}`,
        }));
      }

      // ─── Sales: встречи / созвоны ──────────────────────────────────────
      // Встречи привязаны к ДНЮ встречи: nextContactAt в окне периода
      // (раньше был «горизонт +14 дней» — убран).
      case 'sales_meetings': {
        const qb = this.leadRepo.createQueryBuilder('c')
          .where('c.ownerId = :uid', { uid: userId })
          .andWhere('c.nextContactAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
          .orderBy('c.nextContactAt', 'ASC');
        const leads = await applyDirection(qb).getMany();
        return leads.map(l => ({
          id: l.id,
          title: l.name,
          subtitle: [l.channel, l.contactPerson || l.contactPhone].filter(Boolean).join(' · ') || null,
          date: l.nextContactAt?.toISOString() || null,
          link: `/clients?id=${l.id}`,
        }));
      }

      // ─── Доска: этапы, закрытые сотрудником за период ───────────────────
      case 'cards_done': {
        const rows = await boardStages();
        return (rows as any[]).map(stageRow);
      }

      // ─── Универсальное: соблюдено дедлайнов ────────────────────────────
      // Для SMM/продакшн-ролей — по Доске проектов; для остальных — по задачам.
      case 'deadline_rate': {
        if (isBoardRole) {
          const rows = await boardStages();
          return (rows as any[]).map(stageRow);
        }
        const tasks = await this.taskRepo.manager.query(
          `SELECT id, title, deadline, "updatedAt", "reviewedAt", status
           FROM tasks
           WHERE "assigneeId" = $1
             AND status::text = 'done'
             AND "updatedAt" BETWEEN $2 AND $3
           ORDER BY "updatedAt" DESC`,
          [userId, periodFrom, periodTo],
        );
        return (tasks as any[]).map(t => {
          const closedAt = t.reviewedAt || t.updatedAt;
          const onTime = !t.deadline || new Date(closedAt) <= new Date(t.deadline);
          return {
            id: t.id,
            title: t.title,
            subtitle: onTime ? '✓ в срок' : '⚠ просрочена',
            date: closedAt ? new Date(closedAt).toISOString() : null,
            link: `/tasks/${t.id}`,
            meta: { onTime, deadline: t.deadline },
          };
        });
      }

      // ─── Универсальное: активные дни (work_sessions) ───────────────────
      case 'activity_days': {
        const rows = await this.sessionRepo.manager.query(
          `SELECT date, COUNT(*)::int AS sessions,
                  MIN("loginAt") AS first_login,
                  COALESCE(SUM("durationHours"), 0)::float AS total_hours
           FROM work_sessions
           WHERE "userId" = $1
             AND date::date BETWEEN $2::date AND $3::date
           GROUP BY date
           ORDER BY date DESC`,
          [userId, periodFrom, periodTo],
        );
        return (rows as any[]).map(r => ({
          id: String(r.date),
          title: new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' }),
          subtitle: `${r.sessions} вход(а/ов) · ${Number(r.total_hours).toFixed(1)} ч`,
          date: r.first_login ? new Date(r.first_login).toISOString() : null,
          link: null,
        }));
      }

      // ─── SMM: истории за период ────────────────────────────────────────
      case 'stories_posted': {
        const stories = await this.storyRepo.find({
          where: { employeeId: userId },
          order: { date: 'DESC' },
          relations: ['project'],
        });
        return stories
          .filter(s => {
            const d = new Date(s.date);
            return d >= periodFrom && d <= periodTo;
          })
          .map(s => ({
            id: s.id,
            title: s.project?.name || 'Проект',
            subtitle: `${s.storiesCount} истор${s.storiesCount === 1 ? 'ия' : 'ий'}`,
            date: s.date,
            link: s.projectId ? `/projects/${s.projectId}` : null,
          }));
      }

      // ─── PM: проекты под управлением ───────────────────────────────────
      case 'projects_managed': {
        const projects = await this.projectRepo.find({
          where: { managerId: userId, isArchived: false },
          order: { createdAt: 'DESC' },
        });
        return projects.map(p => ({
          id: p.id,
          title: p.name,
          subtitle: p.status,
          date: p.createdAt?.toISOString() || null,
          link: `/projects/${p.id}`,
        }));
      }

      default:
        return [];
    }
  }
}
