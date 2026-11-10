import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { checkDate as checkDateLoose, esc, fmtDateRu, nameScore, norm, roles, splitDushanbe } from './common';
import { ToolContext, ToolDef, ToolError, UndoStep, WriteOutcome } from './types';

/**
 * «Остальное» из сайта, что не вошло в другие разделы: «моя зарплата», профиль и цели,
 * KPI и аналитика, журнал действий, тарифы СММ, справочник организатора съёмок,
 * планы продаж, звонки лидам, повтор недели задач, спринты, флаги сотрудников.
 * Всё — через API сайта; права повторяют сайт (грант, роль ИЛИ вторая роль).
 *
 * Чего нет намеренно: загрузка фото модели и файлов, вебхуки и служебные эндпоинты,
 * массовые действия над задачами (bulk) — для них есть одиночные инструменты задач,
 * «Команды» и «Таймер» (в интерфейсе сайта нет их страниц), чистка умного календаря
 * проекта (стирает все заготовки сразу без возврата).
 */

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const grant = (key: string) => (u: any) => hasGrant(u, key);
const hasRole = (u: any, ...list: string[]) => roles(u).some((r) => list.includes(r));
const isTop = (u: any) => hasRole(u, 'admin', 'founder');
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

function checkDate(value: unknown, field = 'дата'): string {
  const s = checkDateLoose(value, field);
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new ToolError(`Неверная ${field}: «${s}» — такого дня нет.`);
  return s;
}

function checkYm(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ToolError(`Неверный месяц: «${s}». Нужен формат ГГГГ-ММ.`);
  return s;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function getOrThrow<T = any>(ctx: ToolContext, path: string, query?: Record<string, any>): Promise<T> {
  try { return await ctx.api.get<T>(path, query); } catch (e) { throw apiErr(e); }
}

/** Сотрудник по метке E… или имени (из карточек сотрудников: userId, имя, флаги). */
async function pickEmployee(ctx: ToolContext, spoken: unknown): Promise<any> {
  const s = String(spoken ?? '').trim();
  if (!s) throw new ToolError('Какой сотрудник? Назовите имя.');
  const rows = (await getOrThrow<any[]>(ctx, '/employees')).filter((e) => e?.id);
  const byRef = ctx.refs.resolve('E', s);
  let row: any = byRef ? rows.find((r) => r.userId === byRef.id) : undefined;
  if (!row) {
    if (/^E\d+$/i.test(s)) throw new ToolError(`Нет сотрудника с меткой «${s}». Найдите его через find_employees.`);
    const scored = rows
      .map((r) => ({ r, sc: Math.max(nameScore(String(r.fullName || ''), s), nameScore(s, String(r.fullName || ''))) }))
      .filter((x) => x.sc >= 0.5)
      .sort((a, b) => b.sc - a.sc);
    if (!scored.length) throw new ToolError(`Сотрудника «${s}» не нашла. Назовите имя точнее.`);
    const exact = scored.filter((x) => norm(x.r.fullName) === norm(s));
    if (exact.length === 1) row = exact[0].r;
    else if (scored.length > 1 && scored[0].sc === scored[1].sc) {
      const opts = scored.filter((x) => x.sc === scored[0].sc).slice(0, 6).map((x) => x.r.fullName);
      throw new ToolError(`Под «${s}» подходят несколько: ${opts.join(', ')}. Уточните через ask_choice.`);
    } else row = scored[0].r;
  }
  if (row.userId) ctx.refs.add('E', row.userId, String(row.fullName || ''));
  return row;
}

const EMP_PROP = { type: 'string', description: 'Метка E… или имя сотрудника.' };

// ═══ Моя зарплата и профиль ═════════════════════════════════════════════

export const mySalary: ToolDef<Record<string, never>> = {
  name: 'my_salary',
  kind: 'read',
  description:
    'МОЯ зарплата за текущий месяц, как в профиле на сайте: оклад, начислено, штрафы, премии, авансы, к выплате, история. '
    + '«Сколько я заработал», «моя зарплата», «сколько мне должны». Только про самого говорящего. '
    + 'Чужую ведомость показывает salary_sheet (только тем, у кого есть доступ к финансам).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, ctx) {
    return getOrThrow(ctx, '/me/salary');
  },
};

export const myProfileStats: ToolDef<Record<string, never>> = {
  name: 'my_profile_stats',
  kind: 'read',
  description:
    'МОЙ профиль-достижения: эффективность месяца, серии (дни без опозданий и т.п.), уровень, бонус и ЦЕЛИ месяца с прогрессом. '
    + '«Как моя эффективность», «какие у меня цели», «моя серия». Про себя. Чужие цели — employee_goals.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, ctx) {
    return getOrThrow(ctx, '/me/profile-stats');
  },
};

export const employeeGoals: ToolDef<{ employee?: string; month?: string }> = {
  name: 'employee_goals',
  kind: 'read',
  description:
    'Цели месяца сотрудника (свои — если имя не назвали) с метками G и прогрессом. «Какие цели у Фирузы на ноябрь». '
    + 'Не для эффективности и KPI (это employee_kpi).',
  parameters: {
    type: 'object',
    properties: { employee: EMP_PROP, month: { type: 'string', description: 'ГГГГ-ММ; по умолчанию текущий.' } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const userId = args.employee ? (await pickEmployee(ctx, args.employee)).userId : ctx.user.id;
    if (!userId) throw new ToolError('У этого сотрудника нет учётки CRM.');
    const data = await getOrThrow<any>(ctx, `/goals/user/${userId}`, args.month ? { ym: checkYm(args.month) } : undefined);
    return {
      month: data.ym, canEdit: !!data.canEdit, max: data.max,
      goals: (data.goals || []).map((g: any) => ({
        ref: ctx.refs.add('X', g.id, String(g.title || '')),
        title: g.title, metric: g.metric || undefined, target: g.target ?? undefined,
        value: g.value ?? undefined, reached: !!g.reached, done: !!g.done,
      })),
      metrics: (data.metrics || []).map((m: any) => ({ key: m.key, label: m.label })),
    };
  },
};

function resolveGoal(ctx: ToolContext, spoken: unknown): string {
  const e = ctx.refs.resolve('X', spoken);
  if (!e) throw new ToolError('Не знаю такую цель. Сначала посмотрите цели через employee_goals.');
  return e.id;
}

export const goalSet: ToolDef<{ employee: string; title: string; metric?: string; target?: number; month?: string }> = {
  name: 'goal_set',
  kind: 'write',
  description:
    'Поставить сотруднику ЦЕЛЬ на месяц (руководитель направления и основатель): «поставь Фирузе цель — закрыть 10 смен без опозданий». '
    + 'Либо свободная цель (только title, сотрудник сам отметит), либо с показателем metric (efficiency, ontime_shifts, stories_days, kpi:<ключ>) '
    + 'и числом target, тогда CRM считает сама. Не задача (задачи — create_task).',
  parameters: {
    type: 'object',
    properties: {
      employee: EMP_PROP,
      title: { type: 'string', description: 'Формулировка цели.' },
      metric: { type: 'string', description: 'Показатель, только если назвали измеримую цель.' },
      target: { type: 'number', description: 'Сколько нужно (с metric).' },
      month: { type: 'string', description: 'ГГГГ-ММ; по умолчанию текущий.' },
    },
    required: ['employee', 'title'],
    additionalProperties: false,
  },
  confirm: () => true,
  async preview(args, ctx) {
    const emp = await pickEmployee(ctx, args.employee);
    if (!clip(args.title, 200)) throw new ToolError('Какая цель? Назовите формулировку.');
    return `🎯 ПОСТАВИТЬ ЦЕЛЬ\n👤 ${esc(emp.fullName)}\n📝 ${esc(clip(args.title, 200))}`
      + `${args.metric ? `\n📊 ${esc(args.metric)} → ${esc(args.target)}` : ''}${args.month ? `\n📅 ${esc(args.month)}` : ''}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const emp = await pickEmployee(ctx, args.employee);
    if (!emp.userId) throw new ToolError(`У «${emp.fullName}» нет учётки CRM.`);
    const title = clip(args.title, 200);
    if (!title) throw new ToolError('Какая цель? Назовите формулировку.');
    const body: Record<string, any> = { userId: emp.userId, title };
    if (args.metric) { body.metric = clip(args.metric, 40); body.target = num(args.target); }
    if (args.month) body.ym = checkYm(args.month);
    const before = await getOrThrow<any>(ctx, `/goals/user/${emp.userId}`, body.ym ? { ym: body.ym } : undefined);
    const known = new Set((before.goals || []).map((g: any) => g.id));
    let after: any;
    try { after = await ctx.api.post('/goals', body); } catch (e) { throw apiErr(e); }
    const created = (after?.goals || []).find((g: any) => !known.has(g.id));
    return {
      summary: `🎯 ${emp.fullName}: цель «${title}»`,
      undo: created ? [{ method: 'DELETE', path: `/goals/${created.id}` }] : undefined,
    };
  },
};

export const goalDone: ToolDef<{ goal: string; done?: boolean }> = {
  name: 'goal_done',
  kind: 'write',
  description:
    'Отметить свободную цель выполненной (или снять отметку): «отметь цель выполненной». Метка G из employee_goals. '
    + 'Цели с показателем CRM считает сама — их отметить нельзя.',
  parameters: {
    type: 'object',
    properties: { goal: { type: 'string', description: 'Метка цели из employee_goals.' }, done: { type: 'boolean', description: 'По умолчанию true.' } },
    required: ['goal'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const id = resolveGoal(ctx, args.goal);
    const done = args.done !== false;
    try { await ctx.api.patch(`/goals/${id}`, { done }); } catch (e) { throw apiErr(e); }
    return {
      summary: done ? '✅ Цель отмечена выполненной' : '↩ Отметка о выполнении цели снята',
      undo: [{ method: 'PATCH', path: `/goals/${id}`, body: { done: !done } }],
    };
  },
};

export const goalDelete: ToolDef<{ goal: string }> = {
  name: 'goal_delete',
  kind: 'write',
  description: 'Убрать цель сотрудника (руководитель направления и основатель): «убери цель». Метка из employee_goals.',
  parameters: {
    type: 'object',
    properties: { goal: { type: 'string', description: 'Метка цели из employee_goals.' } },
    required: ['goal'],
    additionalProperties: false,
  },
  confirm: () => true,
  async preview(args, ctx) {
    const e = ctx.refs.resolve('X', args.goal);
    if (!e) throw new ToolError('Не знаю такую цель. Сначала посмотрите цели через employee_goals.');
    return `🗑 УБРАТЬ ЦЕЛЬ\n📝 ${esc(e.label)}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const id = resolveGoal(ctx, args.goal);
    const label = ctx.refs.label('X', id) || 'цель';
    try { await ctx.api.delete(`/goals/${id}`); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 Цель «${label}» убрана` };
  },
};

// ═══ KPI и аналитика ════════════════════════════════════════════════════

export const employeeKpi: ToolDef<{ employee?: string; everyone?: boolean; from?: string; to?: string }> = {
  name: 'employee_kpi',
  kind: 'read',
  description:
    'KPI сотрудника за период (месяц по умолчанию): общий процент и показатели. «Мой KPI», «KPI Фирузы», «KPI всей команды». '
    + 'Без имени — свой; everyone=true — по всем (руководству). Руководитель направления видит свою команду. '
    + 'Не про зарплату и не про цели.',
  parameters: {
    type: 'object',
    properties: {
      employee: EMP_PROP,
      everyone: { type: 'boolean', description: 'true — KPI всех сотрудников.' },
      from: { type: 'string', description: 'ГГГГ-ММ-ДД, начало периода.' },
      to: { type: 'string', description: 'ГГГГ-ММ-ДД, конец периода.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const query: Record<string, any> = {};
    if (args.from) query.from = checkDate(args.from, 'дата начала');
    if (args.to) query.to = checkDate(args.to, 'дата конца');
    const compact = (k: any) => ({
      overallPercent: k.overallPercent, noData: !!k.noData,
      items: (k.items || []).map((i: any) => ({ label: i.label, value: i.value, target: i.target, percent: i.percent, done: !!i.done })),
    });
    if (args.everyone) {
      if (!hasRole(ctx.user, 'admin', 'founder', 'dev_director')) throw new ToolError('KPI всей команды видит только руководство.');
      const names = new Map<string, string>();
      for (const e of await getOrThrow<any[]>(ctx, '/employees')) if (e.userId) names.set(e.userId, e.fullName);
      const all = await getOrThrow<any[]>(ctx, '/kpi/all', query);
      return (all || []).map((k) => ({
        employee: names.get(k.userId) || 'сотрудник',
        ref: names.has(k.userId) ? ctx.refs.add('E', k.userId, names.get(k.userId)!) : undefined,
        ...compact(k),
      }));
    }
    const target = args.employee ? await pickEmployee(ctx, args.employee) : null;
    const userId = target ? target.userId : ctx.user.id;
    if (!userId) throw new ToolError('У этого сотрудника нет учётки CRM.');
    const res = await getOrThrow<any>(ctx, `/kpi/user/${userId}`, query);
    if (!res) {
      throw new ToolError(target
        ? 'KPI этого сотрудника вам смотреть нельзя: руководство видит всех, руководитель направления — свою команду, остальные — только свой.'
        : 'Для вашей роли личный KPI не считается.');
    }
    return { employee: target ? target.fullName : 'я', ...compact(res) };
  },
};

const ANALYTICS: Record<string, { path: string; perm: string; title: string }> = {
  overview: { path: '/analytics/overview', perm: 'analytics.view', title: 'Сводка: проекты, задачи, сотрудники, просрочка, часы' },
  projects_by_status: { path: '/analytics/projects-by-status', perm: 'analytics.view', title: 'Проекты по статусам' },
  tasks_by_status: { path: '/analytics/tasks-by-status', perm: 'analytics.view', title: 'Задачи по статусам' },
  tasks_by_priority: { path: '/analytics/tasks-by-priority', perm: 'analytics.view', title: 'Задачи по приоритетам' },
  employee_efficiency: { path: '/analytics/employee-efficiency', perm: 'analytics.view', title: 'Эффективность сотрудников' },
  employee_workload: { path: '/analytics/employee-workload', perm: 'analytics.view', title: 'Загрузка сотрудников' },
  projects_performance: { path: '/analytics/projects-performance', perm: 'analytics.view', title: 'Показатели проектов' },
  department_stats: { path: '/analytics/department-stats', perm: 'analytics.view', title: 'По отделам' },
  avg_completion: { path: '/analytics/avg-completion', perm: 'analytics.view', title: 'Среднее время выполнения задач' },
  sales: { path: '/analytics/sales', perm: 'analytics.sales', title: 'Продажи' },
  payroll: { path: '/analytics/payroll', perm: 'analytics.payroll', title: 'Зарплатный фонд' },
  income_expense: { path: '/analytics/income-expense', perm: 'analytics.income-expense', title: 'Доходы и расходы' },
  stories_global: { path: '/analytics/stories-global', perm: '', title: 'Сторис по всем проектам' },
};
const ANALYTICS_KINDS = Object.keys(ANALYTICS);

const trim = (data: any, max = 30): any => {
  if (Array.isArray(data)) return data.slice(0, max).map((x) => trim(x, max));
  if (data && typeof data === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (/^(avatar|password|token|createdAt|updatedAt)$/i.test(k)) continue;
      out[k] = trim(v, max);
    }
    return out;
  }
  return data;
};

export const analyticsReport: ToolDef<{ kind: string; from?: string; to?: string; year?: number; month?: number }> = {
  name: 'analytics_report',
  kind: 'read',
  description:
    'Аналитика компании, как раздел «Аналитика» на сайте. kind: ' + ANALYTICS_KINDS.join(', ') + '. '
    + '«Сколько задач в просрочке» → overview, «загрузка сотрудников» → employee_workload, «продажи» → sales, '
    + '«доходы и расходы» → income_expense (нужны права аналитики), «сторис по проектам» → stories_global (from/to обязательны). '
    + 'Не для отдельных денежных операций (finance_journal) и не для задач списком (find_tasks).',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ANALYTICS_KINDS },
      from: { type: 'string', description: 'ГГГГ-ММ-ДД (payroll, income_expense, stories_global).' },
      to: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u, 'analytics.view') || hasRole(u, 'founder', 'admin', 'smm_director'),
  async run(args, ctx) {
    const def = ANALYTICS[args.kind];
    if (!def) throw new ToolError(`Не знаю такую аналитику «${args.kind}». Доступно: ${ANALYTICS_KINDS.join(', ')}.`);
    if (def.perm && !hasGrant(ctx.user, def.perm)) throw new ToolError('Этот отчёт аналитики вам недоступен.');
    if (!def.perm && !hasRole(ctx.user, 'founder', 'admin', 'smm_director')) throw new ToolError('Этот отчёт аналитики вам недоступен.');
    const query: Record<string, any> = {};
    if (args.from) query.from = checkDate(args.from, 'дата начала');
    if (args.to) query.to = checkDate(args.to, 'дата конца');
    if (args.kind === 'stories_global' && (!query.from || !query.to)) throw new ToolError('За какой период? Нужны даты начала и конца.');
    const data = await getOrThrow(ctx, def.path, query);
    return { report: def.title, data: trim(data && data.data !== undefined && !Array.isArray(data) ? data.data : data) };
  },
};

const RISK_VIEWS: Record<string, string> = {
  projects: '/risk-analytics/risks/projects',
  employees: '/risk-analytics/risks/employees',
  workload_employees: '/risk-analytics/workload/employees',
  workload_pm: '/risk-analytics/workload/pm',
};

export const riskReport: ToolDef<{ view: string }> = {
  name: 'risk_report',
  kind: 'read',
  description:
    'Риски и загрузка, как раздел рисков на сайте: view = projects (какие проекты в зоне риска и почему), employees (риски по людям), '
    + 'workload_employees (загрузка сотрудников), workload_pm (загрузка проект-менеджеров). «Какие проекты под угрозой», «кто перегружен».',
  parameters: {
    type: 'object',
    properties: { view: { type: 'string', enum: Object.keys(RISK_VIEWS) } },
    required: ['view'],
    additionalProperties: false,
  },
  available: grant('risks.view'),
  async run(args, ctx) {
    const path = RISK_VIEWS[args.view];
    if (!path) throw new ToolError(`Не знаю такой вид «${args.view}». Доступно: ${Object.keys(RISK_VIEWS).join(', ')}.`);
    return trim(await getOrThrow(ctx, path), 25);
  },
};

export const activityFeed: ToolDef<{ employee?: string; entity?: string; from?: string; to?: string; limit?: number }> = {
  name: 'activity_feed',
  kind: 'read',
  description:
    'Журнал действий в CRM (кто что сделал): «что делал Али сегодня», «кто удалил проект», «последние действия команды». '
    + 'Только основатель и админ. Не для смен и опозданий (team_timesheet) и не для денежных операций (finance_journal).',
  parameters: {
    type: 'object',
    properties: {
      employee: EMP_PROP,
      entity: { type: 'string', description: 'Тип объекта: task, project, client, employee…' },
      from: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      to: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      limit: { type: 'number', description: 'Сколько записей, до 40; по умолчанию 20.' },
    },
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    const query: Record<string, any> = { limit: Math.min(Math.max(Number(args.limit) || 20, 1), 40) };
    if (args.employee) {
      const emp = await pickEmployee(ctx, args.employee);
      if (!emp.userId) throw new ToolError(`У «${emp.fullName}» нет учётки CRM.`);
      query.userId = emp.userId;
    }
    if (args.entity) query.entity = clip(args.entity, 40);
    if (args.from) query.from = checkDate(args.from, 'дата начала');
    if (args.to) query.to = checkDate(args.to, 'дата конца');
    const res = await getOrThrow<any>(ctx, '/activity-log', query);
    const items: any[] = Array.isArray(res) ? res : res?.items || [];
    return {
      total: res?.total ?? items.length,
      items: items.map((a) => {
        const at = splitDushanbe(a.createdAt);
        return { when: at ? `${fmtDateRu(at.date)} ${at.time}` : undefined, who: a.userName, action: a.action, entity: a.entity, name: a.entityName || undefined };
      }),
    };
  },
};

export const taskOverview: ToolDef<{ view: string }> = {
  name: 'task_overview',
  kind: 'read',
  description:
    'Срезы задач: view = assigned_by_me (что поставил Я другим), from_management (что мне поставило руководство), '
    + 'stats (сколько задач по статусам). «Что я поручил команде», «задачи от руководства». Поиск по названию/людям — find_tasks.',
  parameters: {
    type: 'object',
    properties: { view: { type: 'string', enum: ['assigned_by_me', 'from_management', 'stats'] } },
    required: ['view'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const paths: Record<string, string> = { assigned_by_me: '/tasks/assigned-by-me', from_management: '/tasks/from-management', stats: '/tasks/stats' };
    const path = paths[args.view];
    if (!path) throw new ToolError('Нужно assigned_by_me, from_management или stats.');
    const data = await getOrThrow<any>(ctx, path);
    if (args.view === 'stats') return data;
    const list: any[] = Array.isArray(data) ? data : [];
    return {
      total: list.length,
      tasks: list.slice(0, 30).map((t) => ({
        ref: ctx.refs.add('T', t.id, String(t.title || '')), title: t.title, status: t.status, priority: t.priority,
        deadline: splitDushanbe(t.deadline)?.date, assignee: t.assignee?.name || t.assignee?.fullName,
      })),
    };
  },
};

export const clientsOverview: ToolDef<{ view: string }> = {
  name: 'clients_overview',
  kind: 'read',
  description:
    'Цифры по лидам и менеджерам продаж: view = stats (лиды по статусам и потенциал), kpi (мой KPI менеджера продаж: звонки, письма, встречи), '
    + 'kpi_all (KPI всех менеджеров, нужен доступ). «Сколько у нас лидов», «мой KPI по продажам». Поиск конкретного клиента — find_clients.',
  parameters: {
    type: 'object',
    properties: { view: { type: 'string', enum: ['stats', 'kpi', 'kpi_all'] } },
    required: ['view'],
    additionalProperties: false,
  },
  available: grant('clients.view'),
  async run(args, ctx) {
    const paths: Record<string, string> = { stats: '/clients/stats', kpi: '/clients/kpi', kpi_all: '/clients/kpi/all' };
    const path = paths[args.view];
    if (!path) throw new ToolError('Нужно stats, kpi или kpi_all.');
    if (args.view === 'kpi_all' && !hasGrant(ctx.user, 'clients.kpi.all')) throw new ToolError('KPI всех менеджеров вам недоступен.');
    return trim(await getOrThrow(ctx, path));
  },
};

// ═══ Звонок лидам ═══════════════════════════════════════════════════════

async function pickLeads(ctx: ToolContext, spoken: unknown): Promise<Array<{ id: string; name: string }>> {
  const items = Array.isArray(spoken) ? spoken : [spoken];
  if (!items.length || items.some((i) => !String(i ?? '').trim())) throw new ToolError('Каких лидов? Назовите метки или названия.');
  if (items.length > 20) throw new ToolError('Больше 20 лидов за раз не отмечаю.');
  const out: Array<{ id: string; name: string }> = [];
  let all: any[] | null = null;
  for (const it of items) {
    const s = String(it).trim();
    const byRef = ctx.refs.resolve('C', s);
    if (byRef) { out.push({ id: byRef.id, name: byRef.label }); continue; }
    if (/^C\d+$/i.test(s)) throw new ToolError(`Нет лида с меткой «${s}». Найдите его через find_clients.`);
    all = all ?? await getOrThrow<any[]>(ctx, '/clients');
    const scored = all.map((c) => ({ c, sc: nameScore(String(c.name || ''), s) })).filter((x) => x.sc >= 0.75).sort((a, b) => b.sc - a.sc);
    if (!scored.length) throw new ToolError(`Лида «${s}» не нашла. Уточните название или найдите через find_clients.`);
    if (scored.length > 1 && scored[0].sc === scored[1].sc) {
      throw new ToolError(`Под «${s}» подходят несколько: ${scored.slice(0, 5).map((x) => x.c.name).join(', ')}. Уточните через ask_choice.`);
    }
    out.push({ id: scored[0].c.id, name: String(scored[0].c.name) });
  }
  return out;
}

export const clientCallRequest: ToolDef<{ clients: string[]; call?: boolean }> = {
  name: 'client_call_request',
  kind: 'write',
  description:
    'Кнопка «Позвонить» в базе лидов: руководитель отмечает лидов для обзвона — их менеджеры получают уведомление (call=true, по умолчанию); '
    + 'call=false снимает отметку («звонок сделан», «убери из обзвона»). «Отметь на обзвон Архидею и Бахор». '
    + 'Это НЕ звонок клиенту и НЕ сообщение клиенту — только пометка внутри CRM. Ставить отметку может основатель/админ.',
  parameters: {
    type: 'object',
    properties: {
      clients: { type: 'array', items: { type: 'string' }, description: 'Метки C… или названия лидов (до 20).' },
      call: { type: 'boolean', description: 'true — поставить отметку, false — снять.' },
    },
    required: ['clients'],
    additionalProperties: false,
  },
  available: grant('clients.edit'),
  confirm: (args) => args.call !== false,
  async preview(args, ctx) {
    const leads = await pickLeads(ctx, args.clients);
    return `📞 ОТМЕТИТЬ НА ОБЗВОН\n${leads.map((l) => `• ${esc(l.name)}`).join('\n')}\nМенеджеры этих лидов получат уведомление.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const flag = args.call !== false;
    if (flag && !hasRole({ role: ctx.user.role, secondaryRole: null }, 'admin', 'founder')) {
      throw new ToolError('Назначать звонки может только руководитель.');
    }
    const leads = await pickLeads(ctx, args.clients);
    const ids = leads.map((l) => l.id);
    let res: any;
    try { res = await ctx.api.post('/clients/call-request', { ids, flag }); } catch (e) { throw apiErr(e); }
    const updated = Number(res?.updated ?? 0);
    if (!updated) throw new ToolError(flag ? 'Ни одного лида не отметила.' : 'Снять отметку не получилось: она есть не у этих лидов или они чужие.');
    const names = leads.map((l) => l.name).join(', ');
    return {
      summary: flag ? `📞 На обзвон: ${names}` : `✅ С обзвона снято: ${names}`,
      undo: [{ method: 'POST', path: '/clients/call-request', body: { ids, flag: !flag } }],
    };
  },
};

// ═══ Тарифы СММ ═════════════════════════════════════════════════════════

const TARIFF_NUM: Record<string, string> = {
  monthly_price: 'monthlyPrice', stories: 'storiesPerMonth', reels: 'reelsPerMonth', posts: 'postsPerMonth',
  designs: 'designsPerMonth', shooting_days: 'shootingDaysPerMonth', reports: 'reportsPerMonth',
  revisions: 'revisionLimit', duration_days: 'durationDays',
};
const TARIFF_LABEL: Record<string, string> = {
  monthlyPrice: 'цена/мес', storiesPerMonth: 'сторис', reelsPerMonth: 'рилсов', postsPerMonth: 'постов', designsPerMonth: 'дизайнов',
  shootingDaysPerMonth: 'дней съёмки', reportsPerMonth: 'отчётов', revisionLimit: 'правок', durationDays: 'дней',
};

const compactTariff = (ctx: ToolContext, t: any) => ({
  ref: ctx.refs.add('X', t.id, String(t.name || '')),
  name: t.name, price: num(t.monthlyPrice) ?? undefined, stories: t.storiesPerMonth, reels: t.reelsPerMonth, posts: t.postsPerMonth,
  designs: t.designsPerMonth, shootingDays: t.shootingDaysPerMonth, reports: t.reportsPerMonth, revisions: t.revisionLimit,
  durationDays: t.durationDays, ads: !!t.adsIncluded, active: !!t.isActive, custom: !!t.isCustom,
  description: t.description ? clip(t.description, 200) : undefined,
});

async function loadTariffs(ctx: ToolContext): Promise<any[]> {
  const list = await getOrThrow<any[]>(ctx, '/smm-tariffs');
  return Array.isArray(list) ? list : [];
}

async function pickTariff(ctx: ToolContext, spoken: unknown): Promise<any> {
  const s = String(spoken ?? '').trim();
  if (!s) throw new ToolError('Какой тариф? Назовите название.');
  const list = await loadTariffs(ctx);
  const byRef = ctx.refs.resolve('X', s);
  const hit = byRef ? list.find((t) => t.id === byRef.id) : undefined;
  if (hit) return hit;
  const scored = list.map((t) => ({ t, sc: nameScore(String(t.name || ''), s) })).filter((x) => x.sc >= 0.75).sort((a, b) => b.sc - a.sc);
  if (!scored.length) throw new ToolError(`Тариф «${s}» не нашла. Посмотрите список через smm_tariffs.`);
  const exact = scored.filter((x) => norm(x.t.name) === norm(s));
  if (exact.length === 1) return exact[0].t;
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    throw new ToolError(`Под «${s}» подходят: ${scored.slice(0, 5).map((x) => x.t.name).join(', ')}. Уточните через ask_choice.`);
  }
  return scored[0].t;
}

export const smmTariffs: ToolDef<Record<string, never>> = {
  name: 'smm_tariffs',
  kind: 'read',
  description:
    'Тарифы СММ-пакетов: цена в месяц и что входит (сторис, рилсы, посты, дизайны, дни съёмки, отчёты, правки), активен ли. '
    + '«Какие у нас тарифы», «сколько стоит Start», «что входит в Pro». Не про оплату клиента (client_payment).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, ctx) {
    return (await loadTariffs(ctx)).map((t) => compactTariff(ctx, t));
  },
};

interface TariffArgs {
  tariff?: string; name?: string; description?: string; monthly_price?: number; stories?: number; reels?: number; posts?: number;
  designs?: number; shooting_days?: number; reports?: number; revisions?: number; duration_days?: number; ads_included?: boolean;
}

const TARIFF_PROPS = {
  name: { type: 'string', description: 'Название тарифа.' },
  description: { type: 'string' },
  monthly_price: { type: 'number', description: 'Цена в месяц.' },
  stories: { type: 'number', description: 'Сторис в месяц.' },
  reels: { type: 'number', description: 'Рилсов в месяц.' },
  posts: { type: 'number', description: 'Постов в месяц.' },
  designs: { type: 'number', description: 'Дизайнов в месяц.' },
  shooting_days: { type: 'number', description: 'Дней съёмки в месяц.' },
  reports: { type: 'number', description: 'Отчётов в месяц.' },
  revisions: { type: 'number', description: 'Лимит правок.' },
  duration_days: { type: 'number', description: 'Срок тарифа, дней (от 1).' },
  ads_included: { type: 'boolean', description: 'Реклама входит.' },
};

function tariffBody(args: TariffArgs): Record<string, any> {
  const body: Record<string, any> = {};
  if (args.name !== undefined) {
    const n = clip(args.name, 200);
    if (!n) throw new ToolError('Название тарифа не может быть пустым.');
    body.name = n;
  }
  if (args.description !== undefined) body.description = clip(args.description, 2000);
  for (const [k, field] of Object.entries(TARIFF_NUM)) {
    const v = (args as any)[k];
    if (v === undefined) continue;
    const n = num(v);
    if (n === null || n < 0 || (field !== 'monthlyPrice' && !Number.isInteger(n)) || (field === 'durationDays' && n < 1)) {
      throw new ToolError(`Неверное значение «${TARIFF_LABEL[field]}»: ${v}.`);
    }
    body[field] = n;
  }
  if (args.ads_included !== undefined) body.adsIncluded = !!args.ads_included;
  return body;
}

const describeTariff = (b: Record<string, any>) =>
  Object.entries(b).filter(([k]) => k !== 'name' && k !== 'description')
    .map(([k, v]) => (k === 'adsIncluded' ? `реклама: ${v ? 'да' : 'нет'}` : `${TARIFF_LABEL[k]}: ${v}`)).join(', ');

export const tariffCreate: ToolDef<TariffArgs> = {
  name: 'tariff_create',
  kind: 'write',
  description: 'Создать новый тариф СММ: «создай тариф Pro за 5000, 30 сторис, 8 рилсов». Не для изменения существующего (tariff_update).',
  parameters: { type: 'object', properties: TARIFF_PROPS, required: ['name'], additionalProperties: false },
  available: grant('tariffs.manage'),
  confirm: () => true,
  async preview(args) {
    const body = tariffBody(args);
    if (!body.name) throw new ToolError('Как назвать тариф?');
    return `➕ СОЗДАТЬ ТАРИФ\n📦 ${esc(body.name)}\n${esc(describeTariff(body)) || 'без параметров'}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const body = tariffBody(args);
    if (!body.name) throw new ToolError('Как назвать тариф?');
    let created: any;
    try { created = await ctx.api.post('/smm-tariffs', body); } catch (e) { throw apiErr(e); }
    if (created?.id) ctx.refs.add('X', created.id, body.name);
    return {
      summary: `📦 Тариф «${body.name}» создан${describeTariff(body) ? ` (${describeTariff(body)})` : ''}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/smm-tariffs/${created.id}` }] : undefined,
    };
  },
};

export const tariffUpdate: ToolDef<TariffArgs> = {
  name: 'tariff_update',
  kind: 'write',
  description:
    'Изменить тариф СММ: цену, состав (сторис, рилсы, посты…), название. «Подними цену Start до 4000», «в Pro 10 рилсов». '
    + 'Меняется только названное. Включить/выключить — tariff_toggle.',
  parameters: { type: 'object', properties: { tariff: { type: 'string', description: 'Название или метка тарифа.' }, ...TARIFF_PROPS }, required: ['tariff'], additionalProperties: false },
  available: grant('tariffs.manage'),
  confirm: () => true,
  async preview(args, ctx) {
    const t = await pickTariff(ctx, args.tariff);
    const { tariff: _t, ...rest } = args;
    const body = tariffBody(rest);
    if (!Object.keys(body).length) throw new ToolError('Что изменить в тарифе?');
    return `✏️ ИЗМЕНИТЬ ТАРИФ\n📦 ${esc(t.name)}\n${esc(body.name ? `новое название: ${body.name}. ` : '')}${esc(describeTariff(body))}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const t = await pickTariff(ctx, args.tariff);
    const { tariff: _t, ...rest } = args;
    const body = tariffBody(rest);
    if (!Object.keys(body).length) throw new ToolError('Что изменить в тарифе?');
    const before: Record<string, any> = {};
    for (const k of Object.keys(body)) before[k] = k === 'monthlyPrice' ? num(t[k]) : t[k];
    try { await ctx.api.patch(`/smm-tariffs/${t.id}`, body); } catch (e) { throw apiErr(e); }
    return { summary: `✏️ Тариф «${t.name}» обновлён: ${body.name ? `название «${body.name}» ` : ''}${describeTariff(body)}`.trim(), undo: [{ method: 'PATCH', path: `/smm-tariffs/${t.id}`, body: before }] };
  },
};

export const tariffToggle: ToolDef<{ tariff: string; active: boolean }> = {
  name: 'tariff_toggle',
  kind: 'write',
  description: 'Включить или выключить тариф СММ (выключенный нельзя назначить новым проектам): «выключи тариф Start», «верни Pro в продажу».',
  parameters: {
    type: 'object',
    properties: { tariff: { type: 'string', description: 'Название или метка тарифа.' }, active: { type: 'boolean', description: 'true — включить, false — выключить.' } },
    required: ['tariff', 'active'],
    additionalProperties: false,
  },
  available: grant('tariffs.manage'),
  async run(args, ctx): Promise<WriteOutcome> {
    const t = await pickTariff(ctx, args.tariff);
    const want = !!args.active;
    if (!!t.isActive === want) return { summary: `Тариф «${t.name}» и так ${want ? 'включён' : 'выключен'}.` };
    try { await ctx.api.patch(`/smm-tariffs/${t.id}/toggle-active`); } catch (e) { throw apiErr(e); }
    return {
      summary: `${want ? '✅ Тариф включён' : '⏸ Тариф выключен'}: «${t.name}»`,
      undo: [{ method: 'PATCH', path: `/smm-tariffs/${t.id}/toggle-active` }],
    };
  },
};

export const tariffDelete: ToolDef<{ tariff: string }> = {
  name: 'tariff_delete',
  kind: 'write',
  description: 'УДАЛИТЬ тариф СММ насовсем: «удали тариф Тест». Чтобы просто убрать из продажи — tariff_toggle.',
  parameters: { type: 'object', properties: { tariff: { type: 'string', description: 'Название или метка тарифа.' } }, required: ['tariff'], additionalProperties: false },
  available: grant('tariffs.delete'),
  confirm: () => true,
  async preview(args, ctx) {
    const t = await pickTariff(ctx, args.tariff);
    if (t.isCustom) throw new ToolError('Тариф «Индивидуальный» удалять нельзя.');
    return `🗑 УДАЛИТЬ ТАРИФ\n📦 ${esc(t.name)}${t.monthlyPrice ? ` — ${esc(num(t.monthlyPrice))}` : ''}\nВернуть будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const t = await pickTariff(ctx, args.tariff);
    if (t.isCustom) throw new ToolError('Тариф «Индивидуальный» удалять нельзя.');
    try { await ctx.api.delete(`/smm-tariffs/${t.id}`); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 Тариф «${t.name}» удалён` };
  },
};

// ═══ Справочник организатора съёмок ═════════════════════════════════════

const KINDS = ['clients', 'models', 'places'] as const;
const KIND_RU: Record<string, string> = { clients: 'клиент', models: 'модель', places: 'место съёмки' };
const KIND_FIELDS: Record<string, Record<string, string>> = {
  clients: { name: 'name', company: 'company', phone: 'phone', instagram: 'instagram', telegram: 'telegram', address: 'address', note: 'note' },
  models: { name: 'name', gender: 'gender', phone: 'phone', instagram: 'instagram', age: 'age', appearance: 'appearance', experience: 'experience', languages: 'languages', rate: 'rate', video_link: 'videoLink' },
  places: { name: 'name', address: 'address', contact: 'contact', price: 'price', link: 'link', note: 'note' },
};

const kindOf = (v: unknown): (typeof KINDS)[number] => {
  const k = String(v ?? '') as (typeof KINDS)[number];
  if (!KINDS.includes(k)) throw new ToolError('Какой справочник: clients (клиенты), models (модели) или places (места)?');
  return k;
};

export const organizerDirectory: ToolDef<{ kind: string; search?: string }> = {
  name: 'organizer_directory',
  kind: 'read',
  description:
    'Справочник организатора съёмок: kind = clients (клиенты для съёмок), models (модели: контакты, ставка, языки), places (места съёмок: адрес, цена). '
    + '«Какие у нас модели», «телефон места на Рудаки», «ставка модели Мадины». Не обычные клиенты CRM (find_clients).',
  parameters: {
    type: 'object',
    properties: { kind: { type: 'string', enum: [...KINDS] }, search: { type: 'string', description: 'Часть имени/названия.' } },
    required: ['kind'],
    additionalProperties: false,
  },
  available: grant('organizer.directory'),
  async run(args, ctx) {
    const kind = kindOf(args.kind);
    const search = clip(args.search, 80);
    let list = await getOrThrow<any[]>(ctx, `/organizer-directory/${kind}`, search ? { search } : undefined);
    if (!Array.isArray(list)) list = [];
    return {
      total: list.length,
      items: list.slice(0, 40).map((r) => {
        const out: Record<string, any> = { ref: ctx.refs.add('X', r.id, String(r.name || '')) };
        for (const f of Object.values(KIND_FIELDS[kind])) if (r[f] !== null && r[f] !== undefined && r[f] !== '') out[f] = r[f];
        if (kind === 'models' && r.photo) out.hasPhoto = true;
        return out;
      }),
    };
  },
};

type OrgArgs = { kind: string; record?: string; [k: string]: any };

function orgBody(kind: (typeof KINDS)[number], args: OrgArgs): Record<string, any> {
  const body: Record<string, any> = {};
  for (const [arg, field] of Object.entries(KIND_FIELDS[kind])) {
    const v = args[arg];
    if (v === undefined) continue;
    if (field === 'price') {
      const n = num(v);
      if (n === null || n < 0) throw new ToolError(`Неверная цена: ${v}.`);
      body[field] = n;
    } else if (field === 'gender') {
      if (v !== 'female' && v !== 'male') throw new ToolError('Пол: female или male.');
      body[field] = v;
    } else body[field] = clip(v, field === 'videoLink' ? 500 : 300);
  }
  return body;
}

const ORG_PROPS = {
  kind: { type: 'string', enum: [...KINDS] },
  record: { type: 'string', description: 'Метка записи из organizer_directory (для изменения).' },
  name: { type: 'string' }, company: { type: 'string', description: 'Клиент: компания.' }, phone: { type: 'string' },
  instagram: { type: 'string' }, telegram: { type: 'string', description: 'Клиент: Telegram.' },
  address: { type: 'string' }, note: { type: 'string' },
  gender: { type: 'string', enum: ['female', 'male'], description: 'Модель.' }, age: { type: 'string', description: 'Модель.' },
  appearance: { type: 'string', description: 'Модель: внешность.' }, experience: { type: 'string', description: 'Модель: опыт.' },
  languages: { type: 'string', description: 'Модель: языки.' }, rate: { type: 'string', description: 'Модель: ставка, можно «400-600».' },
  video_link: { type: 'string', description: 'Модель: ссылка на видео.' },
  contact: { type: 'string', description: 'Место: контактное лицо.' }, price: { type: 'number', description: 'Место: цена.' },
  link: { type: 'string', description: 'Место: ссылка.' },
};

export const organizerSave: ToolDef<OrgArgs> = {
  name: 'organizer_save',
  kind: 'write',
  description:
    'Добавить или изменить запись справочника организатора съёмок: клиента, модель или место. Без record — новая запись, с record — меняются только названные поля. '
    + '«Добавь модель Мадину, ставка 500, знает русский и таджикский», «у места на Рудаки новая цена 800». Фото модели голосом не загружаю.',
  parameters: { type: 'object', properties: ORG_PROPS, required: ['kind'], additionalProperties: false },
  available: grant('organizer.directory'),
  confirm: () => true,
  async preview(args, ctx) {
    const kind = kindOf(args.kind);
    const body = orgBody(kind, args);
    if (args.record) {
      if (!ctx.refs.resolve('X', args.record)) throw new ToolError('Не знаю такую запись. Найдите её через organizer_directory.');
      if (!Object.keys(body).length) throw new ToolError('Что изменить в записи?');
    } else if (!body.name) throw new ToolError('Как назвать новую запись?');
    const lines = Object.entries(body).map(([k, v]) => `• ${esc(k)}: ${esc(v)}`).join('\n');
    return `${args.record ? '✏️ ИЗМЕНИТЬ ЗАПИСЬ' : '➕ ДОБАВИТЬ ЗАПИСЬ'} (${KIND_RU[kind]})\n${lines}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const kind = kindOf(args.kind);
    const body = orgBody(kind, args);
    if (!args.record) {
      if (!body.name) throw new ToolError('Как назвать новую запись?');
      let created: any;
      try { created = await ctx.api.post(`/organizer-directory/${kind}`, body); } catch (e) { throw apiErr(e); }
      if (created?.id) ctx.refs.add('X', created.id, body.name);
      return {
        summary: `➕ В справочнике (${KIND_RU[kind]}): ${body.name}`,
        undo: created?.id ? [{ method: 'DELETE', path: `/organizer-directory/${kind}/${created.id}` }] : undefined,
      };
    }
    const ref = ctx.refs.resolve('X', args.record);
    if (!ref) throw new ToolError('Не знаю такую запись. Найдите её через organizer_directory.');
    if (!Object.keys(body).length) throw new ToolError('Что изменить в записи?');
    const list = await getOrThrow<any[]>(ctx, `/organizer-directory/${kind}`);
    const current = (list || []).find((r) => r.id === ref.id);
    if (!current) throw new ToolError(`Запись «${ref.label}» не нашла в справочнике «${KIND_RU[kind]}». Проверьте раздел.`);
    const before: Record<string, any> = {};
    for (const k of Object.keys(body)) before[k] = current[k] ?? null;
    try { await ctx.api.patch(`/organizer-directory/${kind}/${ref.id}`, body); } catch (e) { throw apiErr(e); }
    return {
      summary: `✏️ ${current.name}: обновлено (${Object.keys(body).join(', ')})`,
      undo: [{ method: 'PATCH', path: `/organizer-directory/${kind}/${ref.id}`, body: before }],
    };
  },
};

export const organizerDelete: ToolDef<{ kind: string; record: string }> = {
  name: 'organizer_delete',
  kind: 'write',
  description: 'Удалить запись из справочника организатора (клиента, модель или место): «удали модель Мадину из справочника». Метка из organizer_directory.',
  parameters: {
    type: 'object',
    properties: { kind: { type: 'string', enum: [...KINDS] }, record: { type: 'string', description: 'Метка записи.' } },
    required: ['kind', 'record'],
    additionalProperties: false,
  },
  available: grant('organizer.directory'),
  confirm: () => true,
  async preview(args, ctx) {
    const kind = kindOf(args.kind);
    const ref = ctx.refs.resolve('X', args.record);
    if (!ref) throw new ToolError('Не знаю такую запись. Найдите её через organizer_directory.');
    return `🗑 УДАЛИТЬ ИЗ СПРАВОЧНИКА (${KIND_RU[kind]})\n📝 ${esc(ref.label)}\nВернуть будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const kind = kindOf(args.kind);
    const ref = ctx.refs.resolve('X', args.record);
    if (!ref) throw new ToolError('Не знаю такую запись. Найдите её через organizer_directory.');
    try { await ctx.api.delete(`/organizer-directory/${kind}/${ref.id}`); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 «${ref.label}» удалена из справочника (${KIND_RU[kind]})` };
  },
};

// ═══ План продаж ════════════════════════════════════════════════════════

export const salesPlans: ToolDef<{ month?: string }> = {
  name: 'sales_plans',
  kind: 'read',
  description:
    'План продаж менеджеров на месяц и сколько уже получено: основателю — по всем менеджерам, менеджеру продаж — свой план. '
    + '«Какой план у менеджеров», «выполнил ли я план продаж». Не про оплаты клиентов (unpaid_clients).',
  parameters: { type: 'object', properties: { month: { type: 'string', description: 'ГГГГ-ММ (только основателю).' } }, additionalProperties: false },
  available: (u) => hasRole(u, 'founder') || ['sales_manager_smm', 'sales_manager_dev'].includes(u.role),
  async run(args, ctx) {
    if (ctx.user.role === 'founder' || hasRole(ctx.user, 'founder')) {
      const res = await getOrThrow<any>(ctx, '/sales-plans', args.month ? { ym: checkYm(args.month) } : undefined);
      return {
        month: res.ym,
        managers: (res.managers || []).map((m: any) => ({
          ref: ctx.refs.add('E', m.id, String(m.name || '')), name: m.name, plan: m.plan ?? null, received: m.received ?? 0,
        })),
      };
    }
    return getOrThrow(ctx, '/me/sales-plan');
  },
};

export const salesPlanSet: ToolDef<{ manager: string; amount: number; month?: string }> = {
  name: 'sales_plan_set',
  kind: 'write',
  description:
    'Поставить менеджеру продаж план на месяц (только основатель): «поставь Бахтиёру план 50000», 0 — снять план. Месяц по умолчанию текущий. '
    + 'Не цель сотрудника (goal_set) и не оплата клиента.',
  parameters: {
    type: 'object',
    properties: {
      manager: { type: 'string', description: 'Метка E… или имя менеджера продаж.' },
      amount: { type: 'number', description: 'Сумма плана; 0 — снять.' },
      month: { type: 'string', description: 'ГГГГ-ММ.' },
    },
    required: ['manager', 'amount'],
    additionalProperties: false,
  },
  available: (u) => u.role === 'founder' || u.secondaryRole === 'founder',
  confirm: () => true,
  async preview(args, ctx) {
    const { m, ym, amount } = await resolvePlan(args, ctx);
    return `💼 ПЛАН ПРОДАЖ\n👤 ${esc(m.name)}\n📅 ${esc(ym)}\n💰 ${amount ? esc(amount) : 'снять план'}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { m, ym, amount, previous } = await resolvePlan(args, ctx);
    try { await ctx.api.request('PUT', `/sales-plans/${m.id}`, { ym, amount }); } catch (e) { throw apiErr(e); }
    return {
      summary: amount ? `💼 План ${m.name} на ${ym}: ${amount}` : `💼 План ${m.name} на ${ym} снят`,
      undo: [{ method: 'PUT' as UndoStep['method'], path: `/sales-plans/${m.id}`, body: { ym, amount: previous ?? 0 } }],
    };
  },
};

async function resolvePlan(args: { manager: string; amount: number; month?: string }, ctx: ToolContext) {
  const amount = num(args.amount);
  if (amount === null || amount < 0) throw new ToolError('Сумма плана — число от 0.');
  const ym = args.month ? checkYm(args.month) : ctx.today.slice(0, 7);
  const res = await getOrThrow<any>(ctx, '/sales-plans', { ym });
  const people: any[] = res.managers || [];
  const s = String(args.manager ?? '').trim();
  const byRef = ctx.refs.resolve('E', s);
  let m = byRef ? people.find((p) => p.id === byRef.id) : undefined;
  if (!m) {
    const scored = people.map((p) => ({ p, sc: nameScore(String(p.name || ''), s) })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
    if (!scored.length) throw new ToolError(`Менеджера продаж «${s}» не нашла. План ставят только менеджерам продаж.`);
    if (scored.length > 1 && scored[0].sc === scored[1].sc) {
      throw new ToolError(`Под «${s}» подходят: ${scored.slice(0, 5).map((x) => x.p.name).join(', ')}. Уточните через ask_choice.`);
    }
    m = scored[0].p;
  }
  return { m, ym, amount, previous: num(m.plan) };
}

// ═══ Спринты и KPI доски разработки ═════════════════════════════════════

export const devSprints: ToolDef<Record<string, never>> = {
  name: 'dev_sprints',
  kind: 'read',
  description: 'Спринты доски разработки: название, цель, даты, статус. «Какие спринты», «когда кончается текущий спринт». Карточки доски — find_dev_cards.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: grant('dev-tracker.view'),
  async run(_args, ctx) {
    const list = await getOrThrow<any[]>(ctx, '/dev-tracker/sprints');
    return (Array.isArray(list) ? list : []).map((s) => ({
      ref: ctx.refs.add('X', s.id, String(s.name || '')), name: s.name, goal: s.goal || undefined, status: s.status,
      from: splitDushanbe(s.startDate)?.date ?? s.startDate, to: splitDushanbe(s.endDate)?.date ?? s.endDate,
    }));
  },
};

export const devKpi: ToolDef<Record<string, never>> = {
  name: 'dev_kpi',
  kind: 'read',
  description: 'KPI доски разработки: сколько карточек сделано, скорость, просрочка. «Как дела у разработки по KPI». Не KPI сотрудника (employee_kpi).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: grant('dev-tracker.view'),
  async run(_args, ctx) {
    return trim(await getOrThrow(ctx, '/dev-tracker/kpi'));
  },
};

export const sprintCreate: ToolDef<{ name: string; start: string; end: string; goal?: string }> = {
  name: 'sprint_create',
  kind: 'write',
  description: 'Создать спринт доски разработки: «создай спринт Ноябрь-2 с 10 по 24 ноября, цель — релиз оплаты». Не карточка (create_dev_card).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' }, start: { type: 'string', description: 'ГГГГ-ММ-ДД' }, end: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      goal: { type: 'string', description: 'Цель — только если назвали.' },
    },
    required: ['name', 'start', 'end'],
    additionalProperties: false,
  },
  available: grant('dev-tracker.manage'),
  confirm: () => true,
  async preview(args) {
    const b = sprintBody(args);
    return `🏁 СОЗДАТЬ СПРИНТ\n📝 ${esc(b.name)}\n📅 ${fmtDateRu(b.startDate)} — ${fmtDateRu(b.endDate)}${b.goal ? `\n🎯 ${esc(b.goal)}` : ''}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const b = sprintBody(args);
    let created: any;
    try { created = await ctx.api.post('/dev-tracker/sprints', b); } catch (e) { throw apiErr(e); }
    if (created?.id) ctx.refs.add('X', created.id, b.name);
    return { summary: `🏁 Спринт «${b.name}»: ${fmtDateRu(b.startDate)} — ${fmtDateRu(b.endDate)}` };
  },
};

function sprintBody(args: { name: string; start: string; end: string; goal?: string }) {
  const name = clip(args.name, 120);
  if (!name) throw new ToolError('Как назвать спринт?');
  const startDate = checkDate(args.start, 'дата начала');
  const endDate = checkDate(args.end, 'дата конца');
  if (endDate < startDate) throw new ToolError('Конец спринта раньше начала.');
  const goal = clip(args.goal, 2000);
  return { name, startDate, endDate, ...(goal ? { goal } : {}) };
}

export const sprintComplete: ToolDef<{ sprint: string; move_to?: string }> = {
  name: 'sprint_complete',
  kind: 'write',
  description:
    'Завершить спринт: незакрытые карточки уходят в backlog (по умолчанию) или в другой спринт. «Заверши спринт Ноябрь-1». '
    + 'Метка спринта из dev_sprints.',
  parameters: {
    type: 'object',
    properties: {
      sprint: { type: 'string', description: 'Метка спринта из dev_sprints.' },
      move_to: { type: 'string', description: 'Метка спринта-приёмника; без неё — в backlog.' },
    },
    required: ['sprint'],
    additionalProperties: false,
  },
  available: grant('dev-tracker.manage'),
  confirm: () => true,
  async preview(args, ctx) {
    const s = ctx.refs.resolve('X', args.sprint);
    if (!s) throw new ToolError('Не знаю такой спринт. Посмотрите список через dev_sprints.');
    const to = args.move_to ? ctx.refs.resolve('X', args.move_to) : null;
    if (args.move_to && !to) throw new ToolError('Не знаю спринт-приёмник. Посмотрите список через dev_sprints.');
    return `🏁 ЗАВЕРШИТЬ СПРИНТ\n📝 ${esc(s.label)}\nНезакрытые карточки: ${to ? `в «${esc(to.label)}»` : 'в backlog'}.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const s = ctx.refs.resolve('X', args.sprint);
    if (!s) throw new ToolError('Не знаю такой спринт. Посмотрите список через dev_sprints.');
    const to = args.move_to ? ctx.refs.resolve('X', args.move_to) : null;
    if (args.move_to && !to) throw new ToolError('Не знаю спринт-приёмник. Посмотрите список через dev_sprints.');
    try { await ctx.api.post(`/dev-tracker/sprints/${s.id}/complete`, { moveTo: to ? to.id : 'backlog' }); } catch (e) { throw apiErr(e); }
    return { summary: `🏁 Спринт «${s.label}» завершён, незакрытое — ${to ? `в «${to.label}»` : 'в backlog'}` };
  },
};

// ═══ Повтор недели задач, флаги сотрудников, архив историй, результаты ═══

function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export const repeatWeekTasks: ToolDef<{ week_start?: string }> = {
  name: 'repeat_week_tasks',
  kind: 'write',
  description:
    'Кнопка «Повторить прошлую неделю» в «Задачах недели»: КОПИРУЕТ все задачи предыдущей недели на указанную (по умолчанию — текущую), '
    + 'кроме отменённых. «Повтори задачи прошлой недели». Массовое действие, всегда с подтверждением. Не для одной задачи (create_task).',
  parameters: {
    type: 'object',
    properties: { week_start: { type: 'string', description: 'Дата в целевой неделе, ГГГГ-ММ-ДД; по умолчанию сегодня.' } },
    additionalProperties: false,
  },
  available: grant('tasks.bulk'),
  confirm: () => true,
  async preview(args, ctx) {
    const monday = mondayOf(args.week_start ? checkDate(args.week_start, 'дата недели') : ctx.today);
    return `🔁 ПОВТОРИТЬ ПРОШЛУЮ НЕДЕЛЮ\nЗадачи недели до ${fmtDateRu(monday)} скопируются на неделю с ${fmtDateRu(monday)} у ВСЕХ исполнителей. Сразу отменить нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const monday = mondayOf(args.week_start ? checkDate(args.week_start, 'дата недели') : ctx.today);
    let res: any;
    try { res = await ctx.api.post('/tasks/repeat-week', { weekStart: monday }); } catch (e) { throw apiErr(e); }
    return { summary: `🔁 Неделя с ${fmtDateRu(res?.week || monday)}: создано задач ${res?.created ?? 0}, пропущено ${res?.skipped ?? 0}` };
  },
};

type FlagKey = 'isStoryMaker' | 'isSubAdmin';

function flagTool(
  name: string, flag: FlagKey, path: string, title: string, description: string,
  textOn: string, textOff: string,
): ToolDef<{ employee: string; enabled: boolean }> {
  return {
    name,
    kind: 'write',
    description,
    parameters: {
      type: 'object',
      properties: { employee: EMP_PROP, enabled: { type: 'boolean', description: 'true — включить, false — выключить.' } },
      required: ['employee', 'enabled'],
      additionalProperties: false,
    },
    available: isTop,
    confirm: () => true,
    async preview(args, ctx) {
      const emp = await pickEmployee(ctx, args.employee);
      return `👤 ${title}\n${esc(emp.fullName)}: ${args.enabled ? textOn : textOff}`;
    },
    async run(args, ctx): Promise<WriteOutcome> {
      const emp = await pickEmployee(ctx, args.employee);
      const want = !!args.enabled;
      if (!!emp[flag] === want) return { summary: `У «${emp.fullName}» уже ${want ? textOn : textOff}.` };
      try { await ctx.api.patch(`/employees/${emp.id}/${path}`); } catch (e) { throw apiErr(e); }
      return {
        summary: `👤 ${emp.fullName}: ${want ? textOn : textOff}`,
        undo: [{ method: 'PATCH', path: `/employees/${emp.id}/${path}` }],
      };
    },
  };
}

export const setStoryMaker = flagTool(
  'set_story_maker', 'isStoryMaker', 'toggle-story-maker', 'СТОРИСМЕЙКЕР',
  'Дать или забрать у сотрудника статус «сторисмейкер» (видит истории всех СММ-проектов). «Сделай Фирузу сторисмейкером», «убери у Али сторисмейкера». Только основатель и админ.',
  'сторисмейкер включён', 'сторисмейкер выключен',
);

export const setSubAdmin = flagTool(
  'set_sub_admin', 'isSubAdmin', 'toggle-sub-admin', 'СУБ-АДМИН',
  'Дать или забрать у сотрудника отметку «суб-админ». «Сделай Али суб-админом». Не блокировка и не доступы к разделам (set_employee_access). Только основатель и админ.',
  'суб-админ включён', 'суб-админ выключен',
);

export const setStoriesArchive: ToolDef<{ project: string; archived: boolean }> = {
  name: 'set_stories_archive',
  kind: 'write',
  description:
    'Скрыть проект из кабинета сторисмейкера (архив историй) или вернуть: «убери проект из историй», «верни Архидею в сторис». '
    + 'Это НЕ архив самого проекта (archive_project). Метка P из list_projects.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка P… проекта.' }, archived: { type: 'boolean', description: 'true — скрыть, false — вернуть.' } },
    required: ['project', 'archived'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, 'admin', 'founder', 'smm_director', 'smm_specialist'),
  async run(args, ctx): Promise<WriteOutcome> {
    const p = ctx.refs.resolve('P', args.project);
    if (!p) throw new ToolError('Не знаю такой проект. Найдите его через list_projects.');
    const archived = !!args.archived;
    try { await ctx.api.patch(`/projects/${p.id}/stories-archive`, { archived }); } catch (e) { throw apiErr(e); }
    return {
      summary: archived ? `🗄 «${p.label}» скрыт из историй` : `📖 «${p.label}» возвращён в истории`,
      undo: [{ method: 'PATCH', path: `/projects/${p.id}/stories-archive`, body: { archived: !archived } }],
    };
  },
};

export const taskResults: ToolDef<{ task: string }> = {
  name: 'task_results',
  kind: 'read',
  description: 'Результаты, приложенные к задаче (ссылки, файлы, комментарии-сдача): «что сдали по задаче». Метка T из find_tasks. Файлы голосом не скачиваю — только имена.',
  parameters: { type: 'object', properties: { task: { type: 'string', description: 'Метка T…' } }, required: ['task'], additionalProperties: false },
  async run(args, ctx) {
    const t = ctx.refs.resolve('T', args.task);
    if (!t) throw new ToolError('Не знаю такую задачу. Найдите её через find_tasks.');
    const list = await getOrThrow<any[]>(ctx, `/tasks/${t.id}/results`);
    return (Array.isArray(list) ? list : []).map((r) => ({
      ref: ctx.refs.add('X', r.id, `результат «${clip(r.content || r.fileName, 40)}»`),
      type: r.type, content: r.type === 'file' || r.type === 'media' ? undefined : clip(r.content, 300), file: r.fileName || undefined,
    }));
  },
};

export const taskResultAdd: ToolDef<{ task: string; link?: string; text?: string }> = {
  name: 'task_result_add',
  kind: 'write',
  description:
    'Приложить к задаче результат-ссылку (link) или текст сдачи (text): «приложи к задаче ссылку на папку с видео». '
    + 'Файлы и фото голосом не загружаю. Метка T из find_tasks. Не комментарий (comment_task).',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string', description: 'Метка T…' }, link: { type: 'string', description: 'Ссылка http(s)://…' }, text: { type: 'string', description: 'Текст результата.' } },
    required: ['task'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const t = ctx.refs.resolve('T', args.task);
    if (!t) throw new ToolError('Не знаю такую задачу. Найдите её через find_tasks.');
    const link = clip(args.link, 1000);
    const text = clip(args.text, 4000);
    if (!link && !text) throw new ToolError('Что приложить: ссылку или текст?');
    if (link && !/^https?:\/\/\S+\.\S+/i.test(link)) throw new ToolError('Ссылка должна начинаться с http:// или https://.');
    let created: any;
    try { created = await ctx.api.post(`/tasks/${t.id}/results`, link ? { type: 'link', content: link } : { type: 'comment', content: text }); } catch (e) { throw apiErr(e); }
    return {
      summary: `📎 К задаче «${t.label}» приложено: ${link || clip(text, 60)}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/tasks/${t.id}/results/${created.id}` }] : undefined,
    };
  },
};

export const MISC_TOOLS: ToolDef[] = [
  mySalary, myProfileStats, employeeGoals, goalSet, goalDone, goalDelete,
  employeeKpi, analyticsReport, riskReport, activityFeed, taskOverview, clientsOverview,
  clientCallRequest,
  smmTariffs, tariffCreate, tariffUpdate, tariffToggle, tariffDelete,
  organizerDirectory, organizerSave, organizerDelete,
  salesPlans, salesPlanSet,
  devSprints, devKpi, sprintCreate, sprintComplete,
  repeatWeekTasks, setStoryMaker, setSubAdmin, setStoriesArchive,
  taskResults, taskResultAdd,
];
