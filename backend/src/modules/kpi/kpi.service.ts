import { Injectable, Logger } from '@nestjs/common';
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
import { DirectionScope, isInDirection } from '../../common/direction-scope';

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
  /** Ни одной метрики за период — оценки нет (не путать с нулём). */
  noData?: boolean;
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

/** Истории ведут SMM-специалисты (роль сторисмейкера упразднена, оставлена
 *  для совместимости) — метрика «План сторис» показывается им (основная или
 *  вторая роль). */
function isStoryMaker(user: { role?: string | null; secondaryRole?: string | null }): boolean {
  const STORY_ROLES: string[] = [UserRole.STORYMAKER, UserRole.SMM_SPECIALIST];
  return STORY_ROLES.includes(user.role || '') || STORY_ROLES.includes(user.secondaryRole || '');
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
  private readonly logger = new Logger(KpiService.name);

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
  /** «План сторис» — основная метрика сторисмейкера. Единица учёта —
   *  проекто-день: за каждый день периода каждый закреплённый за человеком
   *  SMM-проект должен получить хотя бы одну историю.
   *    · закрыл сам                → в плане и в зачёте;
   *    · закрыл другой участник    → не в плане (команда подстраховала);
   *    · не закрыл никто           → в плане, без зачёта.
   *  Дни после сегодняшнего в план не идут — текущий месяц не выглядит
   *  проваленным из-за ещё не наступивших дней.
   *
   *  $1 = userId, $2/$3 = границы периода, $4 = сегодня (Душанбе),
   *  $5 = покрывает ли сотрудник ВСЕ SMM-проекты (флаг «сторисмейкер»). */
  private storiesPlanSql(): string {
    return `WITH bounds AS (SELECT $2::date AS d_from, LEAST($3::date, $4::date) AS d_to),
      days AS (
        SELECT generate_series(b.d_from, b.d_to, interval '1 day')::date AS day
        FROM bounds b WHERE b.d_to >= b.d_from
      ),
      proj AS (
        SELECT p.id, p."createdAt"::date AS since
        FROM projects p
        WHERE p."isArchived" = false
          AND COALESCE(p."storiesArchived", false) = false
          AND p."projectType" = 'SMM'
          AND CASE WHEN p."smmData"->>'storiesPerDay' ~ '^[0-9]+$'
                   THEN (p."smmData"->>'storiesPerDay')::int ELSE 3 END > 0
          AND (
            $5::boolean
            OR EXISTS (SELECT 1 FROM project_members pm
                       WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid)
            -- назначен SMM-специалистом проекта (smmData.smmSpecialistIds), без членства
            OR jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), $1::uuid::text)
          )
      ),
      -- Дни до появления проекта в системе в план не идут: нельзя было
      -- выкладывать истории по проекту, которого ещё не было.
      grid AS (
        SELECT proj.id AS pid, days.day
        FROM proj CROSS JOIN days
        WHERE days.day >= proj.since
      ),
      logs AS (
        SELECT sl."projectId" AS pid, sl.date::date AS day,
               SUM(CASE WHEN sl."employeeId" = $1::uuid THEN sl."storiesCount" ELSE 0 END) AS mine,
               SUM(sl."storiesCount") AS total
        FROM story_logs sl, bounds b
        WHERE sl.date::date BETWEEN b.d_from AND b.d_to
        GROUP BY 1, 2
      )
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(l.mine, 0) > 0)::int AS closed,
        COUNT(*) FILTER (WHERE COALESCE(l.total, 0) = 0 OR COALESCE(l.mine, 0) > 0)::int AS planned
      FROM grid g LEFT JOIN logs l ON l.pid = g.pid AND l.day = g.day`;
  }

  /** Сегодняшняя дата в часовом поясе компании (Душанбе). Все суточные
   *  сравнения в KPI идут по ней, а не по UTC-дате сервера. */
  private todayLocal(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
  }

  /** KPI одного юзера. Внутри использует bulk-методы (с массивом из одного
   *  id) — переиспользуем код. */
  async getUserKpi(userId: string, from?: string, to?: string): Promise<UserKpi | null> {
    const list = await this.bulkKpi([userId], from, to);
    return list[0] || null;
  }

  /** KPI всех активных не-top сотрудников. Для дашборда основателя.
   *  Делает 5 групповых SQL-агрегаций → быстро даже на 100+ юзерах. */
  async getAllKpi(from?: string, to?: string, scope?: DirectionScope | null): Promise<UserKpi[]> {
    // Выбираем всех активных юзеров кроме admin/founder/co_founder.
    const users = await this.userRepo.find({
      where: { isActive: true, isBlocked: false },
      order: { name: 'ASC' },
    });
    // Руководитель направления видит KPI только своей команды.
    const candidates = users
      .filter(u => !TOP_ROLES.has(u.role))
      .filter(u => !scope || isInDirection(scope, u));
    if (candidates.length === 0) return [];
    return this.bulkKpi(candidates.map(u => u.id), from, to, candidates);
  }

  /** Относится ли сотрудник к направлению смотрящего (по любой из ролей). */
  async isUserInDirection(userId: string, scope: DirectionScope): Promise<boolean> {
    const u = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'role', 'secondaryRole'] as any,
    }).catch(() => null);
    return isInDirection(scope, u as any);
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
    const [tasksRows, sessionRows, storyRows, projectRows, deliveryRows] = await Promise.all([
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
      // Сдача задач в срок — метрика команды разработки. Нормы «столько-то
      // задач в месяц» у них нет: сколько выдали, столько и должны сдать.
      // ПЛАН   — задачи со сроком в периоде, срок которых уже наступил
      //          (ещё не наступивший срок не штрафуем) либо уже закрытые.
      // ЗАЧЁТ  — сдано вовремя 1.0, с опозданием 0.4, не сдано 0.
      // Задачи БЕЗ дедлайна не участвуют вовсе: соблюдать нечего, а иначе
      // показатель накручивался бы бессрочными задачами.
      // Исполнителем считается и основной (assigneeId), и любой из
      // со-исполнителей (task_assignees) — на карточке доски их может быть
      // несколько, и зачёт должен получить каждый.
      this.taskRepo.manager.query(
        `WITH mine AS (
           SELECT t.id, t.deadline, t.status::text AS status,
                  COALESCE(t."completedAt", t."reviewedAt", t."updatedAt") AS closed_at,
                  u.uid
           FROM tasks t
           JOIN LATERAL (
             SELECT t."assigneeId" AS uid
             UNION
             SELECT ta."userId" FROM task_assignees ta WHERE ta."taskId" = t.id
           ) u ON u.uid IS NOT NULL
           WHERE u.uid = ANY($1::uuid[])
             AND t.status::text <> 'cancelled'
             AND t.deadline IS NOT NULL
             AND t.deadline BETWEEN $2 AND $3
             AND (t.deadline <= $4 OR t.status::text = 'done')
         )
         SELECT uid,
                COUNT(*)::int AS planned,
                ROUND(SUM(
                  CASE WHEN status <> 'done' THEN 0
                       WHEN closed_at <= deadline THEN 1.0
                       ELSE 0.4 END
                ), 2)::float AS earned
         FROM mine GROUP BY uid`,
        [userIds, periodFrom, periodTo, new Date()],
      ).catch(e => { this.logger.warn(`task delivery KPI query failed: ${e?.message || e}`); return [] as any[]; }),
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
    const deliveryByUid = new Map<string, { planned: number; earned: number }>();
    for (const r of deliveryRows) {
      deliveryByUid.set(r.uid, { planned: Number(r.planned) || 0, earned: Number(r.earned) || 0 });
    }

    // 3b) Сторисмейкеры — план сторис по проекто-дням, запрос на каждого.
    // Флаг isStoryMaker в employees означает «ведёт истории по ВСЕМ активным
    // SMM-проектам»; без флага человек отвечает только за свои проекты.
    const storyUserIds = userIds.filter(uid => {
      const u = userMap.get(uid);
      return u && isStoryMaker(u);
    });
    const storyPlanByUid = new Map<string, { closed: number; planned: number }>();
    if (storyUserIds.length) {
      const emps = await this.employeeRepo.find({ where: { userId: In(storyUserIds) } })
        .catch(() => [] as Employee[]);
      const coversAll = new Map<string, boolean>(
        emps.map(e => [e.userId, !!e.isStoryMaker] as [string, boolean]),
      );
      await Promise.all(storyUserIds.map(async (uid) => {
        const rows = await this.storyRepo.manager.query(
          this.storiesPlanSql(),
          [uid, periodFrom, periodTo, this.todayLocal(), coversAll.get(uid) ?? false],
        ).catch(e => { this.logger.warn(`stories KPI query failed: ${e?.message || e}`); return [] as any[]; });
        const r = rows?.[0];
        if (r) storyPlanByUid.set(uid, { closed: Number(r.closed) || 0, planned: Number(r.planned) || 0 });
      }));
    }

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

      const items: KpiItem[] = [];

      // Роли задач — разработка и продажи: доской они не пользуются, их
      // дисциплина считается по задачам (для продаж плюс воронка ниже).
      // Все остальные производственные роли живут ТОЛЬКО доской, сторисмейкер —
      // ТОЛЬКО сторис. «Активные дни» из оценки убраны: вход в систему не
      // является работой.
      const isDevTeam = user.role === UserRole.DEVELOPER || user.role === UserRole.PM_DEV;
      const isTaskRole = SALES_ROLES.has(user.role) || isDevTeam;
      if (isTaskRole) {
        if (isDevTeam) {
          // Команда разработки: нормы «столько-то задач» нет — сколько выдали,
          // столько и надо сдать. План — выданные задачи со сроком, зачёт —
          // сдано вовремя 1.0, с опозданием 0.4. Процент «Соблюдено дедлайнов»
          // им НЕ показываем: одна просрочка не должна бить дважды.
          const d = deliveryByUid.get(uid);
          if (d && d.planned > 0) {
            const percent = Math.min(100, Math.round((d.earned / d.planned) * 100));
            items.push({
              key: 'task_delivery',
              label: 'Задачи сдано в срок',
              target: d.planned,
              value: Math.round(d.earned * 10) / 10,
              percent,
              done: percent >= 100,
            });
          }
        } else {
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
      }

      // Сторис — проекто-дни: сколько дней-проектов закрыто из закреплённых.
      if (isStoryMaker(user)) {
        const sp = storyPlanByUid.get(uid);
        if (sp && sp.planned > 0) {
          const percent = Math.min(100, Math.round((sp.closed / sp.planned) * 100));
          items.push({
            key: 'stories_plan',
            label: 'План сторис',
            target: sp.planned,
            value: sp.closed,
            percent,
            done: percent >= 100,
          });
        }
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
        // Работы за период не было (отпуск, больничный, новичок, роль вне
        // доски) — это не ноль, а отсутствие оценки. Фронт показывает «—».
        noData: items.length === 0,
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
    const UNIVERSAL_KEYS = new Set([
      'deadline_rate', 'activity_days', 'stories_posted', 'projects_managed', 'stories_plan',
    ]);

    const normalized = UNIVERSAL_KEYS.has(metric)
      ? metric
      : (metric.startsWith('sales_') ? metric : `sales_${metric}`);

    switch (normalized) {
      // ─── План сторис: по каждому проекто-дню периода ──────────────────
      case 'stories_plan': {
        const emp = await this.employeeRepo.findOne({ where: { userId } }).catch(() => null);
        const rows: any[] = await this.storyRepo.manager.query(
          `WITH bounds AS (SELECT $2::date AS d_from, LEAST($3::date, $4::date) AS d_to),
           days AS (
             SELECT generate_series(b.d_from, b.d_to, interval '1 day')::date AS day
             FROM bounds b WHERE b.d_to >= b.d_from
           ),
           proj AS (
             SELECT p.id, p.name, p."createdAt"::date AS since FROM projects p
             WHERE p."isArchived" = false
               AND COALESCE(p."storiesArchived", false) = false
               AND p."projectType" = 'SMM'
               AND CASE WHEN p."smmData"->>'storiesPerDay' ~ '^[0-9]+$'
                        THEN (p."smmData"->>'storiesPerDay')::int ELSE 3 END > 0
               AND ($5::boolean OR EXISTS (
                 SELECT 1 FROM project_members pm
                 WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid)
                 OR jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), $1::uuid::text))
           ),
           logs AS (
             SELECT sl."projectId" AS pid, sl.date::date AS day,
                    SUM(CASE WHEN sl."employeeId" = $1::uuid THEN sl."storiesCount" ELSE 0 END)::int AS mine,
                    SUM(sl."storiesCount")::int AS total
             FROM story_logs sl, bounds b
             WHERE sl.date::date BETWEEN b.d_from AND b.d_to
             GROUP BY 1, 2
           )
           SELECT proj.id AS pid, proj.name, days.day,
                  COALESCE(l.mine, 0) AS mine, COALESCE(l.total, 0) AS total
           FROM proj CROSS JOIN days
           LEFT JOIN logs l ON l.pid = proj.id AND l.day = days.day
           WHERE days.day >= proj.since
             AND (COALESCE(l.total, 0) = 0 OR COALESCE(l.mine, 0) > 0)
           ORDER BY days.day DESC, proj.name ASC`,
          [userId, periodFrom, periodTo, this.todayLocal(), !!emp?.isStoryMaker],
        ).catch(() => []);
        return rows.map(r => ({
          id: `${r.pid}-${r.day}`,
          title: r.name || 'Проект',
          subtitle: Number(r.mine) > 0
            ? `✓ закрыто · ${r.mine} ${Number(r.mine) === 1 ? 'история' : 'историй'}`
            : '✖ историй не было',
          date: r.day ? new Date(r.day).toISOString() : null,
          link: '/project-stories',
          meta: { mine: Number(r.mine), total: Number(r.total) },
        }));
      }

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

      // ─── Универсальное: соблюдено дедлайнов (по задачам) ──────────────
      case 'deadline_rate': {
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
