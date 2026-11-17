import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { KpiService } from '../kpi/kpi.service';
import { EmployeeGoal } from '../profile-stats/employee-goal.entity';
import { GoalRowView, ProfileStatsService } from '../profile-stats/profile-stats.service';
import { MAX_GOALS_PER_MONTH } from '../profile-stats/profile-stats.logic';
import { cachedResponse } from '../../common/response-cache';
import { getSalesSegment, salesRoleOf } from '../../common/sales-segment';
import { COMPANY_GOALS_DDL, EMPLOYEE_GOALS_DDL } from '../../database/migrations/1836000000000-CompanyGoals';
import { GoalCheckin, GoalInitiative, GoalKeyResult, GoalObjective, GoalSetting } from './goal.entity';
import {
  DEPT_KEYS, DEPT_NAME, DeptUser, Leaders, TOP_ROLES, departmentOfRole, isDeptKey, leadsOf, loadDeptUsers,
  loadLeaderOverrides, membersOf, personRef, pickLeaders, resolveLeaders,
} from './departments';
import {
  GoalAccess, GoalActor, accessOf, canCheckinKr, canEditDepartment, canEditInitiatives, canEditKr,
  canManageCompany, canManageSettings, canReadDepartment, copyScope,
} from './goals-access';
import {
  KPI_KEYS, SOURCE_CATALOG, SourceParams, SourceResult, cleanSourceParams, isSourceKey, kindOf, overdueClients,
  runSource, sourceMeta, unitOf,
} from './goal-sources';
import {
  DayWindow, addDays, countStatuses, dayName, dayOfWeek, daysLeft, elapsed, fmtNum, fmtValue, isYm, monthEnd,
  monthWeeks, monthWindow, paceOf, plural, progressOf, rollupValue, round1, shiftYm, statusOf, todayDushanbe,
  trendWindow, weekStart, worstStatus, ymOf,
} from './goals.logic';
import type {
  AttentionItem, ChainGoal, ChainKeyResult, CheckinFormView, CheckinStatus, CheckinView, CompassView,
  DepartmentSummary, DepartmentView, DeptKey, GoalPerson, GoalSettingsView, GoalStatus, InitiativeView,
  KeyResultView, KrLevel, KrUnit, ObjectiveView, PersonGoalRow, SourceKey, SourcePreview, SourcesView,
} from './goals.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
/** Цифры источников держим минуту (§4); любое событие изменения кэш сбрасывает. */
const SOURCE_TTL = 60_000;
const CHECKIN_STATUSES: CheckinStatus[] = ['on_track', 'at_risk', 'off_track'];
const UNITS: KrUnit[] = ['money', 'count', 'percent'];
/** Для планировщика: видит всё, ничем не руководит. */
const SYSTEM_ACTOR: GoalActor = { id: 'system', role: 'admin' };

/** Посчитанное по КР: цифра, пояснение, тренд, прогресс, темп, статус. */
interface Computed {
  value: number | null;
  detail: string | null;
  trend: number | null;
  progress: number | null;
  pace: number | null;
  status: GoalStatus;
}
const NO_DATA: Computed = { value: null, detail: null, trend: null, progress: null, pace: null, status: 'none' };

/** Всё о месяце, что нужно для ответов. */
interface MonthCtx {
  ym: string;
  today: string;
  /** Понедельник текущей недели. */
  week: string;
  users: DeptUser[];
  userMap: Map<string, DeptUser>;
  leaders: Leaders;
  acc: GoalAccess;
  objectives: GoalObjective[];
  /** КР компании по номерам, затем КР отделов по порядку отделов. */
  krs: GoalKeyResult[];
  krMap: Map<string, GoalKeyResult>;
  objectiveN: Map<string, number>;
  companyN: Map<string, number>;
  /** Отметки по КР, по возрастанию недели. */
  checkins: Map<string, GoalCheckin[]>;
  initiatives: Map<string, InitiativeView[]>;
  computed: Map<string, Computed>;
}

/** Дата из базы: строка YYYY-MM-DD или Date (локальная полночь драйвера). */
function isoDate(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v ?? '').slice(0, 10);
}

const normTitle = (s: string) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const has = (body: any, key: string) => !!body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

const PROJECT_STATE: Record<string, string> = {
  planning: 'планирование',
  in_progress: 'в работе',
  completed: 'готово',
  archived: 'в архиве',
  on_hold: 'на паузе',
};

/**
 * «Компас компании» (16.11.2026, docs/GOALS_SPEC.md): цели компании,
 * результаты компании и отделов, отметки недели, инициативы, «Требует
 * внимания», перенос месяца и настройки руководителей. Формы ответов —
 * goals.types.ts (= frontend/src/types/goals.ts). Права — goals-access.ts,
 * цифры — goal-sources.ts, статусы — goals.logic.ts.
 */
@Injectable()
export class GoalsService implements OnModuleInit {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    @InjectRepository(GoalObjective) private objRepo: Repository<GoalObjective>,
    @InjectRepository(GoalKeyResult) private krRepo: Repository<GoalKeyResult>,
    @InjectRepository(GoalCheckin) private checkinRepo: Repository<GoalCheckin>,
    @InjectRepository(GoalInitiative) private initRepo: Repository<GoalInitiative>,
    @InjectRepository(GoalSetting) private settingRepo: Repository<GoalSetting>,
    @InjectRepository(EmployeeGoal) private goalRepo: Repository<EmployeeGoal>,
    private ds: DataSource,
    private kpi: KpiService,
    private profile: ProfileStatsService,
  ) {}

  /** Схема — как миграция 1836: на проде synchronize выключен, и если
   *  миграция отстала, страница не должна падать. Всё идемпотентно. */
  async onModuleInit() {
    for (const sql of COMPANY_GOALS_DDL) {
      await this.ds.query(sql).catch((e: any) => this.logger.warn(`goals DDL failed: ${String(e?.message || e).slice(0, 200)}`));
    }
    for (const sql of EMPLOYEE_GOALS_DDL) {
      await this.ds.query(sql).catch((e: any) => this.logger.warn(`employee_goals DDL failed: ${String(e?.message || e).slice(0, 200)}`));
    }
    try {
      const rows: Array<{ typname: string }> = await this.ds.query(
        `SELECT t.typname
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
           JOIN pg_type t ON t.oid = a.atttypid AND t.typtype = 'e'
          WHERE c.relname = 'notifications' AND a.attname = 'type' AND NOT a.attisdropped`,
      );
      const type = rows?.[0]?.typname;
      if (type) {
        for (const v of ['goal_checkin', 'goal_digest']) {
          await this.ds.query(`ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS '${v}'`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`notification types for goals failed: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  // ─── Контекст месяца ────────────────────────────────────────────────────

  private async accessFor(actor: GoalActor, users?: DeptUser[]): Promise<{ acc: GoalAccess; leaders: Leaders; users: DeptUser[] }> {
    const list = users || await loadDeptUsers(this.ds);
    const leaders = await resolveLeaders(this.ds, list);
    return { acc: accessOf(actor, leadsOf(actor, leaders)), leaders, users: list };
  }

  private async loadCtx(actor: GoalActor, ym: string, today: string): Promise<MonthCtx> {
    const [users, objectives, rawKrs] = await Promise.all([
      loadDeptUsers(this.ds),
      this.objRepo.find({ where: { ym }, order: { sortOrder: 'ASC', createdAt: 'ASC' } }),
      this.krRepo.find({ where: { ym }, order: { sortOrder: 'ASC', createdAt: 'ASC' } }),
    ]);
    const { acc, leaders } = await this.accessFor(actor, users);

    // Нумерация: цели 1..N; КР компании 1..N — по порядку целей, затем своему.
    const objectiveN = new Map<string, number>(objectives.map((o, i) => [o.id, i + 1] as [string, number]));
    const objIdx = (k: GoalKeyResult) => (k.objectiveId && objectiveN.has(k.objectiveId) ? objectiveN.get(k.objectiveId)! : 1e9);
    const indexed = rawKrs.map((k, i) => ({ k, i }));
    const company = indexed
      .filter(x => x.k.level === 'company')
      .sort((a, b) => objIdx(a.k) - objIdx(b.k) || a.i - b.i)
      .map(x => x.k);
    const deptIdx = (k: GoalKeyResult) => {
      const i = DEPT_KEYS.indexOf(k.department as DeptKey);
      return i < 0 ? 99 : i;
    };
    const departments = indexed
      .filter(x => x.k.level !== 'company')
      .sort((a, b) => deptIdx(a.k) - deptIdx(b.k) || a.i - b.i)
      .map(x => x.k);
    const krs = [...company, ...departments];
    const companyN = new Map<string, number>(company.map((k, i) => [k.id, i + 1] as [string, number]));

    const ids = krs.map(k => k.id);
    const [checkinRows, initiativeRows] = await Promise.all([
      ids.length ? this.checkinRepo.find({ where: { keyResultId: In(ids) } }) : Promise.resolve([] as GoalCheckin[]),
      ids.length ? this.initRepo.find({ where: { keyResultId: In(ids) }, order: { createdAt: 'ASC' } }) : Promise.resolve([] as GoalInitiative[]),
    ]);
    const checkins = new Map<string, GoalCheckin[]>();
    for (const c of checkinRows) {
      c.weekStart = isoDate(c.weekStart);
      const list = checkins.get(c.keyResultId) || [];
      list.push(c);
      checkins.set(c.keyResultId, list);
    }
    for (const list of checkins.values()) list.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    return {
      ym, today, week: weekStart(today),
      users, userMap: new Map(users.map(u => [u.id, u] as [string, DeptUser])),
      leaders, acc, objectives,
      krs, krMap: new Map(krs.map(k => [k.id, k] as [string, GoalKeyResult])),
      objectiveN, companyN, checkins,
      initiatives: await this.initiativeViews(initiativeRows, today),
      computed: new Map(),
    };
  }

  /** Название, состояние и ссылка инициатив (проекты и задачи). */
  private async initiativeViews(rows: GoalInitiative[], today: string): Promise<Map<string, InitiativeView[]>> {
    const out = new Map<string, InitiativeView[]>();
    if (!rows.length) return out;
    const projectIds = [...new Set(rows.filter(r => r.kind === 'project').map(r => r.refId))];
    const taskIds = [...new Set(rows.filter(r => r.kind === 'task').map(r => r.refId))];
    const [projects, tasks] = await Promise.all([
      projectIds.length
        ? this.ds.query(
          `SELECT id::text AS id, name, status::text AS status, COALESCE("isArchived", false) AS "isArchived"
             FROM projects WHERE id = ANY($1::uuid[])`, [projectIds],
        ).catch((e: any) => { this.logger.warn(`initiative projects failed: ${e?.message || e}`); return []; })
        : Promise.resolve([]),
      taskIds.length
        ? this.ds.query(
          `SELECT id::text AS id, title, status::text AS status,
                  to_char((deadline AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dushanbe', 'YYYY-MM-DD') AS due
             FROM tasks WHERE id = ANY($1::uuid[])`, [taskIds],
        ).catch((e: any) => { this.logger.warn(`initiative tasks failed: ${e?.message || e}`); return []; })
        : Promise.resolve([]),
    ]);
    const pMap = new Map<string, any>((projects as any[]).map(p => [p.id, p] as [string, any]));
    const tMap = new Map<string, any>((tasks as any[]).map(t => [t.id, t] as [string, any]));
    for (const r of rows) {
      let view: InitiativeView;
      if (r.kind === 'project') {
        const p = pMap.get(r.refId);
        view = {
          id: r.id, kind: 'project', refId: r.refId,
          title: p ? String(p.name || 'Проект') : 'Проект удалён',
          state: p ? (p.isArchived ? 'в архиве' : PROJECT_STATE[p.status] || null) : null,
          link: `/projects/${r.refId}`,
        };
      } else {
        const t = tMap.get(r.refId);
        let state: string | null = null;
        if (t) {
          if (t.status === 'done') state = 'готово';
          else if (t.status === 'cancelled') state = 'отменена';
          else if (t.due) state = t.due < today ? `просрочена с ${dayName(t.due)}` : `до ${dayName(t.due)}`;
          else state = t.status === 'new' ? 'новая' : 'в работе';
        }
        view = {
          id: r.id, kind: 'task', refId: r.refId,
          title: t ? String(t.title || 'Задача') : 'Задача удалена',
          state,
          link: `/tasks/${r.refId}`,
        };
      }
      const list = out.get(r.keyResultId) || [];
      list.push(view);
      out.set(r.keyResultId, list);
    }
    return out;
  }

  // ─── Цифры и статусы ───────────────────────────────────────────────────

  private paramsOf(kr: GoalKeyResult): SourceParams {
    return cleanSourceParams(kr.source, kr.sourceParams) as SourceParams;
  }

  /** Цифра источника за окно — с минутным кэшем на (источник, параметры, окно). */
  private cachedSource(
    source: string, params: SourceParams, win: DayWindow, today: string, memberIds: string[] | null,
  ): Promise<SourceResult> {
    const key = `goals:src:${source}:${JSON.stringify(params)}:${win.from}:${win.to}:${today}`;
    return cachedResponse(key, SOURCE_TTL, () => runSource(this.ds, source, win, params, { kpi: this.kpi, today, memberIds }))
      .catch((e: any) => {
        this.logger.warn(`source ${source} failed: ${String(e?.message || e).slice(0, 200)}`);
        return { value: null, detail: null };
      });
  }

  /** Цифра КР, пояснение и тренд за неделю. */
  private async valueOf(ctx: MonthCtx, kr: GoalKeyResult): Promise<{ value: number | null; detail: string | null; trend: number | null }> {
    if (kr.source === 'manual') {
      return { value: kr.manualValue === null || kr.manualValue === undefined ? null : Number(kr.manualValue), detail: null, trend: null };
    }
    const win = monthWindow(kr.ym, ctx.today);
    if (!win) return { value: null, detail: null, trend: null };
    const params = this.paramsOf(kr);
    const isKpi = kr.source === 'kpi_efficiency';
    // KPI — за месяц целиком (KPI сам считает только наступившие дни), как на
    // странице KPI; «неделю назад» у KPI не посчитать — тренда нет.
    const valueWin: DayWindow = isKpi ? { from: win.from, to: monthEnd(kr.ym) } : win;
    const memberIds = isKpi && isDeptKey(params.department)
      ? membersOf(ctx.users, params.department).map(u => u.id)
      : null;
    const main = await this.cachedSource(kr.source, params, valueWin, ctx.today, memberIds);
    let trend: number | null = null;
    // Тренд — только у текущего месяца: «за неделю» значит «за последние 7 дней».
    const tw = !isKpi && kr.ym === ymOf(ctx.today) ? trendWindow(win) : null;
    if (tw && main.value !== null) {
      const before = await this.cachedSource(kr.source, params, tw, ctx.today, memberIds);
      if (before.value !== null) trend = round1(main.value - before.value);
    }
    return { value: main.value, detail: main.detail, trend };
  }

  private lastCheckin(ctx: MonthCtx, krId: string): GoalCheckin | null {
    const list = ctx.checkins.get(krId) || [];
    return list.length ? list[list.length - 1] : null;
  }

  private async computeOne(ctx: MonthCtx, kr: GoalKeyResult): Promise<Computed> {
    const kind = kindOf(kr.source);
    const unit = unitOf(kr.source, kr.unit);
    const target = Number(kr.target) || 0;
    const r = await this.valueOf(ctx, kr);
    const last = this.lastCheckin(ctx, kr.id);
    return {
      value: r.value,
      detail: r.detail,
      trend: r.trend,
      progress: progressOf(kind, r.value, target),
      pace: paceOf(kind, kr.ym, ctx.today),
      status: statusOf({
        kind, unit, source: kr.source, value: r.value, target, ym: kr.ym, today: ctx.today,
        lastCheckin: last ? (last.status as CheckinStatus) : null,
      }),
    };
  }

  /** «По результатам отделов»: среднее прогресса привязанных КР отделов,
   *  статус — худший из их статусов. */
  private computeRollup(ctx: MonthCtx, kr: GoalKeyResult): Computed {
    const children = ctx.krs.filter(c => c.level === 'department' && c.parentId === kr.id);
    const cs = children.map(c => ctx.computed.get(c.id) || NO_DATA);
    const value = rollupValue(cs.map(c => c.progress));
    return {
      value,
      detail: children.length
        ? `по ${children.length} ${plural(children.length, 'результату', 'результатам', 'результатам')} отделов`
        : 'нет привязанных результатов отделов',
      trend: null,
      progress: value,
      pace: null,
      status: value === null ? 'none' : worstStatus(cs.map(c => c.status)),
    };
  }

  /** Посчитать КР из списка (у rollup — и его КР отделов). */
  private async computeKrs(ctx: MonthCtx, list: GoalKeyResult[]): Promise<void> {
    const want = new Map<string, GoalKeyResult>();
    for (const k of list) {
      want.set(k.id, k);
      if (k.source === 'rollup') {
        for (const c of ctx.krs) if (c.level === 'department' && c.parentId === k.id) want.set(c.id, c);
      }
    }
    const plain = [...want.values()].filter(k => k.source !== 'rollup' && !ctx.computed.has(k.id));
    const results = await Promise.all(plain.map(k => this.computeOne(ctx, k).catch((e: any) => {
      this.logger.warn(`kr ${k.id} failed: ${String(e?.message || e).slice(0, 200)}`);
      return NO_DATA;
    })));
    plain.forEach((k, i) => ctx.computed.set(k.id, results[i]));
    for (const k of want.values()) {
      if (k.source === 'rollup' && !ctx.computed.has(k.id)) ctx.computed.set(k.id, this.computeRollup(ctx, k));
    }
  }

  // ─── Представления ─────────────────────────────────────────────────────

  private checkinView(ctx: MonthCtx, c: GoalCheckin): CheckinView {
    const at = c.updatedAt || c.createdAt;
    return {
      weekStart: c.weekStart,
      status: c.status as CheckinStatus,
      comment: c.comment ?? null,
      user: c.userId ? personRef(ctx.userMap.get(c.userId)) : null,
      at: at instanceof Date ? at.toISOString() : new Date(at as any).toISOString(),
    };
  }

  private departmentsOf(ctx: MonthCtx, kr: GoalKeyResult): DeptKey[] {
    if (kr.level !== 'company') return [];
    const set = new Set(ctx.krs.filter(c => c.level === 'department' && c.parentId === kr.id).map(c => c.department));
    return DEPT_KEYS.filter(k => set.has(k));
  }

  private krView(ctx: MonthCtx, kr: GoalKeyResult): KeyResultView {
    const c = ctx.computed.get(kr.id) || NO_DATA;
    const meta = sourceMeta(kr.source);
    const list = ctx.checkins.get(kr.id) || [];
    const current = list.find(x => x.weekStart === ctx.week) || (list.length ? list[list.length - 1] : null);
    const byWeek = new Map(list.map(x => [x.weekStart, x.status as CheckinStatus] as [string, CheckinStatus]));
    const parent = kr.parentId ? ctx.krMap.get(kr.parentId) : undefined;
    const dept = isDeptKey(kr.department) ? kr.department : null;
    return {
      id: kr.id,
      ym: kr.ym,
      level: (kr.level === 'company' ? 'company' : 'department') as KrLevel,
      department: kr.level === 'company' ? null : dept,
      objectiveId: kr.objectiveId ?? null,
      parentId: kr.parentId ?? null,
      parent: parent ? { id: parent.id, n: ctx.companyN.get(parent.id) ?? null, title: parent.title } : null,
      n: kr.level === 'company' ? ctx.companyN.get(kr.id) ?? null : null,
      title: kr.title,
      source: kr.source as SourceKey,
      sourceLabel: meta?.label || kr.source,
      sourceParams: cleanSourceParams(kr.source, kr.sourceParams),
      unit: unitOf(kr.source, kr.unit),
      kind: kindOf(kr.source),
      target: Number(kr.target) || 0,
      value: c.value,
      detail: c.detail,
      progress: c.progress,
      pace: c.pace,
      trend: c.trend,
      status: c.status,
      checkin: current ? this.checkinView(ctx, current) : null,
      history: monthWeeks(kr.ym, ctx.today).map(w => ({ weekStart: w, status: byWeek.get(w) ?? null })),
      owner: kr.ownerId ? personRef(ctx.userMap.get(kr.ownerId)) : null,
      departments: this.departmentsOf(ctx, kr),
      initiatives: ctx.initiatives.get(kr.id) || [],
      manualValue: kr.source === 'manual' && kr.manualValue !== null && kr.manualValue !== undefined ? Number(kr.manualValue) : null,
      canEdit: canEditKr(ctx.acc, kr),
      canCheckin: canCheckinKr(ctx.acc, kr),
    };
  }

  private chainKr(ctx: MonthCtx, kr: GoalKeyResult): ChainKeyResult {
    const c = ctx.computed.get(kr.id) || NO_DATA;
    const p = kr.parentId ? ctx.krMap.get(kr.parentId) : undefined;
    const pc = p ? ctx.computed.get(p.id) || NO_DATA : NO_DATA;
    const dept = kr.level === 'company' ? null : (isDeptKey(kr.department) ? kr.department : null);
    return {
      id: kr.id,
      title: kr.title,
      level: (kr.level === 'company' ? 'company' : 'department') as KrLevel,
      department: dept,
      departmentName: dept ? DEPT_NAME[dept] : null,
      progress: c.progress,
      status: c.status,
      parent: p ? { id: p.id, title: p.title, progress: pc.progress, status: pc.status } : null,
    };
  }

  private chainOf(ctx: MonthCtx, rows: GoalRowView[]): ChainGoal[] {
    return rows.map(g => {
      const kr = g.keyResultId ? ctx.krMap.get(g.keyResultId) : undefined;
      return {
        id: g.id,
        title: g.title,
        metric: g.metric ?? null,
        target: g.target ?? null,
        value: g.value ?? null,
        done: !!g.done,
        reached: !!g.reached,
        keyResult: kr ? this.chainKr(ctx, kr) : null,
      };
    });
  }

  private statusesOf(ctx: MonthCtx, list: GoalKeyResult[]): GoalStatus[] {
    return list.map(k => (ctx.computed.get(k.id) || NO_DATA).status);
  }

  private deptKrs(ctx: MonthCtx, key: DeptKey): GoalKeyResult[] {
    return ctx.krs.filter(k => k.level === 'department' && k.department === key);
  }

  private checkedThisWeek(ctx: MonthCtx, krs: GoalKeyResult[]): boolean {
    return krs.some(k => (ctx.checkins.get(k.id) || []).some(c => c.weekStart === ctx.week));
  }

  /** Члены отдела, которым можно ставить цели месяца (без руководства). */
  private goalMembers(ctx: MonthCtx, key: DeptKey): DeptUser[] {
    return membersOf(ctx.users, key).filter(u => !TOP_ROLES.includes(u.role));
  }

  private async goalCounts(ym: string): Promise<Map<string, number>> {
    const rows: any[] = await this.ds.query(
      `SELECT "userId"::text AS "userId", COUNT(*)::int AS n FROM employee_goals WHERE ym = $1 GROUP BY "userId"`, [ym],
    ).catch(() => []);
    return new Map(rows.map(r => [String(r.userId), Number(r.n) || 0] as [string, number]));
  }

  private summaryOf(ctx: MonthCtx, key: DeptKey, goalCounts: Map<string, number> | null): DepartmentSummary {
    const krs = this.deptKrs(ctx, key);
    const statuses = this.statusesOf(ctx, krs);
    return {
      key,
      name: DEPT_NAME[key],
      leader: ctx.leaders[key] ?? null,
      members: membersOf(ctx.users, key).length,
      status: worstStatus(statuses),
      counts: countStatuses(statuses),
      krCount: krs.length,
      checkedThisWeek: this.checkedThisWeek(ctx, krs),
      withoutGoals: goalCounts ? this.goalMembers(ctx, key).filter(u => !goalCounts.get(u.id)).length : null,
    };
  }

  /** «КР 4: 120 000 с. при цели 300 000 с.» — для «Требует внимания» и дайджеста. */
  private badKeyResults(ctx: MonthCtx): Array<{ kr: GoalKeyResult; c: Computed; label: string; text: string }> {
    const rank = (s: GoalStatus) => (s === 'off_track' ? 0 : 1);
    return ctx.krs
      .map((kr, i) => ({ kr, i, c: ctx.computed.get(kr.id) || NO_DATA }))
      .filter(x => x.c.status === 'off_track' || x.c.status === 'at_risk')
      .sort((a, b) => rank(a.c.status) - rank(b.c.status) || a.i - b.i)
      .map(({ kr, c }) => {
        const unit = unitOf(kr.source, kr.unit);
        const lower = kindOf(kr.source) === 'lower' ? '≤ ' : '';
        const n = ctx.companyN.get(kr.id);
        const dept = isDeptKey(kr.department) ? kr.department : null;
        return {
          kr, c,
          label: kr.level === 'company' ? `КР ${n ?? ''}`.trim() : (dept ? DEPT_NAME[dept] : 'Отдел'),
          text: `${fmtValue(c.value, unit)} при цели ${lower}${fmtValue(Number(kr.target), unit)}`,
        };
      });
  }

  private async attentionOf(ctx: MonthCtx, summaries: DepartmentSummary[]): Promise<AttentionItem[]> {
    const items: AttentionItem[] = [];
    const curYm = ymOf(ctx.today);

    for (const b of this.badKeyResults(ctx)) {
      const dept = b.kr.level === 'company' ? null : (isDeptKey(b.kr.department) ? b.kr.department : null);
      items.push({
        kind: 'kr',
        tone: b.c.status === 'off_track' ? 'off_track' : 'at_risk',
        label: b.label,
        title: b.kr.title,
        text: b.text,
        link: dept ? `/compass/${dept}` : null,
        linkLabel: dept ? 'Открыть отдел' : null,
        keyResultId: b.kr.id,
        ...(dept ? { department: dept } : {}),
      });
    }

    if (ctx.ym === curYm) {
      const late = await overdueClients(this.ds, addDays(ctx.today, -14));
      if (late && late.clients > 0) {
        items.push({
          kind: 'overdue',
          tone: 'at_risk',
          label: 'Финансы',
          title: `${late.clients} ${plural(late.clients, 'клиент не платит', 'клиента не платят', 'клиентов не платят')} больше 14 дней`,
          text: `сумма ${fmtNum(late.amount)} с.`,
          link: '/finance',
          linkLabel: 'Открыть финансы',
        });
      }
    }

    if (ctx.ym >= curYm) {
      const plans = await this.plansGap(ctx);
      if (plans) items.push(plans);
    }

    // Отметка недели — со вторника: в понедельник её ещё ставят.
    if (ctx.ym === curYm && dayOfWeek(ctx.today) > 1) {
      for (const s of summaries) {
        if (s.krCount > 0 && !s.checkedThisWeek) {
          items.push({
            kind: 'checkin', tone: 'info', label: 'Статус',
            title: `${s.name} не отметил статус недели`, text: null,
            link: `/compass/${s.key}`, linkLabel: 'Открыть отдел', department: s.key,
          });
        }
      }
    }

    if (ctx.ym >= curYm) {
      for (const s of summaries) {
        const n = s.withoutGoals || 0;
        if (n > 0) {
          items.push({
            kind: 'no_goals', tone: 'info', label: 'Отдел',
            title: `${s.name}: ${n} ${plural(n, 'сотрудник', 'сотрудника', 'сотрудников')} без цели на месяц`, text: null,
            link: `/compass/${s.key}`, linkLabel: 'Цели людей', department: s.key,
          });
        }
      }
    }
    return items;
  }

  /** Планы продаж менеджеров против цели по выручке компании. */
  private async plansGap(ctx: MonthCtx): Promise<AttentionItem | null> {
    const revenue = ctx.krs.filter(k => k.level === 'company' && k.source === 'revenue');
    if (!revenue.length) return null;
    const whole = revenue.find(k => !this.paramsOf(k).direction);
    let target = 0;
    if (whole) target = Number(whole.target) || 0;
    else {
      // Цели по направлениям — каждое направление один раз.
      const seen = new Set<string>();
      for (const k of revenue) {
        const d = String(this.paramsOf(k).direction || '');
        if (seen.has(d)) continue;
        seen.add(d);
        target += Number(k.target) || 0;
      }
    }
    if (!(target > 0)) return null;
    const rows: any[] = await this.ds.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM sales_plans WHERE ym = $1`, [ctx.ym],
    ).catch((e: any) => { this.logger.warn(`sales plans failed: ${e?.message || e}`); return null; });
    if (!rows) return null;
    const plans = round1(Number(rows[0]?.total) || 0);
    if (plans >= target) return null;
    return {
      kind: 'plans',
      tone: 'at_risk',
      label: 'Продажи',
      title: `Планы продаж менеджеров ${fmtNum(plans)} с., цель по выручке ${fmtNum(target)} с.`,
      text: `не хватает ${fmtNum(target - plans)} с.`,
      link: '/employees/sales-plan',
      linkLabel: 'Планы продаж',
    };
  }

  // ─── Экраны ────────────────────────────────────────────────────────────

  private ymOrNow(ymRaw: unknown, today: string): string {
    return isYm(ymRaw) ? ymRaw : ymOf(today);
  }

  /** GET /compass — главный экран. */
  async compass(actor: GoalActor, ymRaw?: string): Promise<CompassView> {
    const today = todayDushanbe();
    const ym = this.ymOrNow(ymRaw, today);
    const ctx = await this.loadCtx(actor, ym, today);
    const acc = ctx.acc;

    const myGoals = (await this.profile.goalRowsFor([actor.id], ym)).get(actor.id) || [];

    // Что считать: детали — всё; сотруднику — КР компании, своего отдела и
    // те, на которые работают его цели.
    let toCompute = ctx.krs;
    if (!acc.details) {
      const chainIds = new Set(myGoals.map(g => g.keyResultId).filter(Boolean) as string[]);
      toCompute = ctx.krs.filter(k => k.level === 'company'
        || (acc.department && k.department === acc.department)
        || chainIds.has(k.id));
    }
    await this.computeKrs(ctx, toCompute);

    const companyKrs = ctx.krs.filter(k => k.level === 'company');
    const objectives: ObjectiveView[] = ctx.objectives.map(o => {
      const krs = companyKrs.filter(k => k.objectiveId === o.id);
      return {
        id: o.id,
        n: ctx.objectiveN.get(o.id) || 0,
        title: o.title,
        owner: o.ownerId ? personRef(ctx.userMap.get(o.ownerId)) : null,
        status: worstStatus(this.statusesOf(ctx, krs)),
        keyResults: krs.map(k => this.krView(ctx, k)),
        canEdit: canManageCompany(acc),
      };
    });

    const goalCounts = acc.details ? await this.goalCounts(ym) : null;
    const allSummaries = DEPT_KEYS.map(k => this.summaryOf(ctx, k, goalCounts));
    const departments = acc.details
      ? allSummaries
      : allSummaries.filter(s => s.key === acc.department);

    const prevYm = shiftYm(ym, -1);
    const [prevObjectives, prevKrs] = await Promise.all([
      this.objRepo.count({ where: { ym: prevYm } }),
      this.krRepo.count({ where: { ym: prevYm } }),
    ]);

    return {
      ym,
      today,
      elapsed: Math.round(elapsed(ym, today) * 100),
      daysLeft: daysLeft(ym, today),
      me: { id: actor.id, isTop: acc.isTop, details: acc.details, leads: acc.leads, department: acc.department },
      counts: countStatuses(this.statusesOf(ctx, companyKrs)),
      objectives,
      departments,
      attention: acc.details ? await this.attentionOf(ctx, allSummaries) : [],
      myChain: this.chainOf(ctx, myGoals),
      myDepartmentKeyResults: !acc.details && acc.department
        ? this.deptKrs(ctx, acc.department).map(k => this.krView(ctx, k))
        : [],
      prevHasGoals: prevObjectives + prevKrs > 0,
      canCopy: acc.details,
      canManageCompany: canManageCompany(acc),
    };
  }

  /** GET /compass/departments/:key — экран отдела. */
  async department(actor: GoalActor, keyRaw: string, ymRaw?: string): Promise<DepartmentView> {
    if (!isDeptKey(keyRaw)) throw new NotFoundException('Отдел не найден');
    const key: DeptKey = keyRaw;
    const today = todayDushanbe();
    const ym = this.ymOrNow(ymRaw, today);
    const ctx = await this.loadCtx(actor, ym, today);
    if (!canReadDepartment(ctx.acc, key)) throw new ForbiddenException('Результаты этого отдела видят его сотрудники и руководство');
    const krs = this.deptKrs(ctx, key);
    await this.computeKrs(ctx, krs);

    let people: PersonGoalRow[] | null = null;
    if (ctx.acc.details) {
      const members = this.goalMembers(ctx, key);
      const goals = await this.profile.goalRowsFor(members.map(u => u.id), ym);
      people = members.map(u => ({
        userId: u.id,
        name: u.name,
        avatar: u.avatar ?? null,
        role: u.role,
        goals: (goals.get(u.id) || []).map(g => ({
          id: g.id,
          title: g.title,
          metric: g.metric ?? null,
          target: g.target ?? null,
          value: g.value ?? null,
          done: !!g.done,
          reached: !!g.reached,
          keyResultId: g.keyResultId ?? null,
          keyResultTitle: g.keyResultId ? ctx.krMap.get(g.keyResultId)?.title ?? null : null,
        })),
      }));
    }

    const statuses = this.statusesOf(ctx, krs);
    const canEdit = canEditDepartment(ctx.acc, key);
    return {
      ym,
      today,
      elapsed: Math.round(elapsed(ym, today) * 100),
      weekStart: ctx.week,
      department: { key, name: DEPT_NAME[key], leader: ctx.leaders[key] ?? null, members: membersOf(ctx.users, key).length },
      status: worstStatus(statuses),
      checkedThisWeek: this.checkedThisWeek(ctx, krs),
      keyResults: krs.map(k => this.krView(ctx, k)),
      companyKeyResults: ctx.krs
        .filter(k => k.level === 'company')
        .map(k => ({ id: k.id, n: ctx.companyN.get(k.id) ?? null, title: k.title })),
      people,
      canEdit,
      canCheckin: canEdit,
    };
  }

  /** Один КР — после создания, правки, отметки, инициативы. */
  async keyResultView(actor: GoalActor, id: string): Promise<KeyResultView> {
    const kr = await this.findKr(id);
    const today = todayDushanbe();
    const ctx = await this.loadCtx(actor, kr.ym, today);
    const fresh = ctx.krMap.get(kr.id);
    if (!fresh) throw new NotFoundException('Результат не найден');
    if (fresh.level !== 'company' && !canReadDepartment(ctx.acc, fresh.department || '')) {
      throw new ForbiddenException('Нет доступа к результату');
    }
    await this.computeKrs(ctx, [fresh]);
    return this.krView(ctx, fresh);
  }

  // ─── Источники ─────────────────────────────────────────────────────────

  /** GET /compass/sources — каталог источников и метрики KPI. */
  sources(): SourcesView {
    return { sources: SOURCE_CATALOG, kpiKeys: KPI_KEYS };
  }

  /** GET /compass/sources/preview — «Сейчас по этому источнику: N». */
  async preview(actor: GoalActor, q: any): Promise<SourcePreview> {
    const { acc, users } = await this.accessFor(actor);
    if (!acc.details) throw new ForbiddenException('Результаты ставят руководители отделов и основатель');
    const source = String(q?.source || '');
    if (!isSourceKey(source)) throw new BadRequestException('Неизвестный источник цифры');
    const unit = unitOf(source, q?.unit);
    if (source === 'manual' || source === 'rollup') return { value: null, detail: null, unit };
    const today = todayDushanbe();
    const ym = this.ymOrNow(q?.ym, today);
    const win = monthWindow(ym, today);
    if (!win) return { value: null, detail: 'месяц ещё не начался', unit };
    const params = cleanSourceParams(source, q) as SourceParams;
    const isKpi = source === 'kpi_efficiency';
    const memberIds = isKpi && isDeptKey(params.department) ? membersOf(users, params.department).map(u => u.id) : null;
    const r = await this.cachedSource(source, params, isKpi ? { from: win.from, to: monthEnd(ym) } : win, today, memberIds);
    return { value: r.value, detail: r.detail, unit };
  }

  // ─── Цели компании ─────────────────────────────────────────────────────

  private async userExists(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows: any[] = await this.ds.query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [id]).catch(() => []);
    return rows.length > 0;
  }

  private async cleanOwner(raw: unknown): Promise<string | null> {
    if (raw === null || raw === undefined || raw === '') return null;
    if (!(await this.userExists(String(raw)))) throw new BadRequestException('Ответственный не найден');
    return String(raw);
  }

  private cleanTitle(raw: unknown, what: string): string {
    const title = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!title || title.length > 200) throw new BadRequestException(`${what} — от 1 до 200 символов`);
    return title;
  }

  private async requireTop(actor: GoalActor): Promise<GoalAccess> {
    const { acc } = await this.accessFor(actor);
    if (!canManageCompany(acc)) throw new ForbiddenException('Цели компании ставят основатель и админ');
    return acc;
  }

  private async findObjective(id: string): Promise<GoalObjective> {
    const o = isUuid(id) ? await this.objRepo.findOne({ where: { id } }) : null;
    if (!o) throw new NotFoundException('Цель не найдена');
    return o;
  }

  private async findKr(id: string): Promise<GoalKeyResult> {
    const kr = isUuid(id) ? await this.krRepo.findOne({ where: { id } }) : null;
    if (!kr) throw new NotFoundException('Результат не найден');
    return kr;
  }

  async createObjective(actor: GoalActor, body: any): Promise<CompassView> {
    await this.requireTop(actor);
    const ym = String(body?.ym || '');
    if (!isYm(ym)) throw new BadRequestException('Месяц — YYYY-MM');
    const title = this.cleanTitle(body?.title, 'Цель');
    const ownerId = await this.cleanOwner(body?.ownerId);
    const count = await this.objRepo.count({ where: { ym } });
    await this.objRepo.save(this.objRepo.create({ ym, title, ownerId, sortOrder: count, createdById: actor.id }));
    return this.compass(actor, ym);
  }

  async updateObjective(actor: GoalActor, id: string, body: any): Promise<CompassView> {
    await this.requireTop(actor);
    const o = await this.findObjective(id);
    if (has(body, 'title')) o.title = this.cleanTitle(body.title, 'Цель');
    if (has(body, 'ownerId')) o.ownerId = await this.cleanOwner(body.ownerId);
    if (has(body, 'sortOrder')) o.sortOrder = Math.round(Number(body.sortOrder)) || 0;
    await this.objRepo.save(o);
    return this.compass(actor, o.ym);
  }

  async deleteObjective(actor: GoalActor, id: string): Promise<CompassView> {
    await this.requireTop(actor);
    const o = await this.findObjective(id);
    await this.ds.transaction(async m => {
      const krs = await m.getRepository(GoalKeyResult).find({ where: { objectiveId: o.id } });
      await this.removeKrs(m, krs.map(k => k.id));
      await m.getRepository(GoalObjective).delete(o.id);
    });
    return this.compass(actor, o.ym);
  }

  // ─── Результаты (КР) ───────────────────────────────────────────────────

  /**
   * Проверка и сборка полей КР (§7). existing — правка: поля, которых нет в
   * запросе, берутся из него. Права проверяются здесь же: КР компании —
   * isTop, КР отдела — isTop или руководитель отдела.
   */
  private async cleanKr(acc: GoalAccess, body: any, existing: GoalKeyResult | null): Promise<Partial<GoalKeyResult>> {
    const ym = existing ? existing.ym : String(body?.ym || '');
    if (!existing && !isYm(ym)) throw new BadRequestException('Месяц — YYYY-MM');
    if (existing && has(body, 'ym') && body.ym !== existing.ym) {
      throw new BadRequestException('Месяц результата не меняется — перенесите цели месяца');
    }
    const level = existing ? existing.level : String(body?.level || '');
    if (level !== 'company' && level !== 'department') throw new BadRequestException('Уровень — компания или отдел');
    if (existing && has(body, 'level') && body.level !== existing.level) {
      throw new BadRequestException('Уровень результата не меняется — создайте новый');
    }

    const title = this.cleanTitle(has(body, 'title') ? body.title : existing?.title, 'Название результата');
    const source = has(body, 'source') ? String(body.source) : String(existing?.source || '');
    if (!isSourceKey(source)) throw new BadRequestException('Неизвестный источник цифры');
    if (source === 'rollup' && level !== 'company') {
      throw new BadRequestException('«По результатам отделов» — только для результата компании');
    }

    let department: string | null = null;
    let objectiveId: string | null = null;
    let parentId: string | null = null;
    if (level === 'company') {
      if (!canManageCompany(acc)) throw new ForbiddenException('Результаты компании ставят основатель и админ');
      objectiveId = has(body, 'objectiveId') ? (body.objectiveId || null) : (existing?.objectiveId ?? null);
      if (!objectiveId) throw new BadRequestException('Выберите цель компании');
      const obj = isUuid(objectiveId) ? await this.objRepo.findOne({ where: { id: objectiveId } }) : null;
      if (!obj || obj.ym !== ym) throw new BadRequestException('Цель компании — того же месяца');
    } else {
      department = has(body, 'department') ? body.department : (existing?.department ?? null);
      if (!isDeptKey(department)) throw new BadRequestException('Выберите отдел');
      if (!canEditDepartment(acc, department)) {
        throw new ForbiddenException('Результаты отдела ставят руководитель отдела и основатель');
      }
      if (existing && existing.department !== department && !canEditDepartment(acc, existing.department)) {
        throw new ForbiddenException('Результаты отдела ставят руководитель отдела и основатель');
      }
      parentId = has(body, 'parentId') ? (body.parentId || null) : (existing?.parentId ?? null);
      if (parentId) {
        const p = isUuid(parentId) ? await this.krRepo.findOne({ where: { id: parentId } }) : null;
        if (!p || p.level !== 'company' || p.ym !== ym) {
          throw new BadRequestException('«Работает на» — результат компании того же месяца');
        }
      }
    }

    const target = source === 'rollup'
      ? 100
      : Math.round(Number(has(body, 'target') ? body.target : existing?.target) * 100) / 100;
    if (!(target > 0) || target > 1e12) throw new BadRequestException('Цель — число больше нуля');

    let unit: string = unitOf(source);
    if (source === 'manual') {
      const raw = has(body, 'unit') ? body.unit : existing?.unit;
      unit = UNITS.includes(raw) ? raw : 'count';
    }

    const out: Partial<GoalKeyResult> = {
      ym, level, department, objectiveId, parentId, title, source, target, unit,
      sourceParams: cleanSourceParams(source, has(body, 'sourceParams') ? body.sourceParams : existing?.sourceParams) as Record<string, string>,
      ownerId: has(body, 'ownerId') ? await this.cleanOwner(body.ownerId) : (existing?.ownerId ?? null),
    };
    if (has(body, 'sortOrder')) out.sortOrder = Math.round(Number(body.sortOrder)) || 0;
    if (source !== 'manual') out.manualValue = null;
    return out;
  }

  private cleanManualValue(raw: unknown): number | null {
    if (raw === null || raw === '') return null;
    const v = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(v) || Math.abs(v) > 1e12) throw new BadRequestException('Цифра — число');
    return v;
  }

  /** POST /compass/key-results */
  async createKeyResult(actor: GoalActor, body: any): Promise<KeyResultView> {
    const { acc } = await this.accessFor(actor);
    const fields = await this.cleanKr(acc, body, null);
    if (fields.sortOrder === undefined) {
      fields.sortOrder = await this.krRepo.count({
        where: fields.level === 'company'
          ? { ym: fields.ym, objectiveId: fields.objectiveId as string }
          : { ym: fields.ym, department: fields.department as string },
      });
    }
    if (fields.source === 'manual' && has(body, 'manualValue')) fields.manualValue = this.cleanManualValue(body.manualValue);
    const saved = await this.krRepo.save(this.krRepo.create({ ...fields, createdById: actor.id }));
    return this.keyResultView(actor, saved.id);
  }

  /** PATCH /compass/key-results/:id — поля КР (правят те, кто правит КР) и
   *  manualValue (ставят те, кто отмечает статус недели). */
  async updateKeyResult(actor: GoalActor, id: string, body: any): Promise<KeyResultView> {
    const kr = await this.findKr(id);
    const { acc } = await this.accessFor(actor);
    const editKeys = ['ym', 'level', 'department', 'objectiveId', 'parentId', 'title', 'source', 'sourceParams', 'target', 'unit', 'ownerId', 'sortOrder'];
    if (editKeys.some(k => has(body, k))) {
      if (!canEditKr(acc, kr)) throw new ForbiddenException('Нет прав править этот результат');
      Object.assign(kr, await this.cleanKr(acc, body, kr));
    }
    if (has(body, 'manualValue')) {
      if (!canCheckinKr(acc, kr)) throw new ForbiddenException('Цифру ставят ответственный и руководитель');
      if (kr.source !== 'manual') throw new BadRequestException('Цифру вручную ставят только у источника «Вручную»');
      kr.manualValue = this.cleanManualValue(body.manualValue);
    }
    await this.krRepo.save(kr);
    return this.keyResultView(actor, kr.id);
  }

  /** Удалить КР со всем, что на нём висит (внешние ключи могут отсутствовать
   *  на базе, поднятой synchronize, — чистим явно). */
  private async removeKrs(m: EntityManager, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await m.getRepository(GoalCheckin).delete({ keyResultId: In(ids) });
    await m.getRepository(GoalInitiative).delete({ keyResultId: In(ids) });
    await m.getRepository(GoalKeyResult).update({ parentId: In(ids) }, { parentId: null });
    await m.getRepository(EmployeeGoal).update({ keyResultId: In(ids) }, { keyResultId: null });
    await m.getRepository(GoalKeyResult).delete({ id: In(ids) });
  }

  async deleteKeyResult(actor: GoalActor, id: string): Promise<{ ok: true }> {
    const kr = await this.findKr(id);
    const { acc } = await this.accessFor(actor);
    if (!canEditKr(acc, kr)) throw new ForbiddenException('Нет прав удалить этот результат');
    await this.ds.transaction(m => this.removeKrs(m, [kr.id]));
    return { ok: true };
  }

  // ─── Отметка недели ────────────────────────────────────────────────────

  private cleanCheckin(raw: any): { status: CheckinStatus; comment: string | null } {
    const status = String(raw?.status || '') as CheckinStatus;
    if (!CHECKIN_STATUSES.includes(status)) throw new BadRequestException('Статус — в графике, риск или отстаём');
    const comment = raw?.comment === null || raw?.comment === undefined ? '' : String(raw.comment).trim();
    if (comment.length > 2000) throw new BadRequestException('Комментарий — до 2000 символов');
    return { status, comment: comment || null };
  }

  private async saveCheckin(kr: GoalKeyResult, actorId: string, week: string, c: { status: CheckinStatus; comment: string | null }) {
    const existing = await this.checkinRepo.findOne({ where: { keyResultId: kr.id, weekStart: week } });
    if (existing) {
      existing.status = c.status;
      existing.comment = c.comment;
      existing.userId = actorId;
      await this.checkinRepo.save(existing);
    } else {
      try {
        await this.checkinRepo.insert({
          keyResultId: kr.id, weekStart: week, status: c.status, comment: c.comment, userId: actorId,
        });
      } catch (e: any) {
        // Двойное нажатие «Отправить»: вторая вставка упирается в уникальность
        // (КР, неделя) — тогда просто обновляем уже сохранённую отметку.
        const code = e?.code || e?.driverError?.code;
        if (code !== '23505') throw e;
        await this.checkinRepo.update(
          { keyResultId: kr.id, weekStart: week },
          { status: c.status, comment: c.comment, userId: actorId },
        );
      }
    }
  }

  /** POST /compass/key-results/:id/checkin — неделя текущая. */
  async checkinOne(actor: GoalActor, id: string, body: any): Promise<KeyResultView> {
    const kr = await this.findKr(id);
    const { acc } = await this.accessFor(actor);
    if (!canCheckinKr(acc, kr)) throw new ForbiddenException('Статус недели отмечают руководитель отдела и ответственный');
    const today = todayDushanbe();
    if (kr.ym !== ymOf(today)) throw new BadRequestException('Статус недели отмечают у результатов текущего месяца');
    await this.saveCheckin(kr, actor.id, weekStart(today), this.cleanCheckin(body));
    return this.keyResultView(actor, kr.id);
  }

  /** GET /compass/checkin — КР отделов, которыми руководит actor, и КР
   *  компании, где он ответственный (текущий месяц). */
  async checkinForm(actor: GoalActor): Promise<CheckinFormView> {
    const today = todayDushanbe();
    const ctx = await this.loadCtx(actor, ymOf(today), today);
    const krs = ctx.krs.filter(k => (k.level === 'company'
      ? k.ownerId === actor.id
      : ctx.acc.leads.includes(k.department as DeptKey)));
    await this.computeKrs(ctx, krs);
    return {
      weekStart: ctx.week,
      items: krs.map(k => ({
        keyResult: this.krView(ctx, k),
        departmentName: k.level === 'company' ? null : (isDeptKey(k.department) ? DEPT_NAME[k.department] : null),
      })),
    };
  }

  /** POST /compass/checkin — отметки по нескольким КР разом. */
  async submitCheckin(actor: GoalActor, body: any): Promise<CheckinFormView> {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) throw new BadRequestException('Нет отметок');
    if (items.length > 50) throw new BadRequestException('Слишком много отметок за раз');
    const today = todayDushanbe();
    const ym = ymOf(today);
    const { acc } = await this.accessFor(actor);
    // Сначала проверяем всё, потом пишем — без половины сохранённого.
    const prepared: Array<{ kr: GoalKeyResult; c: { status: CheckinStatus; comment: string | null } }> = [];
    for (const it of items) {
      const kr = await this.findKr(String(it?.keyResultId || ''));
      if (!canCheckinKr(acc, kr)) throw new ForbiddenException(`Нет прав отметить «${kr.title}»`);
      if (kr.ym !== ym) throw new BadRequestException('Статус недели отмечают у результатов текущего месяца');
      prepared.push({ kr, c: this.cleanCheckin(it) });
    }
    const week = weekStart(today);
    for (const p of prepared) await this.saveCheckin(p.kr, actor.id, week, p.c);
    return this.checkinForm(actor);
  }

  // ─── Инициативы ────────────────────────────────────────────────────────

  async addInitiative(actor: GoalActor, id: string, body: any): Promise<KeyResultView> {
    const kr = await this.findKr(id);
    const { acc } = await this.accessFor(actor);
    if (!canEditInitiatives(acc, kr)) throw new ForbiddenException('Привязывают те, кто правит результат');
    const kind = String(body?.kind || '');
    if (kind !== 'project' && kind !== 'task') throw new BadRequestException('Привязать можно проект или задачу');
    const refId = String(body?.refId || '');
    if (!isUuid(refId)) throw new BadRequestException(kind === 'project' ? 'Проект не найден' : 'Задача не найдена');
    const rows: any[] = await this.ds.query(
      kind === 'project' ? `SELECT 1 FROM projects WHERE id = $1 LIMIT 1` : `SELECT 1 FROM tasks WHERE id = $1 LIMIT 1`,
      [refId],
    ).catch(() => []);
    if (!rows.length) throw new BadRequestException(kind === 'project' ? 'Проект не найден' : 'Задача не найдена');
    const dup = await this.initRepo.findOne({ where: { keyResultId: kr.id, kind, refId } });
    if (!dup) await this.initRepo.save(this.initRepo.create({ keyResultId: kr.id, kind, refId, createdById: actor.id }));
    return this.keyResultView(actor, kr.id);
  }

  async removeInitiative(actor: GoalActor, id: string): Promise<{ ok: true }> {
    const init = isUuid(id) ? await this.initRepo.findOne({ where: { id } }) : null;
    if (!init) throw new NotFoundException('Привязка не найдена');
    const kr = await this.findKr(init.keyResultId);
    const { acc } = await this.accessFor(actor);
    if (!canEditInitiatives(acc, kr)) throw new ForbiddenException('Отвязывают те, кто правит результат');
    await this.initRepo.delete(init.id);
    return { ok: true };
  }

  // ─── Разложить по менеджерам ───────────────────────────────────────────

  /** POST /compass/key-results/:id/distribute — цели месяца менеджерам
   *  продаж под КР «Выигранные сделки» отдела продаж. Уже поставленная под
   *  этот КР цель обновляется (считается в created), лимит целей на месяц
   *  соблюдается. */
  async distribute(actor: GoalActor, id: string, body: any): Promise<{ created: number; skipped: Array<{ userId: string; reason: string }> }> {
    const kr = await this.findKr(id);
    if (kr.level !== 'department' || kr.department !== 'sales' || kr.source !== 'won_deals') {
      throw new BadRequestException('Разложить по менеджерам можно результат отдела продаж «Выигранные сделки»');
    }
    const { acc, users } = await this.accessFor(actor);
    if (!canEditKr(acc, kr)) throw new ForbiddenException('Раскладывает руководитель отдела продаж');
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) throw new BadRequestException('Укажите менеджеров');
    if (items.length > 50) throw new BadRequestException('Слишком много менеджеров за раз');

    const byId = new Map(users.map(u => [u.id, u] as [string, DeptUser]));
    let created = 0;
    const skipped: Array<{ userId: string; reason: string }> = [];
    const seen = new Set<string>();
    for (const it of items) {
      const userId = String(it?.userId || '');
      if (seen.has(userId)) { skipped.push({ userId, reason: 'Менеджер указан дважды' }); continue; }
      seen.add(userId);
      const u = byId.get(userId);
      if (!u || u.isActive === false || u.isBlocked) { skipped.push({ userId, reason: 'Сотрудник не найден' }); continue; }
      const role = salesRoleOf(u);
      if (!role) { skipped.push({ userId, reason: 'Не менеджер продаж' }); continue; }
      const target = Math.round(Number(it?.target));
      if (!(target > 0 && target <= 1000)) { skipped.push({ userId, reason: 'Цель — от 1 до 1000' }); continue; }
      const dir = getSalesSegment(role)?.leadDirection;
      const title = dir === 'development'
        ? `${target} ${plural(target, 'новый проект', 'новых проекта', 'новых проектов')}`
        : `${target} ${plural(target, 'новый клиент', 'новых клиента', 'новых клиентов')}`;

      const existing = await this.goalRepo.findOne({ where: { userId, ym: kr.ym, keyResultId: kr.id } });
      if (existing) {
        existing.title = title;
        existing.metric = 'won_deals';
        existing.target = target;
        await this.goalRepo.save(existing);
        created += 1;
        continue;
      }
      const count = await this.goalRepo.count({ where: { userId, ym: kr.ym } });
      if (count >= MAX_GOALS_PER_MONTH) {
        skipped.push({ userId, reason: `Уже ${MAX_GOALS_PER_MONTH} цели на месяц` });
        continue;
      }
      await this.goalRepo.save(this.goalRepo.create({
        userId, ym: kr.ym, title, metric: 'won_deals', target, done: false, keyResultId: kr.id, createdById: actor.id,
      }));
      created += 1;
    }
    return { created, skipped };
  }

  // ─── Перенос месяца ────────────────────────────────────────────────────

  /** POST /compass/copy-month — цели и КР fromYm в toYm (без цифр, отметок
   *  и инициатив). isTop — всё, руководитель — КР своих отделов. Уже
   *  существующие в toYm с тем же названием не дублируются. */
  async copyMonth(actor: GoalActor, body: any): Promise<{ objectives: number; keyResults: number }> {
    const fromYm = String(body?.fromYm || '');
    const toYm = String(body?.toYm || '');
    if (!isYm(fromYm) || !isYm(toYm)) throw new BadRequestException('Месяцы — YYYY-MM');
    if (fromYm === toYm) throw new BadRequestException('Месяцы совпадают');
    const { acc } = await this.accessFor(actor);
    if (!acc.details) throw new ForbiddenException('Переносят цели руководители отделов и основатель');
    const scope = copyScope(acc);

    const [fromObjs, fromKrs, toObjs, toKrs] = await Promise.all([
      this.objRepo.find({ where: { ym: fromYm }, order: { sortOrder: 'ASC', createdAt: 'ASC' } }),
      this.krRepo.find({ where: { ym: fromYm }, order: { sortOrder: 'ASC', createdAt: 'ASC' } }),
      this.objRepo.find({ where: { ym: toYm } }),
      this.krRepo.find({ where: { ym: toYm } }),
    ]);

    let objectives = 0;
    let keyResults = 0;
    const objMap = new Map<string, string>();
    const krMap = new Map<string, string>();
    const copyKr = (k: GoalKeyResult, extra: Partial<GoalKeyResult>): Partial<GoalKeyResult> => ({
      ym: toYm, level: k.level, department: k.department, objectiveId: null, parentId: null,
      title: k.title, source: k.source, sourceParams: k.sourceParams || {}, target: Number(k.target),
      unit: k.unit, manualValue: null, ownerId: k.ownerId, sortOrder: k.sortOrder, createdById: actor.id,
      ...extra,
    });

    await this.ds.transaction(async m => {
      const objRepo = m.getRepository(GoalObjective);
      const krRepo = m.getRepository(GoalKeyResult);
      const companyFrom = fromKrs.filter(k => k.level === 'company');
      if (scope.company) {
        for (const o of fromObjs) {
          const dup = toObjs.find(x => normTitle(x.title) === normTitle(o.title));
          if (dup) { objMap.set(o.id, dup.id); continue; }
          const saved = await objRepo.save(objRepo.create({
            ym: toYm, title: o.title, ownerId: o.ownerId, sortOrder: o.sortOrder, createdById: actor.id,
          }));
          toObjs.push(saved);
          objMap.set(o.id, saved.id);
          objectives += 1;
        }
        for (const k of companyFrom) {
          const dup = toKrs.find(x => x.level === 'company' && normTitle(x.title) === normTitle(k.title));
          if (dup) { krMap.set(k.id, dup.id); continue; }
          const objectiveId = k.objectiveId ? objMap.get(k.objectiveId) : undefined;
          if (!objectiveId) continue;
          const saved = await krRepo.save(krRepo.create(copyKr(k, { objectiveId })));
          toKrs.push(saved);
          krMap.set(k.id, saved.id);
          keyResults += 1;
        }
      } else {
        // Руководитель: КР компании нового месяца уже поставлены — родителей
        // находим по названию.
        for (const k of companyFrom) {
          const dup = toKrs.find(x => x.level === 'company' && normTitle(x.title) === normTitle(k.title));
          if (dup) krMap.set(k.id, dup.id);
        }
      }
      for (const k of fromKrs) {
        if (k.level !== 'department' || !scope.departments.includes(k.department as DeptKey)) continue;
        const dup = toKrs.find(x => x.level === 'department' && x.department === k.department
          && normTitle(x.title) === normTitle(k.title));
        if (dup) continue;
        const parentId = k.parentId ? krMap.get(k.parentId) ?? null : null;
        const saved = await krRepo.save(krRepo.create(copyKr(k, { parentId })));
        toKrs.push(saved);
        keyResults += 1;
      }
    });
    return { objectives, keyResults };
  }

  // ─── Настройки и люди ──────────────────────────────────────────────────

  async settings(actor: GoalActor): Promise<GoalSettingsView> {
    const { acc, users } = await this.accessFor(actor);
    if (!canManageSettings(acc)) throw new ForbiddenException('Руководителей отделов назначают основатель и админ');
    return this.settingsView(users);
  }

  private async settingsView(users: DeptUser[]): Promise<GoalSettingsView> {
    const overrides = await loadLeaderOverrides(this.ds);
    const leaders = pickLeaders(users, overrides);
    const live = users.filter(u => u.isActive !== false && !u.isBlocked);
    return {
      leaders,
      overrides: {
        sales: overrides.sales ?? null,
        smm: overrides.smm ?? null,
        dev: overrides.dev ?? null,
        management: overrides.management ?? null,
      },
      candidates: live.map(u => ({ id: u.id, name: u.name, role: u.role })),
    };
  }

  async saveSettings(actor: GoalActor, body: any): Promise<GoalSettingsView> {
    const { acc, users } = await this.accessFor(actor);
    if (!canManageSettings(acc)) throw new ForbiddenException('Руководителей отделов назначают основатель и админ');
    const raw = body?.leaders;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Нет руководителей');
    const current = await loadLeaderOverrides(this.ds);
    const live = new Set(users.filter(u => u.isActive !== false && !u.isBlocked).map(u => u.id));
    for (const [k, v] of Object.entries(raw)) {
      if (!isDeptKey(k)) throw new BadRequestException('Неизвестный отдел');
      if (v === null || v === undefined || v === '') { delete current[k]; continue; }
      if (!live.has(String(v))) throw new BadRequestException('Сотрудник не найден или не работает');
      current[k] = String(v);
    }
    await this.settingRepo.save(this.settingRepo.create({ key: 'leaders', value: current, updatedById: actor.id }));
    return this.settingsView(users);
  }

  /** GET /compass/people — выбор ответственного. */
  async people(actor: GoalActor, search?: string): Promise<GoalPerson[]> {
    const { acc, users } = await this.accessFor(actor);
    if (!acc.details) throw new ForbiddenException('Нет доступа');
    const needle = String(search || '').trim().toLowerCase();
    return users
      .filter(u => u.isActive !== false && !u.isBlocked)
      .filter(u => !needle || u.name.toLowerCase().includes(needle))
      .slice(0, 100)
      .map(u => ({ id: u.id, name: u.name, role: u.role, department: departmentOfRole(u.role) }));
  }

  // ─── Для планировщика ──────────────────────────────────────────────────

  /** Активные основатели. */
  async founderIds(): Promise<string[]> {
    const users = await loadDeptUsers(this.ds);
    return users.filter(u => u.role === 'founder' && u.isActive !== false && !u.isBlocked).map(u => u.id);
  }

  /** Отделы, у которых есть КР месяца, и их руководители. */
  async departmentsWithKeyResults(ym: string): Promise<{ leaders: Leaders; departments: DeptKey[] }> {
    const rows: any[] = await this.ds.query(
      `SELECT DISTINCT department FROM goal_key_results WHERE ym = $1 AND level = 'department'`, [ym],
    ).catch(() => []);
    const set = new Set(rows.map(r => String(r.department)));
    return { leaders: await resolveLeaders(this.ds), departments: DEPT_KEYS.filter(k => set.has(k)) };
  }

  /** Дайджест основателю: КР в риске и отделы без отметки недели. */
  async digest(today: string = todayDushanbe()): Promise<{ ym: string; week: string; lines: string[] }> {
    const ym = ymOf(today);
    const ctx = await this.loadCtx(SYSTEM_ACTOR, ym, today);
    await this.computeKrs(ctx, ctx.krs);
    const lines: string[] = [];
    for (const b of this.badKeyResults(ctx)) {
      const word = b.c.status === 'off_track' ? 'отстаём' : 'риск';
      lines.push(`${b.label} · ${b.kr.title}: ${b.text} (${word})`);
    }
    for (const key of DEPT_KEYS) {
      const krs = this.deptKrs(ctx, key);
      if (krs.length && !this.checkedThisWeek(ctx, krs)) lines.push(`${DEPT_NAME[key]} не отметил статус недели`);
    }
    return { ym, week: ctx.week, lines };
  }

  /** Есть ли цели компании и КР отделов в месяце. */
  async monthState(ym: string): Promise<{ objectives: number; departments: Set<string> }> {
    const [objectives, rows] = await Promise.all([
      this.objRepo.count({ where: { ym } }),
      this.ds.query(`SELECT DISTINCT department FROM goal_key_results WHERE ym = $1 AND level = 'department'`, [ym])
        .catch(() => [] as any[]),
    ]);
    return { objectives, departments: new Set((rows as any[]).map(r => String(r.department))) };
  }
}
