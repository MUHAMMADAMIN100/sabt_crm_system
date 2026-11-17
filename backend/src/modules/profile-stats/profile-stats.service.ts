import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { KpiService, UserKpi } from '../kpi/kpi.service';
import { WorkShiftsService } from '../work-shifts/work-shifts.service';
import { directionScopeOf, isInDirection } from '../../common/direction-scope';
import { cachedResponse } from '../../common/response-cache';
// «Компас компании» (16.11.2026): общие правила отделов и источники цифр —
// простые файлы без DI, модуль компаса сюда не импортируется.
import { DEPT_NAME, departmentOfRole, isDeptKey, leadsOf, resolveLeaders } from '../goals/departments';
import { leadsMember } from '../goals/goals-access';
import { contentOntime, tasksOntime, wonDeals } from '../goals/goal-sources';
import { monthWindow } from '../goals/goals.logic';
import type { ChainKeyResult, DeptKey, KrLevel } from '../goals/goals.types';
import { EmployeeGoal } from './employee-goal.entity';
import {
  BONUS_RULE, Delivery, GOAL_METRICS, GoalMetrics, GoalRow, MAX_GOALS_PER_MONTH, MonthEff, PRODUCTION_UNIT,
  SOURCE_GOAL_METRICS, ShiftDay, StoryDay, WorkKind,
  achievementsOf, deliveryStreak, goalProgress, levelOf, metricFits, pointsOf, storyDayOk, storyStreak, streaks,
} from './profile-stats.logic';

type Actor = { id: string; role?: string | null; secondaryRole?: string | null };
/** Табель месяца для серий: минуты по дням и дни опозданий. */
type ShiftMonthLite = { days: Record<number, number>; lateDays: number[] };

/** Руководство: KPI и профиля-аналитики у них нет. */
const TOP_ROLES = ['admin', 'founder'];
/** Команда руководителя СММ — ему можно ставить им цели. */
const SMM_TEAM = ['smm_specialist', 'videographer', 'video_editor', 'designer', 'targetologist', 'stories_checker'];
const PRODUCTION = ['videographer', 'video_editor', 'designer'];
/** Сколько целей на месяц (макет: «1–3 цели»). */
const MAX_GOALS = MAX_GOALS_PER_MONTH;
/** История смен для серии и очков — полгода. */
const SHIFT_MONTHS = 6;
/** История эффективности для достижений — полгода прошедших месяцев. */
const EFF_MONTHS = 6;
/** Закрытые месяцы профиля (KPI и смены) почти не меняются, а считались при
 *  каждом открытии: 6 KPI и 5 табелей. Держим их час на человека (08.11.2026);
 *  любое событие изменения и запись смен/контент-плана кэш сбрасывают. */
const PAST_TTL = 60 * 60_000;

const todayDushanbe = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
const shiftYm = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthEnd = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const YM = /^\d{4}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Цель месяца с цифрой — для «Компаса компании» (цепочка и цели людей). */
export interface GoalRowView {
  id: string;
  title: string;
  metric: string | null;
  target: number | null;
  done: boolean;
  value: number | null;
  reached: boolean;
  keyResultId: string | null;
}

/** Результат компаса в списке «Работает на» редактора целей. */
export interface KeyResultOption {
  id: string;
  title: string;
  level: KrLevel;
  department: DeptKey | null;
  departmentName: string | null;
}

const NO_METRICS: GoalMetrics = { efficiency: null, kpi: {}, storyOkDays: 0, ontimeShifts: 0 };

/**
 * Личный профиль сотрудника (вариант Б, решение владельца 17.10.2026):
 * эффективность месяца — та же, что в KPI команды, серии, очки и уровень,
 * достижения, цели месяца и бонус. Каждый видит только себя; цели ставят
 * руководитель направления и основатель.
 */
@Injectable()
export class ProfileStatsService {
  private readonly logger = new Logger(ProfileStatsService.name);

  constructor(
    @InjectRepository(EmployeeGoal) private goalRepo: Repository<EmployeeGoal>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private kpi: KpiService,
    private shifts: WorkShiftsService,
    private ds: DataSource,
  ) {}

  private rolesOf(a: Actor) { return [a.role, a.secondaryRole].filter(Boolean) as string[]; }

  private kindOf(u: Actor): WorkKind {
    const roles = this.rolesOf(u);
    if (roles.includes('smm_specialist')) return 'smm';
    if (PRODUCTION.includes(u.role || '')) return 'production';
    return 'tasks';
  }

  private q<T = any>(sql: string, params: any[], what: string): Promise<T[]> {
    return this.ds.query(sql, params).catch((e: any) => {
      this.logger.warn(`${what} query failed: ${e?.message || e}`);
      return [] as T[];
    });
  }

  // ── Данные ──

  private effOf(k: UserKpi | null): number | null {
    return !k || k.noData ? null : k.overallPercent;
  }

  private kpiOf(userId: string, ym: string) {
    return this.kpi.getUserKpi(userId, `${ym}-01`, monthEnd(ym)).catch(() => null);
  }

  /** Сторис по дням: сколько своих проектов ждали, сколько получили, сколько закрыл сам. */
  private async storyDays(userId: string, from: string, to: string): Promise<StoryDay[]> {
    if (from > to) return [];
    const [emp] = await this.q(`SELECT "isStoryMaker" FROM employees WHERE "userId" = $1 LIMIT 1`, [userId], 'story maker');
    const rows = await this.q(
      `WITH days AS (SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day),
       proj AS (
         SELECT p.id, COALESCE(p."startDate"::date, p."createdAt"::date) AS since
         FROM projects p
         WHERE p."isArchived" = false
           AND COALESCE(p."storiesArchived", false) = false
           AND p."projectType" = 'SMM'
           AND CASE
                 WHEN p."smmData"->>'storiesPerMonth' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerMonth')::int
                 WHEN p."smmData"->>'storiesPerDay' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerDay')::int
                 ELSE 3
               END > 0
           AND ($4::boolean
             OR EXISTS (SELECT 1 FROM project_members pm WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid)
             OR jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), $1::uuid::text))
       ),
       grid AS (SELECT proj.id AS pid, days.day FROM proj CROSS JOIN days WHERE days.day >= proj.since),
       logs AS (
         SELECT sl."projectId" AS pid, sl.date::date AS day,
                SUM(CASE WHEN sl."employeeId" = $1::uuid THEN sl."storiesCount" ELSE 0 END) AS mine,
                SUM(sl."storiesCount") AS total
         FROM story_logs sl
         WHERE sl.date::date BETWEEN $2::date AND $3::date
         GROUP BY 1, 2
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COUNT(g.pid)::int AS projects,
              COUNT(g.pid) FILTER (WHERE COALESCE(l.total, 0) > 0)::int AS covered,
              COUNT(g.pid) FILTER (WHERE COALESCE(l.mine, 0) > 0)::int AS mine
       FROM days d
       LEFT JOIN grid g ON g.day = d.day
       LEFT JOIN logs l ON l.pid = g.pid AND l.day = g.day
       GROUP BY d.day ORDER BY d.day`,
      [userId, from, to, !!emp?.isStoryMaker], 'story days',
    );
    return rows.map((r: any) => ({ day: r.day, projects: Number(r.projects) || 0, covered: Number(r.covered) || 0, mine: Number(r.mine) || 0 }));
  }

  /** Всё, что сдавалось со сроком: задачи и (по направлению) карточки контент-плана. */
  private async deliveries(userId: string, kind: WorkKind, today: string): Promise<Delivery[]> {
    const [tasks, content] = await Promise.all([
      this.q(
        `SELECT to_char(t.deadline::date, 'YYYY-MM-DD') AS due,
                (t.status::text = 'done' AND COALESCE(t."completedAt", t."reviewedAt", t."updatedAt") <= t.deadline) AS "onTime"
         FROM tasks t
         WHERE (t."assigneeId" = $1::uuid
                OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = t.id AND ta."userId" = $1::uuid))
           AND t.status::text <> 'cancelled'
           AND t.deadline IS NOT NULL
           AND (t.deadline <= now() OR t.status::text = 'done')`,
        [userId], 'deliveries tasks',
      ),
      kind === 'tasks' ? Promise.resolve([]) : this.q(
        `SELECT to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS due,
                -- День публикации по Душанбе (publishedAt; у старых — правка), 15.11.2026.
                (ci.status::text = 'published'
                 AND (COALESCE(ci."publishedAt", ci."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dushanbe')::date
                     <= ci."publishDate"::date) AS "onTime"
         FROM content_plan_items ci
         JOIN projects p ON p.id = ci."projectId" AND p."projectType" = 'SMM'
         WHERE ci.status::text <> 'cancelled'
           AND ci."publishDate" IS NOT NULL
           AND (ci."publishDate"::date <= $2::date OR ci.status::text = 'published')
           AND (($3 = 'smm' AND ci."shootForItemId" IS NULL AND ci."contentType"::text <> 'story' AND (
                   jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), $1::text)
                   OR EXISTS (SELECT 1 FROM project_members pm WHERE pm."projectsId" = p.id AND pm."usersId" = $1::uuid)))
             OR ($3 = 'production' AND ci."shootForItemId" IS NOT NULL AND ci."assigneeId" = $1::uuid))`,
        [userId, today, kind], 'deliveries content',
      ),
    ]);
    return [
      ...tasks.map((r: any) => ({ due: r.due, onTime: !!r.onTime, kind: 'task' as const })),
      ...content.map((r: any) => ({ due: r.due, onTime: !!r.onTime, kind: 'content' as const })),
    ];
  }

  /** Табель месяца — только то, что нужно сериям: дни с часами и опоздания. */
  private async shiftMonthLite(userId: string, m: string): Promise<ShiftMonthLite> {
    const r = await this.shifts.myMonth(userId, m);
    return { days: r.item.days || {}, lateDays: r.item.lateDays || [] };
  }

  /** Прошедшие месяцы профиля одним куском: эффективность по KPI и табели.
   *  Ошибку не кэшируем — тогда считаем как раньше, по месяцу с подстраховкой. */
  private async pastMonths(userId: string, effYms: string[], shiftYms: string[]) {
    const key = `profile:past:${userId}:${effYms.join(',')}:${shiftYms.join(',')}`;
    return cachedResponse(key, PAST_TTL, async () => {
      const [kpis, shifts] = await Promise.all([
        Promise.all(effYms.map(m => this.kpi.computeUserKpi(userId, `${m}-01`, monthEnd(m)))),
        Promise.all(shiftYms.map(m => this.shiftMonthLite(userId, m))),
      ]);
      return { kpis, shifts: shifts as Array<ShiftMonthLite | null> };
    }).catch(async () => ({
      kpis: await Promise.all(effYms.map(m => this.kpiOf(userId, m))),
      shifts: await Promise.all(shiftYms.map(m => this.shiftMonthLite(userId, m).catch(() => null))),
    }));
  }

  /** Смены за последние месяцы: рабочие дни и опоздания. */
  private shiftHistory(months: string[], res: Array<ShiftMonthLite | null>) {
    const days: ShiftDay[] = [];
    const perMonth: Array<{ ym: string; worked: number; late: number }> = [];
    res.forEach((r, i) => {
      const it: any = r;
      const late = new Set<number>(it?.lateDays || []);
      const worked = Object.entries(it?.days || {})
        .filter(([, min]) => Number(min) > 0)
        .map(([d]) => Number(d))
        .sort((a, b) => a - b);
      for (const d of worked) days.push({ day: `${months[i]}-${String(d).padStart(2, '0')}`, late: late.has(d) });
      perMonth.push({ ym: months[i], worked: worked.length, late: [...late].filter(d => worked.includes(d)).length });
    });
    return { days, perMonth };
  }

  private async hireDate(userId: string): Promise<string | null> {
    const [r] = await this.q(
      `SELECT to_char(COALESCE(fe."hireDate"::date, e."hireDate"::date, u."createdAt"::date), 'YYYY-MM-DD') AS hire
       FROM users u
       LEFT JOIN finance_employees fe ON fe."userId" = u.id
       LEFT JOIN employees e ON e."userId" = u.id
       WHERE u.id = $1 LIMIT 1`,
      [userId], 'hire date',
    );
    return r?.hire || null;
  }

  private monthsBetween(from: string, to: string) {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
  }

  // ── Профиль ──

  /** Аналитика личного профиля — только себе (id берётся из токена). */
  async forMe(actor: Actor) {
    const user = await this.userRepo.findOne({ where: { id: actor.id } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    if (TOP_ROLES.includes(user.role)) return { visible: false as const };

    const today = todayDushanbe();
    const ym = today.slice(0, 7);
    const kind = this.kindOf(user);

    const [firstLog] = kind === 'smm'
      ? await this.q(`SELECT to_char(MIN(date)::date, 'YYYY-MM-DD') AS first FROM story_logs WHERE "employeeId" = $1`, [user.id], 'first story')
      : [null];
    const storyFrom = firstLog?.first ? [firstLog.first, addDays(today, -400)].sort()[1] : null;

    const pastYms = Array.from({ length: EFF_MONTHS }, (_, i) => shiftYm(ym, -(EFF_MONTHS - i)));
    // Смены — полгода по текущий месяц; прошедшие из них берём из кэша.
    const shiftYms = Array.from({ length: SHIFT_MONTHS }, (_, i) => shiftYm(ym, -(SHIFT_MONTHS - 1 - i)));
    const [kpiNow, past, shiftNow, days, deliveries, hire, totals, goals] = await Promise.all([
      this.kpiOf(user.id, ym),
      this.pastMonths(user.id, pastYms, shiftYms.slice(0, -1)),
      this.shiftMonthLite(user.id, ym).catch(() => null),
      storyFrom ? this.storyDays(user.id, storyFrom, today) : Promise.resolve([] as StoryDay[]),
      this.deliveries(user.id, kind, today),
      this.hireDate(user.id),
      kind === 'smm'
        ? this.q(`SELECT COALESCE(SUM("storiesCount"), 0)::int AS total FROM story_logs WHERE "employeeId" = $1`, [user.id], 'stories total')
        : Promise.resolve([{ total: 0 }]),
      this.goalRepo.find({ where: { userId: user.id, ym }, order: { createdAt: 'ASC' } }),
    ]);

    const pastKpis = past.kpis;
    const shiftsHist = this.shiftHistory(shiftYms, [...past.shifts, shiftNow]);
    const pastEff: MonthEff[] = pastKpis.map((k, i) => ({ ym: pastYms[i], percent: this.effOf(k) }));
    const nowEff = this.effOf(kpiNow);
    const prev = pastEff[pastEff.length - 1];

    // Серии.
    const story = storyStreak(days, today);
    const ds = deliveryStreak(deliveries);
    const shiftRun = streaks(shiftsHist.days.map(d => !d.late));
    const monthDays = days.filter(d => d.day.startsWith(ym));
    const storyOkMonth = monthDays.filter(storyDayOk).length;

    // Лучший полный месяц сторис — для «Сторис 30 из 30».
    const byMonth = new Map<string, { ok: number; days: number }>();
    for (const d of days) {
      if (d.day.startsWith(ym) || d.projects === 0) continue;
      const m = byMonth.get(d.day.slice(0, 7)) || { ok: 0, days: 0 };
      m.days += 1; if (storyDayOk(d)) m.ok += 1;
      byMonth.set(d.day.slice(0, 7), m);
    }
    const fullMonths = [...byMonth.values()].filter(m => m.days >= 28);
    const storyBestMonth = fullMonths.sort((a, b) => b.ok / b.days - a.ok / a.days)[0]
      || { ok: storyOkMonth, days: Number(monthEnd(ym).slice(8, 10)) };

    const tasksOnTime = deliveries.filter(d => d.kind === 'task' && d.onTime).length;
    const contentOnTime = deliveries.filter(d => d.kind === 'content' && d.onTime).length;
    const lateDays = shiftsHist.perMonth.reduce((s, m) => s + m.late, 0);
    const level = levelOf(pointsOf({ storyOkDays: story.okDays, contentOnTime, tasksOnTime, lateDays }));

    const tenureMonths = hire ? this.monthsBetween(hire, today) : 0;
    const achievements = achievementsOf({
      kind, role: user.role, tenureMonths,
      shiftMonths: shiftsHist.perMonth.filter(m => m.ym < ym),
      pastEff, nowEff, deliveries, tasksOnTime, contentOnTime,
      storiesTotal: Number(totals[0]?.total) || 0,
      storyBest: story.best, storyBestMonth, today,
    });

    const curShifts = shiftsHist.perMonth.find(m => m.ym === ym);
    const metrics: GoalMetrics = {
      efficiency: nowEff,
      kpi: Object.fromEntries((kpiNow?.items || []).map(it => [it.key, it.percent])),
      storyOkDays: storyOkMonth,
      ontimeShifts: curShifts ? curShifts.worked - curShifts.late : 0,
    };
    // Показатели компаса (сделки, публикации и задачи в срок) — только если
    // есть такие цели.
    Object.assign(metrics, await this.sourceMetrics(user.id, ym, goals.map(g => g.metric)));

    const unit = kind === 'smm' ? 'days' : kind === 'production' ? 'cards' : 'tasks';
    return {
      visible: true as const,
      today, ym, kind,
      hireDate: hire, tenureMonths,
      level,
      streak: {
        unit,
        current: kind === 'smm' ? story.current : ds.current,
        best: kind === 'smm' ? story.best : ds.best,
        shiftsNoLate: shiftRun.current,
      },
      efficiency: {
        percent: nowEff,
        prevYm: prev?.ym || shiftYm(ym, -1),
        delta: nowEff !== null && prev?.percent != null ? nowEff - prev.percent : null,
        items: (kpiNow?.items || []).map(it => ({ key: it.key, label: it.label, value: it.value, target: it.target, percent: it.percent })),
      },
      bonus: { ...BONUS_RULE, percent: nowEff },
      goals: await this.withKeyResults(goals.map(g => goalProgress(this.goalRow(g), metrics))),
      achievements,
      productionLabel: PRODUCTION_UNIT[user.role]?.label || null,
    };
  }

  // ── Цели месяца ──

  private goalRow(g: EmployeeGoal): GoalRow {
    return { id: g.id, title: g.title, metric: g.metric, target: g.target, done: g.done, keyResultId: g.keyResultId ?? null };
  }

  /** Ставить цели: основатель и админ — всем, руководитель направления —
   *  своей команде, руководитель отдела «Компаса» — членам своего отдела
   *  (16.11.2026). Себе цели не ставят. */
  private async canManage(actor: Actor, target: User): Promise<boolean> {
    if (TOP_ROLES.includes(target.role)) return false;
    const roles = this.rolesOf(actor);
    if (roles.some(r => TOP_ROLES.includes(r))) return true;
    if (actor.id === target.id) return false;
    const scope = directionScopeOf(actor);
    if (scope && isInDirection(scope, target)) return true;
    if (roles.includes('smm_director')
      && (SMM_TEAM.includes(target.role) || SMM_TEAM.includes(target.secondaryRole || ''))) return true;
    const leaders = await resolveLeaders(this.ds).catch(() => null);
    return !!leaders && leadsMember(actor, leadsOf(actor, leaders), target);
  }

  /** Показатели компаса по самому сотруднику: выигранные сделки (его лиды),
   *  публикации своих проектов и свои задачи в срок. Считаем только нужные. */
  private async sourceMetrics(userId: string, ym: string, need: Array<string | null>): Promise<Partial<GoalMetrics>> {
    const want = need.filter((m): m is string => !!m && SOURCE_GOAL_METRICS.includes(m));
    if (!want.length) return {};
    const win = monthWindow(ym, todayDushanbe());
    if (!win) return {};
    const [won, content, tasks] = await Promise.all([
      want.includes('won_deals') ? wonDeals(this.ds, win, { ownerId: userId }) : Promise.resolve(null),
      want.includes('content_ontime') ? contentOntime(this.ds, win, { userId }) : Promise.resolve(null),
      want.includes('tasks_ontime') ? tasksOntime(this.ds, win, { userId }) : Promise.resolve(null),
    ]);
    const out: Partial<GoalMetrics> = {};
    if (won) out.wonDeals = won.value;
    if (content) out.contentOntime = content.value;
    if (tasks) out.tasksOntime = tasks.value;
    return out;
  }

  /** Цифры месяца для прогресса измеримых целей. need — какие показатели
   *  нужны (KPI считается дорого — без нужды не трогаем); не задано — все
   *  прежние. */
  private async goalMetrics(user: User, ym: string, need?: Array<string | null>): Promise<GoalMetrics> {
    const today = todayDushanbe();
    const to = [monthEnd(ym), today].sort()[0];
    const list = need ? need.filter((m): m is string => !!m) : null;
    const wants = (m: string) => !list || list.includes(m);
    const needKpi = !list || list.some(m => m === 'efficiency' || m.startsWith('kpi:'));
    const [k, sh, days, extra] = await Promise.all([
      needKpi ? this.kpiOf(user.id, ym) : Promise.resolve(null),
      wants('ontime_shifts') ? this.shifts.myMonth(user.id, ym).catch(() => null) : Promise.resolve(null),
      wants('stories_days') && this.kindOf(user) === 'smm' ? this.storyDays(user.id, `${ym}-01`, to) : Promise.resolve([] as StoryDay[]),
      list ? this.sourceMetrics(user.id, ym, list) : Promise.resolve({} as Partial<GoalMetrics>),
    ]);
    const it: any = sh?.item;
    const worked = Object.values(it?.days || {}).filter(v => Number(v) > 0).length;
    return {
      efficiency: this.effOf(k),
      kpi: Object.fromEntries((k?.items || []).map(x => [x.key, x.percent])),
      storyOkDays: days.filter(storyDayOk).length,
      ontimeShifts: Math.max(0, worked - (it?.lateDays?.length || 0)),
      ...extra,
    };
  }

  /** Результаты компаса по id — для цепочки «→ отдел … · → компания …».
   *  Прогресс и статус здесь не считаем (это работа модуля компаса). */
  private async keyResultsByIds(ids: Array<string | null | undefined>): Promise<Map<string, ChainKeyResult>> {
    const list = [...new Set(ids.filter((x): x is string => !!x && UUID_RE.test(x)))];
    if (!list.length) return new Map();
    const rows = await this.q(
      `SELECT k.id::text AS id, k.title, k.level, k.department,
              p.id::text AS "parentId", p.title AS "parentTitle"
         FROM goal_key_results k
         LEFT JOIN goal_key_results p ON p.id = k."parentId"
        WHERE k.id = ANY($1::uuid[])`,
      [list], 'goal key results',
    );
    return new Map(rows.map((r: any) => {
      const level: KrLevel = r.level === 'company' ? 'company' : 'department';
      const dept = level === 'department' && isDeptKey(r.department) ? r.department : null;
      const kr: ChainKeyResult = {
        id: r.id,
        title: r.title,
        level,
        department: dept,
        departmentName: dept ? DEPT_NAME[dept] : null,
        progress: null,
        status: 'none',
        parent: r.parentId ? { id: r.parentId, title: r.parentTitle, progress: null, status: 'none' } : null,
      };
      return [r.id, kr] as [string, ChainKeyResult];
    }));
  }

  /** Добавить к целям keyResultId и keyResult (цепочка наверх). */
  private async withKeyResults<T extends { keyResultId?: string | null }>(rows: T[]) {
    const map = await this.keyResultsByIds(rows.map(r => r.keyResultId));
    return rows.map(r => ({
      ...r,
      keyResultId: r.keyResultId ?? null,
      keyResult: r.keyResultId ? map.get(r.keyResultId) ?? null : null,
    }));
  }

  /** «Работает на» в редакторе целей: КР компании месяца и КР отдела сотрудника. */
  private async keyResultOptions(user: User, ym: string): Promise<KeyResultOption[]> {
    const dept = departmentOfRole(user.role);
    const rows = await this.q(
      `SELECT k.id::text AS id, k.title, k.level, k.department
         FROM goal_key_results k
         LEFT JOIN goal_objectives o ON o.id = k."objectiveId"
        WHERE k.ym = $1 AND (k.level = 'company' OR k.department = $2)
        ORDER BY CASE WHEN k.level = 'company' THEN 0 ELSE 1 END,
                 o."sortOrder" NULLS LAST, o."createdAt" NULLS LAST, k."sortOrder", k."createdAt"`,
      [ym, dept], 'goal key result options',
    );
    return rows.map((r: any) => {
      const level: KrLevel = r.level === 'company' ? 'company' : 'department';
      const d = level === 'department' && isDeptKey(r.department) ? r.department : null;
      return { id: r.id, title: r.title, level, department: d, departmentName: d ? DEPT_NAME[d] : null };
    });
  }

  /** Цели месяца людей с цифрами — для «Компаса компании» (цепочка
   *  сотрудника и таблица «Цели людей»). Показатели считаем только тем, у
   *  кого есть измеримые цели, и только нужные. */
  async goalRowsFor(userIds: string[], ym: string): Promise<Map<string, GoalRowView[]>> {
    const out = new Map<string, GoalRowView[]>();
    const ids = [...new Set((userIds || []).filter(id => UUID_RE.test(String(id || ''))))];
    if (!ids.length || !YM.test(String(ym || ''))) return out;
    const goals = await this.goalRepo.find({ where: { userId: In(ids), ym }, order: { createdAt: 'ASC' } });
    const byUser = new Map<string, EmployeeGoal[]>();
    for (const g of goals) byUser.set(g.userId, [...(byUser.get(g.userId) || []), g]);
    const measurable = [...byUser.entries()].filter(([, list]) => list.some(g => !!g.metric)).map(([id]) => id);
    const users = measurable.length ? await this.userRepo.find({ where: { id: In(measurable) } }) : [];
    const metrics = new Map<string, GoalMetrics>();
    await Promise.all(users.map(async u => {
      const m = await this.goalMetrics(u, ym, (byUser.get(u.id) || []).map(g => g.metric))
        .catch((e: any) => { this.logger.warn(`goal metrics for ${u.id} failed: ${e?.message || e}`); return NO_METRICS; });
      metrics.set(u.id, m);
    }));
    for (const [userId, list] of byUser) {
      out.set(userId, list.map(g => {
        const p = goalProgress(this.goalRow(g), metrics.get(userId) || NO_METRICS);
        return {
          id: p.id, title: p.title, metric: p.metric, target: p.target, done: p.done,
          value: p.value, reached: p.reached, keyResultId: g.keyResultId ?? null,
        };
      }));
    }
    return out;
  }

  /** Цели сотрудника за месяц — для его карточки у руководителя. */
  async goalsOf(userId: string, actor: Actor, ymRaw?: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    const canEdit = await this.canManage(actor, user);
    const ym = YM.test(String(ymRaw || '')) ? String(ymRaw) : todayDushanbe().slice(0, 7);
    // Чужие цели видит только тот, кто их ставит. Отвечаем пустым списком, а
    // не отказом: карточку сотрудника открывают и другие руководители.
    if (!canEdit && actor.id !== userId) return { ym, canEdit: false, max: MAX_GOALS, goals: [], metrics: [], keyResults: [] };
    const goals = await this.goalRepo.find({ where: { userId, ym }, order: { createdAt: 'ASC' } });
    const [metrics, k, keyResults] = await Promise.all([
      this.goalMetrics(user, ym, goals.map(g => g.metric)),
      this.kpiOf(user.id, ym),
      canEdit ? this.keyResultOptions(user, ym) : Promise.resolve([] as KeyResultOption[]),
    ]);
    const roles = [user.role, user.secondaryRole];
    const offer = (key: string) => (metricFits(key, roles) ? [{ key, label: GOAL_METRICS[key].label, unit: GOAL_METRICS[key].unit }] : []);
    return {
      ym, canEdit, max: MAX_GOALS,
      goals: await this.withKeyResults(goals.map(g => goalProgress(this.goalRow(g), metrics))),
      // Что можно поставить измеримой целью: общие, показатели компаса,
      // которые подходят человеку, и метрики KPI этого человека.
      metrics: [
        { key: 'efficiency', label: GOAL_METRICS.efficiency.label, unit: '%' },
        ...(this.kindOf(user) === 'smm' ? [{ key: 'stories_days', label: GOAL_METRICS.stories_days.label, unit: 'days' }] : []),
        { key: 'ontime_shifts', label: GOAL_METRICS.ontime_shifts.label, unit: 'shifts' },
        ...offer('won_deals'),
        ...offer('content_ontime'),
        ...offer('tasks_ontime'),
        ...(k?.items || []).map(it => ({ key: `kpi:${it.key}`, label: it.label, unit: '%' })),
      ],
      // «Работает на»: КР компании этого месяца и КР отдела сотрудника.
      keyResults,
    };
  }

  private cleanGoal(body: any) {
    const title = String(body?.title || '').trim().slice(0, 200);
    if (!title) throw new BadRequestException('Напишите цель');
    const metric = typeof body?.metric === 'string' && body.metric
      ? (GOAL_METRICS[body.metric] || /^kpi:[a-z_]{1,32}$/.test(body.metric) ? body.metric : null)
      : null;
    if (body?.metric && !metric) throw new BadRequestException('Неизвестный показатель цели');
    const target = metric ? Math.round(Number(body?.target)) : null;
    if (metric && !(target! > 0 && target! <= 1000)) throw new BadRequestException('Укажите, сколько нужно');
    return { title, metric, target };
  }

  /** Показатель должен подходить сотруднику (сделки — менеджерам продаж,
   *  публикации — SMM-специалистам). */
  private checkMetricFits(metric: string | null, user: User) {
    if (metric && !metricFits(metric, [user.role, user.secondaryRole])) {
      throw new BadRequestException('Этот показатель не подходит сотруднику');
    }
  }

  /** «Работает на»: КР компаса того же месяца; null/пусто — без связи. */
  private async cleanKeyResultId(raw: unknown, ym: string): Promise<string | null> {
    if (raw === null || raw === undefined || raw === '') return null;
    const id = String(raw);
    if (!UUID_RE.test(id)) throw new BadRequestException('Результат не найден');
    const [kr] = await this.q(`SELECT ym FROM goal_key_results WHERE id = $1 LIMIT 1`, [id], 'goal key result');
    if (!kr) throw new BadRequestException('Результат не найден');
    if (kr.ym !== ym) throw new BadRequestException('Цель может работать только на результат того же месяца');
    return id;
  }

  async createGoal(actor: Actor, body: any) {
    const user = await this.userRepo.findOne({ where: { id: String(body?.userId || '') } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    if (!(await this.canManage(actor, user))) throw new ForbiddenException('Цели ставят руководитель направления и основатель');
    const ym = YM.test(String(body?.ym || '')) ? String(body.ym) : todayDushanbe().slice(0, 7);
    const count = await this.goalRepo.count({ where: { userId: user.id, ym } });
    if (count >= MAX_GOALS) throw new BadRequestException(`На месяц — не больше ${MAX_GOALS} целей`);
    const fields = this.cleanGoal(body);
    this.checkMetricFits(fields.metric, user);
    const keyResultId = await this.cleanKeyResultId(body?.keyResultId, ym);
    await this.goalRepo.save(this.goalRepo.create({ ...fields, keyResultId, userId: user.id, ym, createdById: actor.id }));
    return this.goalsOf(user.id, actor, ym);
  }

  async updateGoal(actor: Actor, id: string, body: any) {
    const goal = await this.goalRepo.findOne({ where: { id } });
    if (!goal) throw new NotFoundException('Цель не найдена');
    const user = await this.userRepo.findOne({ where: { id: goal.userId } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    const manager = await this.canManage(actor, user);
    const self = actor.id === goal.userId;
    if (!manager && !self) throw new ForbiddenException('Нет доступа к цели');

    if (manager && (body?.title !== undefined || body?.metric !== undefined || body?.target !== undefined)) {
      Object.assign(goal, this.cleanGoal({
        title: body?.title ?? goal.title,
        metric: body?.metric !== undefined ? body.metric : goal.metric,
        target: body?.target ?? goal.target,
      }));
      if (body?.metric !== undefined) this.checkMetricFits(goal.metric, user);
    }
    // «Работает на» — ставит тот, кто ставит цели.
    if (manager && body?.keyResultId !== undefined) {
      goal.keyResultId = await this.cleanKeyResultId(body.keyResultId, goal.ym);
    }
    // Галочку ставит сотрудник (или руководитель) — только у цели без показателя.
    if (body?.done !== undefined) {
      if (goal.metric) throw new BadRequestException('Эту цель CRM считает сама');
      goal.done = !!body.done;
      goal.doneAt = goal.done ? new Date() : null;
    }
    await this.goalRepo.save(goal);
    return self && !manager ? this.forMe(actor) : this.goalsOf(goal.userId, actor, goal.ym);
  }

  async deleteGoal(actor: Actor, id: string) {
    const goal = await this.goalRepo.findOne({ where: { id } });
    if (!goal) throw new NotFoundException('Цель не найдена');
    const user = await this.userRepo.findOne({ where: { id: goal.userId } });
    if (!user || !(await this.canManage(actor, user))) throw new ForbiddenException('Цели убирают руководитель направления и основатель');
    await this.goalRepo.delete(goal.id);
    return this.goalsOf(goal.userId, actor, goal.ym);
  }
}
