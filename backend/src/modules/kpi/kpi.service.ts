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
import { cachedResponse } from '../../common/response-cache';
import { COLD_CALL_EVENTS_SINCE, currentVacationRange, dushanbeDay, expandRanges, salesPeriod, workingDays } from '../clients/sales-kpi.logic';
import { KpiItem, salesActivityItem, salesKpiItems } from './kpi.logic';
import { salesRoleOf } from '../../common/sales-segment';

/** Короткий кэш KPI (08.11.2026): расчёт — десяток агрегаций, а просят его
 *  панели, профиль и страница KPI одновременно. Ответ зависит только от
 *  периода и скоупа направления, не от того, кто смотрит (права проверены
 *  до вызова). Любое событие изменения кэш сбрасывает. */
const KPI_TTL = 90_000;

export type { KpiItem } from './kpi.logic';

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
  UserRole.ADMIN, UserRole.FOUNDER,
]);
const SMM_ROLES = new Set<string>([
  UserRole.SMM_SPECIALIST,
]);
/** Производство контента: сдают карточки подготовки из контент-плана. */
const PRODUCTION_ROLES = new Set<string>([
  UserRole.VIDEOGRAPHER, UserRole.VIDEO_EDITOR, UserRole.DESIGNER,
]);
const PRODUCTION_LABEL: Record<string, string> = {
  [UserRole.VIDEOGRAPHER]: 'Съёмки в срок',
  [UserRole.VIDEO_EDITOR]: 'Монтаж в срок',
  [UserRole.DESIGNER]: 'Макеты в срок',
};

/**
 * Сдача в срок по контент-плану (17.10.2026, профиль сотрудника). Правило то
 * же, что у задач разработки: ПЛАН — карточки с днём в периоде, день которых
 * уже наступил, либо уже сданные; ЗАЧЁТ — сдано в свой день 1.0, позже 0.4,
 * не сдано 0. Отменённые не считаются. День сдачи — момент публикации
 * (publishedAt, по Душанбе; 15.11.2026), у старых карточек без него —
 * последнее изменение: любая поздняя правка делала бы сданное просрочкой.
 * Несданная карточка с днём в отпуске/отгуле сотрудника в план не идёт.
 *  · SMM-специалист — публикации своих проектов (назначен или участник);
 *  · видеограф, монтажёр, дизайнер — карточки подготовки, где он исполнитель.
 * $1 = userIds, $2/$3 = границы периода, $4 = сегодня (Душанбе),
 * $5 = { userId: ['YYYY-MM-DD', …] } — дни отсутствия (jsonb).
 */
export const CONTENT_ON_TIME_SQL = `
  WITH mine AS (
    SELECT ci.id, ci."publishDate"::date AS due, ci.status::text AS status,
           (COALESCE(ci."publishedAt", ci."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dushanbe')::date AS closed,
           u.uid
    FROM content_plan_items ci
    JOIN projects p ON p.id = ci."projectId" AND p."isArchived" = false AND p."projectType" = 'SMM'
    JOIN LATERAL unnest($1::uuid[]) AS u(uid) ON (
      (ci."shootForItemId" IS NULL AND ci."contentType"::text <> 'story' AND (
        jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), u.uid::text)
        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm."projectsId" = p.id AND pm."usersId" = u.uid)))
      OR (ci."shootForItemId" IS NOT NULL AND ci."assigneeId" = u.uid)
    )
    WHERE ci.status::text <> 'cancelled'
      AND ci."publishDate" IS NOT NULL
      AND ci."publishDate"::date BETWEEN $2::date AND $3::date
      AND (ci."publishDate"::date <= $4::date OR ci.status::text = 'published')
      AND (ci.status::text = 'published' OR NOT jsonb_exists(
            COALESCE($5::jsonb -> u.uid::text, '[]'::jsonb), to_char(ci."publishDate"::date, 'YYYY-MM-DD')))
  )
  SELECT uid,
         COUNT(*)::int AS planned,
         ROUND(SUM(CASE WHEN status <> 'published' THEN 0
                        WHEN closed <= due THEN 1.0 ELSE 0.4 END), 2)::float AS earned
  FROM mine GROUP BY uid`;

/**
 * «Активных дней» (15.11.2026): дни по Душанбе, когда человек работал —
 * была рабочая смена (work_shifts.date уже хранит дату Душанбе) или он был
 * в системе (вход или последний сигнал сессии; loginAt/lastSeenAt — timestamptz).
 * $1 = userIds (text[]), $2/$3 = границы периода 'YYYY-MM-DD'.
 */
export const ACTIVE_DAYS_SQL = `
  SELECT uid, COUNT(DISTINCT day)::int AS days FROM (
    SELECT ws."employeeId"::text AS uid, ws.date::date AS day
    FROM work_shifts ws
    WHERE ws."employeeId"::text = ANY($1::text[]) AND ws.date::date BETWEEN $2::date AND $3::date
    UNION ALL
    SELECT s."userId"::text, (s."loginAt" AT TIME ZONE 'Asia/Dushanbe')::date
    FROM work_sessions s
    WHERE s."userId"::text = ANY($1::text[])
      AND (s."loginAt" AT TIME ZONE 'Asia/Dushanbe')::date BETWEEN $2::date AND $3::date
    UNION ALL
    SELECT s."userId"::text, (s."lastSeenAt" AT TIME ZONE 'Asia/Dushanbe')::date
    FROM work_sessions s
    WHERE s."userId"::text = ANY($1::text[]) AND s."lastSeenAt" IS NOT NULL
      AND (s."lastSeenAt" AT TIME ZONE 'Asia/Dushanbe')::date BETWEEN $2::date AND $3::date
  ) x
  GROUP BY uid`;

/** Истории ведут SMM-специалисты (роль сторисмейкера упразднена, оставлена
 *  для совместимости) — метрика «План сторис» показывается им (основная или
 *  вторая роль). Руководителю SMM — по проектам, где его назначили
 *  специалистом (30.10.2026); нет таких — метрики нет (план 0). */
function isStoryMaker(user: { role?: string | null; secondaryRole?: string | null }): boolean {
  const STORY_ROLES: string[] = [UserRole.SMM_SPECIALIST, UserRole.SMM_DIRECTOR];
  return STORY_ROLES.includes(user.role || '') || STORY_ROLES.includes(user.secondaryRole || '');
}

/** Руководитель SMM отвечает за сторис только назначенных ему проектов:
 *  участником он числится во многих проектах как руководитель. */
function storiesAssignedOnly(user: { role?: string | null; secondaryRole?: string | null }): boolean {
  const roles = [user.role, user.secondaryRole];
  return roles.includes(UserRole.SMM_DIRECTOR) && !roles.includes(UserRole.SMM_SPECIALIST);
}

/** Направление лидов менеджера продаж — по основной или второй роли
 *  (основная важнее), как фильтр /clients/kpi (15.11.2026). */
function salesDirectionOf(user: { role?: string | null; secondaryRole?: string | null } | null | undefined): ClientLeadDirection | undefined {
  const r = salesRoleOf(user);
  return r === UserRole.SALES_MANAGER_SMM ? ClientLeadDirection.SMM
    : r === UserRole.SALES_MANAGER_DEV ? ClientLeadDirection.DEVELOPMENT
    : undefined;
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
   *  $5 = покрывает ли сотрудник ВСЕ SMM-проекты (флаг «сторисмейкер»),
   *  $7 = дни отпуска/отгула/больничного (date[]) — в план не идут
   *  (15.11.2026: раньше отпуск «проваливал» план сторис). */
  private storiesPlanSql(): string {
    return `WITH bounds AS (SELECT $2::date AS d_from, LEAST($3::date, $4::date) AS d_to),
      days AS (
        SELECT g.day FROM (
          SELECT generate_series(b.d_from, b.d_to, interval '1 day')::date AS day
          FROM bounds b WHERE b.d_to >= b.d_from
        ) g
        WHERE NOT (g.day = ANY($7::date[]))
      ),
      proj AS (
        -- Ждём сторис с НАЧАЛА РАБОТЫ с клиентом; дата записи проекта в CRM —
        -- запасной вариант (проект могли завести задним числом).
        SELECT p.id, COALESCE(p."startDate"::date, p."createdAt"::date) AS since
        FROM projects p
        WHERE p."isArchived" = false
          AND COALESCE(p."storiesArchived", false) = false
          AND p."projectType" = 'SMM'
          -- Ждёт ли проект сторис вообще. Правило то же, что на всех экранах:
          -- решает МЕСЯЧНАЯ норма, дневная — только запасной вариант. Раньше
          -- смотрели одну дневную, и проект с «0 сторис в месяц» попадал в
          -- план как 3 в день.
          AND CASE
                WHEN p."smmData"->>'storiesPerMonth' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerMonth')::int
                WHEN p."smmData"->>'storiesPerDay' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerDay')::int
                ELSE 3
              END > 0
          AND (
            $5::boolean
            -- участие в проекте не считается, если $6 (руководитель SMM)
            OR (NOT $6::boolean AND EXISTS (SELECT 1 FROM project_members pm
                       WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid))
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

  /** Дни отсутствия сотрудников за период (15.11.2026) — как у KPI продаж
   *  (ClientsService.offDays): отметки табеля (shift_absences: отгул, отпуск,
   *  больничный, праздник), отпуска из карточки (employee_vacations) и
   *  текущий статус «В отпуске». Каждый источник отдельно: нет таблицы —
   *  считаем без него. */
  private async offDaysBulk(userIds: string[], fromIso: string, toIso: string): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!userIds.length || fromIso > toIso) return out;
    const q = (sql: string, params: unknown[]): Promise<any[]> =>
      this.taskRepo.manager.query(sql, params).catch(() => [] as any[]);
    const [absences, vacations, current] = await Promise.all([
      q(`SELECT "employeeId"::text AS uid, to_char(date, 'YYYY-MM-DD') AS day FROM shift_absences
         WHERE "employeeId"::text = ANY($1::text[]) AND date BETWEEN $2::date AND $3::date`, [userIds, fromIso, toIso]),
      q(`SELECT "userId"::text AS uid, to_char("dateFrom", 'YYYY-MM-DD') AS "from", to_char("dateUntil", 'YYYY-MM-DD') AS until
         FROM employee_vacations
         WHERE "userId"::text = ANY($1::text[]) AND "dateFrom" <= $3::date AND "dateUntil" >= $2::date`, [userIds, fromIso, toIso]),
      q(`SELECT "userId"::text AS uid, to_char("vacationFrom", 'YYYY-MM-DD') AS "from", to_char("vacationUntil", 'YYYY-MM-DD') AS until
         FROM employees WHERE "userId"::text = ANY($1::text[]) AND status::text = 'vacation'`, [userIds]),
    ]);
    const add = (uid: string, day: string) => {
      if (!uid || !day) return;
      let set = out.get(uid);
      if (!set) { set = new Set(); out.set(uid, set); }
      set.add(day);
    };
    for (const r of absences) add(String(r.uid), String(r.day));
    for (const r of vacations) {
      for (const d of expandRanges([{ from: r.from, until: r.until }], fromIso, toIso)) add(String(r.uid), d);
    }
    // «В отпуске» сейчас, но без дат — отпуск идёт с сегодняшнего дня, а не
    // «всегда» (15.11.2026, как в ClientsService.offDays): иначе прошлые
    // периоды целиком становились выходными и KPI за них пропадал.
    const todayIso = dushanbeDay();
    for (const r of current) {
      const range = currentVacationRange({ from: r.from, until: r.until }, todayIso);
      for (const d of expandRanges([range], fromIso, toIso)) add(String(r.uid), d);
    }
    return out;
  }

  /** Локальная дата YYYY-MM-DD (границы периода — локальные полуночи). */
  private isoDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Сегодняшняя дата в часовом поясе компании (Душанбе). Все суточные
   *  сравнения в KPI идут по ней, а не по UTC-дате сервера. */
  private todayLocal(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
  }

  /** «Сегодня» для ключа кэша: по Душанбе — им считаются наступившие сроки,
   *  и по часам сервера — им periodRange заполняет пустой период. */
  private dayStamp(): string {
    return `${this.todayLocal()}|${this.isoDay(new Date())}`;
  }

  /** KPI одного юзера. Внутри использует bulk-методы (с массивом из одного
   *  id) — переиспользуем код. */
  async getUserKpi(userId: string, from?: string, to?: string): Promise<UserKpi | null> {
    const key = `kpi:user:${userId}:${from || ''}:${to || ''}:${this.dayStamp()}`;
    return cachedResponse(key, KPI_TTL, () => this.computeUserKpi(userId, from, to));
  }

  /** То же без короткого кэша — для тех, кто кэширует результат сам
   *  (прошедшие месяцы профиля), чтобы не плодить лишние записи. */
  async computeUserKpi(userId: string, from?: string, to?: string): Promise<UserKpi | null> {
    const list = await this.bulkKpi([userId], from, to);
    return list[0] || null;
  }

  /** KPI всех активных не-top сотрудников. Для дашборда основателя.
   *  Делает 5 групповых SQL-агрегаций → быстро даже на 100+ юзерах. */
  async getAllKpi(from?: string, to?: string, scope?: DirectionScope | null): Promise<UserKpi[]> {
    // Руководитель направления и основатель видят разный состав — скоуп в ключе.
    const scopeKey = scope ? scope.teamRoles.join(',') : '*';
    const key = `kpi:all:${scopeKey}:${from || ''}:${to || ''}:${this.dayStamp()}`;
    return cachedResponse(key, KPI_TTL, () => this.computeAllKpi(from, to, scope));
  }

  private async computeAllKpi(from?: string, to?: string, scope?: DirectionScope | null): Promise<UserKpi[]> {
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
    const { periodFrom, periodTo } = this.periodRange(from, to);

    // 1) Юзеры — если не передали, грузим сами
    const users = preloadedUsers
      ?? await this.userRepo.find({ where: { id: In(userIds) } });
    const userMap = new Map(users.map(u => [u.id, u]));

    // Дни отсутствия (отпуск, отгул, больничный) — не идут в нормы и планы.
    const fromIso = this.isoDay(periodFrom);
    const toIso = this.isoDay(periodTo);
    const todayIso = this.todayLocal();
    const offByUid = await this.offDaysBulk(userIds, fromIso, toIso);
    const offJson = JSON.stringify(Object.fromEntries([...offByUid].map(([uid, days]) => [uid, [...days]])));

    // 2) Параллельно гонимся за всеми агрегациями.
    // Wave 14: убрали запрос hours/time_logs — метрика «Часов залогировано»
    // выпилена, считать её больше не нужно.
    // «Соблюдено дедлайнов» больше не считается (15.11.2026): метрика была
    // только у продаж, а у них теперь один KPI — тот же, что /clients/kpi.
    const [sessionRows, storyRows, projectRows, deliveryRows, contentRows] = await Promise.all([
      // «Активных дней» (15.11.2026) — дни по Душанбе, когда человек работал:
      // была смена (work_shifts.date — уже дата Душанбе) или он был в
      // системе (вход или последний сигнал сессии). Раньше считали только
      // work_sessions.date — сессия заводится лишь при входе по паролю, а
      // дата в ней по UTC.
      this.sessionRepo.manager.query(ACTIVE_DAYS_SQL, [userIds, fromIso, toIso])
        .catch(e => { this.logger.warn(`activity days KPI query failed: ${e?.message || e}`); return [] as any[]; }),
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
             -- Несданная задача со сроком в день отсутствия в план не идёт.
             AND (t.status::text = 'done' OR NOT jsonb_exists(
                   COALESCE($5::jsonb -> u.uid::text, '[]'::jsonb),
                   to_char((t.deadline AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dushanbe')::date, 'YYYY-MM-DD')))
         )
         SELECT uid,
                COUNT(*)::int AS planned,
                ROUND(SUM(
                  CASE WHEN status <> 'done' THEN 0
                       WHEN closed_at <= deadline THEN 1.0
                       ELSE 0.4 END
                ), 2)::float AS earned
         FROM mine GROUP BY uid`,
        [userIds, periodFrom, periodTo, new Date(), offJson],
      ).catch(e => { this.logger.warn(`task delivery KPI query failed: ${e?.message || e}`); return [] as any[]; }),
      // Публикации и карточки производства в срок — SMM и производство.
      this.taskRepo.manager.query(
        CONTENT_ON_TIME_SQL,
        [userIds, fromIso, toIso, todayIso, offJson],
      ).catch(e => { this.logger.warn(`content on-time KPI query failed: ${e?.message || e}`); return [] as any[]; }),
    ]);

    // 3) Индексируем по userId для быстрого доступа
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
    const contentByUid = new Map<string, { planned: number; earned: number }>();
    for (const r of contentRows) {
      contentByUid.set(r.uid, { planned: Number(r.planned) || 0, earned: Number(r.earned) || 0 });
    }
    /** Метрика «сдано в срок»: план, зачёт и процент. */
    const deliveryItem = (key: string, label: string, d?: { planned: number; earned: number }): KpiItem | null => {
      if (!d || d.planned <= 0) return null;
      const percent = Math.min(100, Math.round((d.earned / d.planned) * 100));
      return { key, label, target: d.planned, value: Math.round(d.earned * 10) / 10, percent, done: percent >= 100 };
    };

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
          [uid, periodFrom, periodTo, this.todayLocal(), coversAll.get(uid) ?? false, storiesAssignedOnly(userMap.get(uid)!),
            [...(offByUid.get(uid) ?? [])]],
        ).catch(e => { this.logger.warn(`stories KPI query failed: ${e?.message || e}`); return [] as any[]; });
        const r = rows?.[0];
        if (r) storyPlanByUid.set(uid, { closed: Number(r.closed) || 0, planned: Number(r.planned) || 0 });
      }));
    }

    // 4) Для МП — запросы к ClientsService, параллельно. МП — по основной
    // ИЛИ второй роли (15.11.2026): раньше МП второй ролью в KPI продаж не
    // попадал вовсе (проверялась только основная роль).
    const salesIds = userIds.filter(uid => {
      const u = userMap.get(uid);
      return !!u && !!salesRoleOf(u);
    });
    const salesKpis = new Map<string, any>();
    await Promise.all(salesIds.map(async (uid) => {
      const u = userMap.get(uid)!;
      // Период — тот же, что у остальных метрик (пустой = текущий месяц).
      // Нормы по рабочим дням и обрезку будущего считает clientsService.kpi.
      const kpi = await this.clientsService
        .kpi(uid, salesDirectionOf(u), this.isoDay(periodFrom), this.isoDay(periodTo))
        .catch((e: any) => { this.logger.warn(`sales KPI failed for ${uid}: ${e?.message || e}`); return null; });
      if (kpi) salesKpis.set(uid, kpi);
    }));

    // 5) Собираем финальный результат для каждого userId
    return userIds.map(uid => {
      const user = userMap.get(uid);
      if (!user || TOP_ROLES.has(user.role)) {
        return null;
      }
      // «Один KPI» (15.11.2026, SALES_SPEC §6): у менеджера продаж (основной
      // или второй ролью) /kpi/user — ровно те 5 метрик и тот же общий
      // процент, что /clients/kpi. Раньше здесь добавлялись «Соблюдено
      // дедлайнов» и «Активных дней», и у одного менеджера было два разных
      // KPI на соседних экранах. Ключи — с префиксом sales_ (детализация
      // /kpi/user/:id/details понимает оба вида).
      if (salesRoleOf(user)) {
        const sales = salesKpis.get(uid);
        const salesItems = salesKpiItems(sales);
        return {
          userId: uid,
          role: user.role,
          periodFrom: periodFrom.toISOString(),
          periodTo: periodTo.toISOString(),
          overallPercent: salesItems.length ? Math.min(100, Math.max(0, Number(sales?.overallPercent) || 0)) : 0,
          noData: salesItems.length === 0,
          items: salesItems,
        } as UserKpi;
      }

      const actDays = activityByUid.get(uid) || 0;

      const items: KpiItem[] = [];

      // Команда разработки — роль задач: доской она не пользуется, её
      // дисциплина считается по задачам. (Продажи — выше, своим KPI.)
      // Все остальные производственные роли живут ТОЛЬКО доской, сторисмейкер —
      // ТОЛЬКО сторис. «Активные дни» из оценки убраны: вход в систему не
      // является работой.
      const isDevTeam = user.role === UserRole.DEVELOPER || user.role === UserRole.PM_DEV;
      if (isDevTeam) {
        // Нормы «столько-то задач» нет — сколько выдали, столько и надо
        // сдать. План — выданные задачи со сроком, зачёт — сдано вовремя 1.0,
        // с опозданием 0.4. Процент «Соблюдено дедлайнов» им НЕ показываем:
        // одна просрочка не должна бить дважды.
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
        // Норма активных дней — рабочие дни периода (пн–сб), которые уже
        // наступили, без отпуска и отметок табеля; выходной — без пункта
        // (15.11.2026: раньше норма считалась от длины всего периода, и
        // текущий месяц выглядел проваленным из-за будущих дней).
        const workDays = workingDays(fromIso, toIso, todayIso, offByUid.get(uid) ?? []).length;
        const activity = salesActivityItem(actDays, workDays);
        if (activity) items.push(activity);
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

      // Профиль сотрудника (17.10.2026): SMM-специалист — публикации в срок,
      // производство — свои карточки в срок; и те и другие — задачи
      // руководителя в срок (правило то же, что у разработки).
      const isProduction = PRODUCTION_ROLES.has(user.role);
      if (SMM_ROLES.has(user.role) || isProduction) {
        const content = deliveryItem('content_on_time',
          isProduction ? PRODUCTION_LABEL[user.role] : 'Публикации в срок', contentByUid.get(uid));
        if (content) items.push(content);
        const tasks = deliveryItem('task_delivery', 'Задачи сдано в срок', deliveryByUid.get(uid));
        if (tasks) items.push(tasks);
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
    // Продажи — те же границы, что у их KPI: сутки по Душанбе, без будущего.
    const sp = salesPeriod(this.isoDay(periodFrom), this.isoDay(periodTo), new Date());
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return [];
    // Направление — по основной или второй роли, как в самом KPI (15.11.2026).
    const direction: ClientLeadDirection | undefined = salesDirectionOf(user);

    // Дни отсутствия сотрудника — как в KPI (план сторис, сдача в срок).
    const offDays = async (): Promise<string[]> =>
      [...((await this.offDaysBulk([userId], this.isoDay(periodFrom), this.isoDay(periodTo))).get(userId) ?? [])];

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
      'content_on_time', 'task_delivery',
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
             SELECT g.day FROM (
               SELECT generate_series(b.d_from, b.d_to, interval '1 day')::date AS day
               FROM bounds b WHERE b.d_to >= b.d_from
             ) g
             WHERE NOT (g.day = ANY($7::date[]))
           ),
           proj AS (
             SELECT p.id, p.name, COALESCE(p."startDate"::date, p."createdAt"::date) AS since FROM projects p
             WHERE p."isArchived" = false
               AND COALESCE(p."storiesArchived", false) = false
               AND p."projectType" = 'SMM'
               AND CASE
                     WHEN p."smmData"->>'storiesPerMonth' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerMonth')::int
                     WHEN p."smmData"->>'storiesPerDay' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerDay')::int
                     ELSE 3
                   END > 0
               AND ($5::boolean OR (NOT $6::boolean AND EXISTS (
                 SELECT 1 FROM project_members pm
                 WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid))
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
          [userId, periodFrom, periodTo, this.todayLocal(), !!emp?.isStoryMaker, storiesAssignedOnly(user), await offDays()],
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
      // Как в KPI: только lead_progress. activity_logs (legacy) — лишь если
      // таблица недоступна (запрос упал): откатов там нет.
      case 'sales_funnel_progress': {
        let tableRows: any[] | null = null;
        try {
          tableRows = await this.activityRepo.manager.query(
            `SELECT id, lead_id, lead_name, stage_from, stage_to, status_from, status_to, created_at
             FROM lead_progress
             WHERE user_id = $1 AND created_at BETWEEN $2 AND $3
             ORDER BY created_at DESC`,
            [userId, sp.start, sp.until],
          );
        } catch (e: any) {
          this.logger.warn(`lead_progress details query failed: ${e?.message || e}`);
        }
        if (tableRows) {
          return tableRows.map(r => ({
            id: r.id,
            title: r.lead_name || 'Лид',
            subtitle: [
              r.status_to && r.status_from ? `${r.status_from} → ${r.status_to}` : null,
              r.stage_to && r.stage_from !== r.stage_to
                ? `этап: ${r.stage_from ?? '—'} → ${r.stage_to}`
                : (r.stage_to ? `этап: ${r.stage_to}` : null),
            ].filter(Boolean).join(' · ') || null,
            date: r.created_at ? new Date(r.created_at).toISOString() : null,
            // Deep-link на клиента; у старых записей без lead_id — на базу.
            link: r.lead_id ? `/clients?id=${r.lead_id}` : '/clients',
          }));
        }
        const legacyRows = await this.activityRepo
          .createQueryBuilder('a')
          .where('a.userId = :uid', { uid: userId })
          .andWhere('a.action = :act', { act: ActivityAction.LEAD_PROGRESS })
          .andWhere('a.createdAt BETWEEN :from AND :to', { from: sp.start, to: sp.until })
          .orderBy('a.createdAt', 'DESC')
          .getMany().catch(() => []);
        return legacyRows.map(r => {
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
            // У activity_logs нет lead_id — ссылка общая.
            link: '/clients',
          };
        });
      }

      // ─── Sales: новые компании в базе (заведены в периоде) ─────────────
      case 'sales_new_companies': {
        const qb = this.leadRepo.createQueryBuilder('c')
          .where('c.ownerId = :uid', { uid: userId })
          .andWhere('c.createdAt BETWEEN :from AND :to', { from: sp.start, to: sp.until })
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
      // Как в KPI: события lead_actions. По состоянию лидов (callType=cold)
      // — только для периодов, целиком закончившихся до появления событий.
      case 'sales_cold_calls': {
        if (sp.toIso < COLD_CALL_EVENTS_SINCE) {
          const qb = this.leadRepo.createQueryBuilder('c')
            .where('c.ownerId = :uid', { uid: userId })
            .andWhere(`LOWER(COALESCE(c."callType", '')) = 'cold'`)
            .andWhere('c.updatedAt BETWEEN :from AND :to', { from: sp.start, to: sp.until })
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
        const rows = await this.leadRepo.manager.query(
          `SELECT la.id, la.created_at AS date, la.lead_id,
                  cl.name, cl.channel, cl."contactPhone", cl."contactInstagram", cl."contactPerson"
           FROM lead_actions la
           LEFT JOIN client_leads cl ON cl.id = la.lead_id
           WHERE la.user_id = $1 AND la.kind = 'cold_call'
             AND la.created_at BETWEEN $2 AND $3
           ORDER BY la.created_at DESC`,
          [userId, sp.start, sp.until],
        ).catch(() => [] as any[]);
        return rows.map((r: any) => ({
          id: r.id,
          title: r.name || 'Лид удалён',
          subtitle: [r.channel, r.contactPhone || r.contactInstagram || r.contactPerson]
            .filter(Boolean).join(' · ') || null,
          date: r.date ? new Date(r.date).toISOString() : null,
          link: r.lead_id ? `/clients?id=${r.lead_id}` : undefined,
        }));
      }

      // ─── Sales: персональные письма ────────────────────────────────────
      // Как в KPI: события отметки «Написал» (lead_actions, kind=email).
      case 'sales_personal_emails': {
        const rows = await this.leadRepo.manager.query(
          `SELECT la.id, la.created_at AS date, la.lead_id,
                  cl.name, cl.channel, cl."contactEmail", cl."contactPerson"
           FROM lead_actions la
           LEFT JOIN client_leads cl ON cl.id = la.lead_id
           WHERE la.user_id = $1 AND la.kind = 'email'
             AND la.created_at BETWEEN $2 AND $3
           ORDER BY la.created_at DESC`,
          [userId, sp.start, sp.until],
        ).catch(() => [] as any[]);
        return rows.map((r: any) => ({
          id: r.id,
          title: r.name || 'Лид удалён',
          subtitle: [r.contactEmail || r.channel, r.contactPerson].filter(Boolean).join(' · ') || null,
          date: r.date ? new Date(r.date).toISOString() : null,
          link: r.lead_id ? `/clients?id=${r.lead_id}` : undefined,
        }));
      }

      // ─── Sales: встречи / созвоны ──────────────────────────────────────
      // Как в KPI: события «meeting» на время встречи, которое уже наступило.
      case 'sales_meetings': {
        const rows = await this.leadRepo.manager.query(
          `SELECT la.id, la."at" AS date, la.lead_id,
                  cl.name, cl.channel, cl."contactPerson", cl."contactPhone"
           FROM lead_actions la
           LEFT JOIN client_leads cl ON cl.id = la.lead_id
           WHERE la.user_id = $1 AND la.kind = 'meeting'
             AND la."at" BETWEEN $2 AND $3
           ORDER BY la."at" ASC`,
          [userId, sp.start, sp.until],
        ).catch(() => [] as any[]);
        return rows.map((r: any) => ({
          id: r.id,
          title: r.name || 'Лид удалён',
          subtitle: [r.channel, r.contactPerson || r.contactPhone].filter(Boolean).join(' · ') || null,
          date: r.date ? new Date(r.date).toISOString() : null,
          link: r.lead_id ? `/clients?id=${r.lead_id}` : undefined,
        }));
      }

      // ─── Универсальное: соблюдено дедлайнов (по задачам) ──────────────
      case 'deadline_rate': {
        // Как в KPI (15.11.2026): закрытые в периоде по completedAt, только
        // со сроком, исполнитель — основной или со-исполнитель.
        const tasks = await this.taskRepo.manager.query(
          `SELECT t.id, t.title, t.deadline,
                  COALESCE(t."completedAt", t."reviewedAt", t."updatedAt") AS closed_at
           FROM tasks t
           WHERE (t."assigneeId" = $1::uuid
                  OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = t.id AND ta."userId" = $1::uuid))
             AND t.status::text = 'done'
             AND t.deadline IS NOT NULL
             AND COALESCE(t."completedAt", t."reviewedAt", t."updatedAt") BETWEEN $2 AND $3
           ORDER BY closed_at DESC`,
          [userId, periodFrom, periodTo],
        );
        return (tasks as any[]).map(t => {
          const closedAt = t.closed_at;
          const onTime = new Date(closedAt) <= new Date(t.deadline);
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

      // ─── Публикации / карточки производства в срок ─────────────────────
      case 'content_on_time': {
        const rows: any[] = await this.taskRepo.manager.query(
          `SELECT ci.id, COALESCE(NULLIF(ci.topic, ''), 'Без названия') AS title, p.name AS project,
                  ci."projectId" AS "projectId", ci.status::text AS status,
                  to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS due,
                  -- День публикации по Душанбе (15.11.2026), у старых — правка.
                  to_char((COALESCE(ci."publishedAt", ci."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dushanbe')::date, 'YYYY-MM-DD') AS closed
           FROM content_plan_items ci
           JOIN projects p ON p.id = ci."projectId" AND p."isArchived" = false AND p."projectType" = 'SMM'
           WHERE ci.status::text <> 'cancelled'
             AND ci."publishDate" IS NOT NULL
             AND ci."publishDate"::date BETWEEN $2::date AND $3::date
             AND (ci."publishDate"::date <= $4::date OR ci.status::text = 'published')
             AND (ci.status::text = 'published' OR NOT (to_char(ci."publishDate"::date, 'YYYY-MM-DD') = ANY($5::text[])))
             AND ((ci."shootForItemId" IS NULL AND ci."contentType"::text <> 'story' AND (
                    jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), $1::text)
                    OR EXISTS (SELECT 1 FROM project_members pm WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid)))
                  OR (ci."shootForItemId" IS NOT NULL AND ci."assigneeId" = $1::uuid))
           ORDER BY ci."publishDate" DESC`,
          [userId, this.isoDay(periodFrom), this.isoDay(periodTo), this.todayLocal(), await offDays()],
        ).catch(() => []);
        return rows.map(r => {
          const done = r.status === 'published';
          const onTime = done && r.closed <= r.due;
          return {
            id: r.id,
            title: r.title,
            subtitle: `${r.project} · ${!done ? 'не сдано' : onTime ? 'в срок' : 'с опозданием'}`,
            date: r.due,
            link: null,
            meta: { onTime, done },
          };
        });
      }

      // ─── Задачи со сроком: сдано вовремя / с опозданием / не сдано ─────
      case 'task_delivery': {
        const rows: any[] = await this.taskRepo.manager.query(
          `SELECT t.id, t.title, t.deadline, t.status::text AS status,
                  COALESCE(t."completedAt", t."reviewedAt", t."updatedAt") AS closed_at
           FROM tasks t
           WHERE (t."assigneeId" = $1::uuid
                  OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = t.id AND ta."userId" = $1::uuid))
             AND t.status::text <> 'cancelled'
             AND t.deadline IS NOT NULL
             AND t.deadline BETWEEN $2 AND $3
             AND (t.deadline <= $4 OR t.status::text = 'done')
             AND (t.status::text = 'done' OR NOT (
                   to_char((t.deadline AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dushanbe')::date, 'YYYY-MM-DD') = ANY($5::text[])))
           ORDER BY t.deadline DESC`,
          [userId, periodFrom, periodTo, new Date(), await offDays()],
        ).catch(() => []);
        return rows.map(t => {
          const done = t.status === 'done';
          const onTime = done && new Date(t.closed_at) <= new Date(t.deadline);
          return {
            id: t.id,
            title: t.title,
            subtitle: !done ? 'не сдана' : onTime ? 'в срок' : 'с опозданием',
            date: t.deadline ? new Date(t.deadline).toISOString() : null,
            link: `/tasks/${t.id}`,
            meta: { onTime, done },
          };
        });
      }

      // ─── Универсальное: активные дни (work_sessions) ───────────────────
      case 'activity_days': {
        // Как в KPI (15.11.2026): дни по Душанбе со сменой или работой в
        // системе (вход / последний сигнал сессии).
        const rows = await this.sessionRepo.manager.query(
          `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                  SUM(shifts)::int AS shifts, SUM(sessions)::int AS sessions, MIN(first_at) AS first_at
           FROM (
             SELECT ws.date::date AS day, 1 AS shifts, 0 AS sessions, ws."startedAt" AT TIME ZONE 'UTC' AS first_at
             FROM work_shifts ws
             WHERE ws."employeeId"::text = $1 AND ws.date::date BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT (s."loginAt" AT TIME ZONE 'Asia/Dushanbe')::date, 0, 1, s."loginAt"
             FROM work_sessions s
             WHERE s."userId"::text = $1
               AND (s."loginAt" AT TIME ZONE 'Asia/Dushanbe')::date BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT (s."lastSeenAt" AT TIME ZONE 'Asia/Dushanbe')::date, 0, 0, s."lastSeenAt"
             FROM work_sessions s
             WHERE s."userId"::text = $1 AND s."lastSeenAt" IS NOT NULL
               AND (s."lastSeenAt" AT TIME ZONE 'Asia/Dushanbe')::date BETWEEN $2::date AND $3::date
           ) x
           GROUP BY day
           ORDER BY day DESC`,
          [String(userId), this.isoDay(periodFrom), this.isoDay(periodTo)],
        ).catch(() => [] as any[]);
        return (rows as any[]).map(r => ({
          id: String(r.day),
          title: new Date(`${r.day}T12:00:00Z`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' }),
          subtitle: [
            Number(r.shifts) > 0 ? `смен: ${r.shifts}` : null,
            Number(r.sessions) > 0 ? `входов: ${r.sessions}` : null,
          ].filter(Boolean).join(' · ') || 'в системе',
          date: r.first_at ? new Date(r.first_at).toISOString() : null,
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
