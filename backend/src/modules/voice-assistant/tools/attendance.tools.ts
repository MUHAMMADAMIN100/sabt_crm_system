import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { checkDate, checkTime, esc, fmtDateRu, nameScore, roles } from './common';
import { ensureEmployee } from './people.tools';
import { ToolContext, ToolDef, ToolError, UndoStep, WriteOutcome } from './types';

/**
 * Опоздания, «приду позже», правки времени, графики, отпуска и табель —
 * страница «Активность команды» (вкладки «Смены сегодня», «График работы»,
 * «Табель месяца») и карточка сотрудника (отпуск). Всё идёт через те же
 * эндпоинты, что и сайт:
 *  • штрафы за опоздание — /finance/late-fines (только finance.manage);
 *  • просьбы и правки, отгулы, графики, табель — /work-shifts/* (admin / founder,
 *    общий график и авто-штраф — только founder);
 *  • отпуск — PATCH /employees/:id (грант employees.edit + роль admin/founder),
 *    решение «Удержать / Не удерживать» — /finance/employees/:id/vacation-hint.
 */

const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ymRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const ABSENCE_RU: Record<string, string> = { dayoff: 'отгул', vacation: 'отпуск', sick: 'больничный', holiday: 'праздник' };

const isTop = (u: any) => roles(u).some((r) => r === 'admin' || r === 'founder');
const isFounder = (u: any) => roles(u).includes('founder');
const financeManage = (u: any) => hasGrant(u, 'finance.manage');
/** Отпуск ставит руководство с правом править карточки (сервер смотрит основную роль). */
const canVacation = (u: any) => hasGrant(u, 'employees.edit') && (u.role === 'admin' || u.role === 'founder');

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const money = (n: unknown) => `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом.`;
const hm = (min: number) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
};
const day10 = (v: unknown) => String(v ?? '').slice(0, 10);

function checkYm(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ToolError(`Неверный месяц «${s}». Нужен формат ГГГГ-ММ.`);
  return s;
}

function pickByName<T extends { name: string }>(spoken: string, pool: T[], what: string): T {
  const scored = pool
    .map((x) => ({ x, sc: Math.max(nameScore(x.name, spoken), nameScore(spoken, x.name)) }))
    .filter((r) => r.sc >= 0.5)
    .sort((a, b) => b.sc - a.sc);
  if (!scored.length) {
    throw new ToolError(`${what}: «${spoken}» не нашёл. Есть: ${pool.map((p) => p.name).join(', ') || 'никого'}.`);
  }
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    throw new ToolError(`Под «${spoken}» подходят: ${scored.filter((r) => r.sc === scored[0].sc).map((r) => r.x.name).join(', ')}. Уточните через ask_choice.`);
  }
  return scored[0].x;
}

// ─── Опоздания и штрафы за опоздание ───────────────────────────────────

interface LateItem {
  userId: string; name: string; arrivedAt: string; startsAt: string; lateMinutes: number;
  linked: boolean; decision: 'fined' | 'forgiven' | null; amount: number;
}
interface LateView { date: string; pending: LateItem[]; fined: LateItem[]; forgiven: LateItem[] }

async function loadLate(ctx: ToolContext, dateArg?: string): Promise<LateView> {
  const date = dateArg ? checkDate(dateArg) : ctx.today;
  let res: any;
  try { res = await ctx.api.get('/finance/late-fines', { date }); } catch (e) { throw apiErr(e); }
  const norm_ = (l: any): LateItem[] => (Array.isArray(l) ? l : []).map((i) => ({
    userId: i.userId, name: String(i.name || ''), arrivedAt: i.arrivedAt, startsAt: i.startsAt,
    lateMinutes: Number(i.lateMinutes) || 0, linked: !!i.linked, decision: i.decision ?? null, amount: Number(i.amount) || 0,
  }));
  return { date: res?.date || date, pending: norm_(res?.pending), fined: norm_(res?.fined), forgiven: norm_(res?.forgiven) };
}

/** Человек из списка опоздавших: по метке E… или по имени. */
function pickLate(ctx: ToolContext, spoken: unknown, pool: LateItem[], poolName: string): LateItem {
  const s = String(spoken ?? '').trim();
  if (!s) throw new ToolError('Кого? Назовите сотрудника.');
  const ref = ctx.refs.resolve('E', s);
  if (ref) {
    const hit = pool.find((p) => p.userId === ref.id);
    if (hit) return hit;
    throw new ToolError(`${ref.label} нет в списке «${poolName}» за этот день.`);
  }
  return pickByName(s, pool, `В списке «${poolName}» за этот день`);
}

function lateLine(i: LateItem) {
  return `${i.name} — пришёл в ${i.arrivedAt} (смена с ${i.startsAt}, +${i.lateMinutes} мин)`;
}

export const lateArrivals: ToolDef<{ date?: string }> = {
  name: 'late_arrivals',
  kind: 'read',
  description:
    'Опоздания за день с решениями: кто опоздал и ещё не разобран (pending), кого уже оштрафовали (fined), кого простили (forgiven). '
    + '«Кто опоздал сегодня», «кто опоздал вчера», «кого оштрафовали за опоздание». Считает система по графику; '
    + 'тех, кто предупредил заранее или в отгуле, в списке нет. Только основатель/кто с доступом к финансам.',
  parameters: {
    type: 'object',
    properties: { date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' } },
    additionalProperties: false,
  },
  available: financeManage,
  async run(args, ctx) {
    const v = await loadLate(ctx, args.date);
    const view = (i: LateItem) => ({
      ref: ctx.refs.add('E', i.userId, i.name), name: i.name, arrivedAt: i.arrivedAt, startsAt: i.startsAt,
      lateMinutes: i.lateMinutes, ...(i.decision === 'fined' ? { fine: money(i.amount) } : {}),
      ...(!i.linked ? { noPayrollRow: true } : {}),
    });
    return {
      date: v.date,
      defaultFine: money(100),
      pending: v.pending.map(view),
      fined: v.fined.map(view),
      forgiven: v.forgiven.map(view),
    };
  },
};

interface LateFineArgs { employees?: string[]; all?: boolean; date?: string; amount?: number }

async function prepareFine(args: LateFineArgs, ctx: ToolContext) {
  const view = await loadLate(ctx, args.date);
  const amount = args.amount === undefined || args.amount === null ? 100 : Math.round(Number(args.amount) * 100) / 100;
  if (!(amount > 0) || amount > 1_000_000) throw new ToolError('Сумма штрафа должна быть больше нуля.');
  const names = (Array.isArray(args.employees) ? args.employees : []).filter((x) => String(x ?? '').trim());
  if (!args.all && !names.length) throw new ToolError('Кого штрафовать? Назовите сотрудников или скажите «всех опоздавших».');
  if (!view.pending.length) {
    throw new ToolError(`За ${fmtDateRu(view.date)} неразобранных опозданий нет${view.fined.length ? ' (все уже оштрафованы)' : ''}.`);
  }
  let targets: LateItem[];
  if (args.all) {
    targets = view.pending;
  } else {
    targets = [];
    for (const n of names) {
      const ref = ctx.refs.resolve('E', n);
      const same = (p: LateItem) => (ref ? p.userId === ref.id : Math.max(nameScore(p.name, String(n)), nameScore(String(n), p.name)) >= 0.5);
      if (!view.pending.some(same)) {
        const decided = [...view.fined, ...view.forgiven].find(same);
        if (decided) throw new ToolError(`${decided.name}: по опозданию за ${fmtDateRu(view.date)} уже принято решение (${decided.decision === 'fined' ? 'оштрафован' : 'прощён'}).`);
        throw new ToolError(`«${n}» не опаздывал(а) ${fmtDateRu(view.date)} (или предупредил(а) заранее / был(а) в отгуле). Опоздали: ${view.pending.map((p) => p.name).join(', ')}.`);
      }
      const inPending = pickLate(ctx, n, view.pending, 'неразобранные опоздания');
      if (!targets.some((t) => t.userId === inPending.userId)) targets.push(inPending);
    }
  }
  const unlinked = targets.filter((t) => !t.linked);
  if (unlinked.length) {
    throw new ToolError(`${unlinked.map((u) => u.name).join(', ')}: нет строки в зарплатной ведомости — штраф провести некуда. Свяжите сотрудника на сайте.`);
  }
  return { view, amount, targets };
}

export const lateFine: ToolDef<LateFineArgs> = {
  name: 'late_fine',
  kind: 'write',
  description:
    'ШТРАФ ЗА ОПОЗДАНИЕ — как кнопка «Провести штраф» на вкладке «Смены сегодня»: «оштрафуй за опоздание Фируза», '
    + '«оштрафуй всех опоздавших». Только тех, кто есть в late_arrivals (pending). Сумма по умолчанию 100 сомони, как на сайте; '
    + 'другую — только если названа. Штраф идёт в зарплатную ведомость и сотрудник получает сообщение. '
    + 'НЕ для штрафа без опоздания (это salary_accrual kind=fine) и НЕ для расхода (record_operation).',
  parameters: {
    type: 'object',
    properties: {
      employees: { type: 'array', items: { type: 'string' }, description: 'Метки E… опоздавших (или имена).' },
      all: { type: 'boolean', description: 'true — оштрафовать ВСЕХ неразобранных опоздавших за день.' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      amount: { type: 'number', description: 'Сумма на каждого, сомони. Не называли — не указывай (будет 100).' },
    },
    additionalProperties: false,
  },
  available: financeManage,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareFine(args, ctx);
    return `⚠️ ШТРАФ ЗА ОПОЗДАНИЕ\n📅 ${fmtDateRu(p.view.date)}\n${p.targets.map((t) => `👤 ${lateLine(t)}`).join('\n')}\n`
      + `💵 ${money(p.amount)} каждому${p.targets.length > 1 ? `, итого ${money(p.amount * p.targets.length)}` : ''} — в зарплату за ${ymRu(p.view.date.slice(0, 7))}\n`
      + '✉️ Сотрудники получат сообщение в Telegram';
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareFine(args, ctx);
    let res: any;
    try {
      res = await ctx.api.post('/finance/late-fines', { date: p.view.date, amount: p.amount, userIds: p.targets.map((t) => t.userId) });
    } catch (e) { throw apiErr(e); }
    const created = Number(res?.created) || 0;
    if (created === 0) throw new ToolError('Штраф не проведён — решение по этим опозданиям уже принято. Обновите список.');
    const dm = fmtDateRu(p.view.date);
    return {
      summary: `⚠️ Штраф за опоздание ${dm}: ${p.targets.map((t) => t.name).join(', ')} — по ${money(p.amount)}${created < p.targets.length ? ` (проведён только ${created} из ${p.targets.length})` : ''} · сотрудникам отправлено сообщение`,
      undo: p.targets.map((t): UndoStep => ({ method: 'DELETE', path: `/finance/late-fines?date=${p.view.date}&userId=${encodeURIComponent(t.userId)}` })),
      notify: p.targets.map((t) => ({
        userId: t.userId,
        text: `<b>⚠️ Штраф за опоздание: ${esc(money(p.amount))}</b>\n📅 ${esc(dm)} · смена с ${esc(t.startsAt)}, вы отметились в ${esc(t.arrivedAt)}\nПредупреждать о позднем приходе нужно заранее — тогда штрафа нет.`,
      })),
      undoNotify: p.targets.map((t) => ({ userId: t.userId, text: `↩️ Штраф за опоздание ${esc(dm)} отменён.` })),
    };
  },
};

interface LateForgiveArgs { employees?: string[]; all?: boolean; date?: string }

async function prepareForgive(args: LateForgiveArgs, ctx: ToolContext) {
  const view = await loadLate(ctx, args.date);
  const names = (Array.isArray(args.employees) ? args.employees : []).filter((x) => String(x ?? '').trim());
  if (!args.all && !names.length) throw new ToolError('Кого простить? Назовите сотрудников или скажите «простить всем».');
  if (!view.pending.length) throw new ToolError(`За ${fmtDateRu(view.date)} неразобранных опозданий нет.`);
  const targets: LateItem[] = [];
  if (args.all) targets.push(...view.pending);
  else {
    for (const n of names) {
      const t = pickLate(ctx, n, view.pending, 'неразобранные опоздания');
      if (!targets.some((x) => x.userId === t.userId)) targets.push(t);
    }
  }
  return { view, targets };
}

export const lateForgive: ToolDef<LateForgiveArgs> = {
  name: 'late_forgive',
  kind: 'write',
  description:
    'ПРОСТИТЬ опоздание — как «Простить всем» на сайте, но можно выбрать людей: «прости опоздание Сабрине», «прости всех опоздавших». '
    + 'Штраф не начисляется, день по человеку считается разобранным. Только из late_arrivals (pending). '
    + 'Сотруднику сообщение не уходит (как на сайте). НЕ для отмены уже проведённого штрафа — это late_cancel.',
  parameters: {
    type: 'object',
    properties: {
      employees: { type: 'array', items: { type: 'string' }, description: 'Метки E… (или имена) опоздавших.' },
      all: { type: 'boolean', description: 'true — простить всех неразобранных за день.' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    additionalProperties: false,
  },
  available: financeManage,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareForgive(args, ctx);
    return `🕊 ПРОСТИТЬ ОПОЗДАНИЕ\n📅 ${fmtDateRu(p.view.date)}\n${p.targets.map((t) => `👤 ${lateLine(t)}`).join('\n')}\nШтраф не начислится`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareForgive(args, ctx);
    let res: any;
    try { res = await ctx.api.post('/finance/late-fines/forgive', { date: p.view.date, userIds: p.targets.map((t) => t.userId) }); } catch (e) { throw apiErr(e); }
    const n = Number(res?.forgiven) || 0;
    if (n === 0) throw new ToolError('Решение по этим опозданиям уже принято. Обновите список.');
    return {
      summary: `🕊 Прощено опоздание ${fmtDateRu(p.view.date)}: ${p.targets.map((t) => t.name).join(', ')}`,
      undo: p.targets.map((t): UndoStep => ({ method: 'DELETE', path: `/finance/late-fines?date=${p.view.date}&userId=${encodeURIComponent(t.userId)}` })),
    };
  },
};

export const lateCancel: ToolDef<{ employee: string; date?: string }> = {
  name: 'late_cancel',
  kind: 'write',
  description:
    'ОТМЕНИТЬ решение по опозданию: «отмени штраф за опоздание Фирузу», «верни опоздание Сабрины в список». Проведённый штраф '
    + 'убирается из зарплатной ведомости, человек снова в списке неразобранных. НЕ для штрафа без опоздания (его удаляют на сайте в ведомости).',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… или имя.' },
      date: { type: 'string', description: 'За какой день, ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    required: ['employee'],
    additionalProperties: false,
  },
  available: financeManage,
  confirm: () => true,
  async preview(args, ctx) {
    const { view, item } = await findDecided(args, ctx);
    return item.decision === 'fined'
      ? `↩️ ОТМЕНИТЬ ШТРАФ ЗА ОПОЗДАНИЕ\n📅 ${fmtDateRu(view.date)}\n👤 ${item.name} — штраф ${money(item.amount)} уберут из зарплаты\n✉️ Сотрудник получит сообщение`
      : `↩️ ВЕРНУТЬ ОПОЗДАНИЕ В СПИСОК\n📅 ${fmtDateRu(view.date)}\n👤 ${item.name} — прощение снимается`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { view, item } = await findDecided(args, ctx);
    try { await ctx.api.delete(`/finance/late-fines?date=${view.date}&userId=${encodeURIComponent(item.userId)}`); } catch (e) { throw apiErr(e); }
    const fined = item.decision === 'fined';
    const dm = fmtDateRu(view.date);
    return {
      summary: fined
        ? `↩️ Штраф за опоздание отменён: ${item.name}, ${dm} (${money(item.amount)}) · сотруднику отправлено сообщение`
        : `↩️ Прощение снято: ${item.name}, ${dm} — снова в списке неразобранных`,
      undo: [fined
        ? { method: 'POST', path: '/finance/late-fines', body: { date: view.date, amount: item.amount, userIds: [item.userId] } }
        : { method: 'POST', path: '/finance/late-fines/forgive', body: { date: view.date, userIds: [item.userId] } }],
      notify: fined ? [{ userId: item.userId, text: `↩️ Штраф за опоздание ${esc(dm)} (${esc(money(item.amount))}) отменён.` }] : undefined,
      undoNotify: fined
        ? [{ userId: item.userId, text: `<b>⚠️ Штраф за опоздание ${esc(dm)}: ${esc(money(item.amount))}</b> — отмена отменена, штраф снова действует.` }]
        : undefined,
    };
  },
};

async function findDecided(args: { employee: string; date?: string }, ctx: ToolContext) {
  const view = await loadLate(ctx, args.date);
  const pool = [...view.fined, ...view.forgiven];
  if (!pool.length) throw new ToolError(`За ${fmtDateRu(view.date)} решений по опозданиям нет.`);
  return { view, item: pickLate(ctx, args.employee, pool, 'оштрафованные и прощённые') };
}

// ─── «Приду позже» и правки времени смены ──────────────────────────────

interface NoticeRow { id: string; userId: string; name: string; date: string; plannedTime: string; startTime: string; reason: string | null; status: string }
interface EditRow { id: string; employeeId: string; name: string; date: string; field: 'start' | 'end'; requestedTime: string; currentTime: string | null; note: string | null }

async function loadRequests(ctx: ToolContext): Promise<{ notices: NoticeRow[]; edits: EditRow[] }> {
  let n: any; let e: any;
  try {
    [n, e] = await Promise.all([ctx.api.get('/work-shifts/notices'), ctx.api.get('/work-shifts/edits')]);
  } catch (err) { throw apiErr(err); }
  const notices: NoticeRow[] = (Array.isArray(n?.items) ? n.items : []).map((r: any) => ({
    id: r.id, userId: r.userId, name: String(r.name || ''), date: day10(r.date), plannedTime: r.plannedTime,
    startTime: r.startTime, reason: r.reason ?? null, status: r.status,
  }));
  const edits: EditRow[] = (Array.isArray(e?.items) ? e.items : []).map((r: any) => ({
    id: r.id, employeeId: r.employeeId, name: String(r.name || ''), date: day10(r.date), field: r.field,
    requestedTime: r.requestedTime, currentTime: r.currentTime ?? null, note: r.note ?? null,
  }));
  return { notices, edits };
}

const FIELD_RU = { start: 'начало смены', end: 'конец смены' } as const;

export const shiftRequestsPending: ToolDef<Record<string, never>> = {
  name: 'shift_requests_pending',
  kind: 'read',
  description:
    'Что ждёт решения руководства: просьбы «приду позже» (notices: status pending — ждут; approved — уже одобрены на будущее) '
    + 'и запросы «забыл отметить» на правку времени смены (edits). «Кто просится прийти позже», «есть ли заявки на правку времени». '
    + 'Метки L… нужны для shift_request_decide. Только админ и основатель.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: isTop,
  async run(_args, ctx) {
    const { notices, edits } = await loadRequests(ctx);
    return {
      notices: notices.map((r) => ({
        ref: ctx.refs.add('L', r.id, `${r.name} · приду позже ${fmtDateRu(r.date)}`),
        name: r.name, date: r.date, willCome: r.plannedTime, shiftStarts: r.startTime,
        ...(r.reason ? { reason: r.reason } : {}), status: r.status,
      })),
      edits: edits.map((r) => ({
        ref: ctx.refs.add('L', r.id, `${r.name} · правка ${FIELD_RU[r.field]} ${fmtDateRu(r.date)}`),
        name: r.name, date: r.date, field: FIELD_RU[r.field], was: r.currentTime, requested: r.requestedTime,
        ...(r.note ? { note: r.note } : {}),
      })),
    };
  },
};

async function findRequest(ctx: ToolContext, spoken: unknown) {
  const ref = ctx.refs.resolve('L', spoken);
  if (!ref) throw new ToolError(`Нет заявки с меткой «${spoken}». Сначала посмотрите shift_requests_pending.`);
  const { notices, edits } = await loadRequests(ctx);
  const notice = notices.find((r) => r.id === ref.id);
  if (notice) {
    if (notice.status !== 'pending') {
      throw new ToolError(`Просьба ${notice.name} на ${fmtDateRu(notice.date)} уже ${notice.status === 'approved' ? 'одобрена' : 'отклонена'}.`);
    }
    return { notice };
  }
  const edit = edits.find((r) => r.id === ref.id);
  if (edit) return { edit };
  throw new ToolError('Эта заявка уже обработана или удалена — обновите список (shift_requests_pending).');
}

export const shiftRequestDecide: ToolDef<{ request: string; approve: boolean }> = {
  name: 'shift_request_decide',
  kind: 'write',
  description:
    'ОДОБРИТЬ или ОТКЛОНИТЬ заявку сотрудника из shift_requests_pending: «приду позже» («одобри Фирузу прийти позже») '
    + 'или правку времени смены «забыл отметить» («отклони правку Сабрины»). approve=true — одобрить, false — отклонить. '
    + 'Одобренное «приду позже» снимает штраф за опоздание; одобренная правка меняет время в табеле. '
    + 'НЕ для самих просьб от сотрудника (shift_late_notice / shift_fix_time).',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'Метка L… заявки.' },
      approve: { type: 'boolean', description: 'true — одобрить, false — отклонить.' },
    },
    required: ['request', 'approve'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const r = await findRequest(ctx, args.request);
    const yes = args.approve === true;
    if (r.notice) {
      return `${yes ? '✅ ОДОБРИТЬ «ПРИДУ ПОЗЖЕ»' : '⛔️ ОТКЛОНИТЬ «ПРИДУ ПОЗЖЕ»'}\n👤 ${r.notice.name}\n📅 ${fmtDateRu(r.notice.date)} — придёт в ${r.notice.plannedTime} вместо ${r.notice.startTime}`
        + `${r.notice.reason ? `\n📝 ${r.notice.reason}` : ''}\n${yes ? 'Штраф за опоздание в этот день не начислится' : 'Смена начнётся как обычно'}\n✉️ Сотрудник получит ответ в Telegram`;
    }
    const e = r.edit!;
    return `${yes ? '✅ ОДОБРИТЬ ПРАВКУ ВРЕМЕНИ СМЕНЫ' : '⛔️ ОТКЛОНИТЬ ПРАВКУ ВРЕМЕНИ СМЕНЫ'}\n👤 ${e.name}\n📅 ${fmtDateRu(e.date)} — ${FIELD_RU[e.field]}: ${e.currentTime ?? '—'} → ${e.requestedTime}`
      + `${e.note ? `\n📝 ${e.note}` : ''}\n${yes ? 'Время в табеле изменится' : 'Время в табеле останется прежним'}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    if (typeof args.approve !== 'boolean') throw new ToolError('Одобрить или отклонить?');
    const r = await findRequest(ctx, args.request);
    const verb = args.approve ? 'одобрена' : 'отклонена';
    try {
      if (r.notice) await ctx.api.patch(`/work-shifts/notices/${r.notice.id}`, { approve: args.approve });
      else await ctx.api.patch(`/work-shifts/edits/${r.edit!.id}`, { approve: args.approve });
    } catch (e) { throw apiErr(e); }
    return {
      summary: r.notice
        ? `${args.approve ? '✅' : '⛔️'} Просьба «приду позже» ${verb}: ${r.notice.name}, ${fmtDateRu(r.notice.date)} · сотруднику отправлен ответ`
        : `${args.approve ? '✅' : '⛔️'} Правка времени ${verb}: ${r.edit!.name}, ${fmtDateRu(r.edit!.date)}, ${FIELD_RU[r.edit!.field]} ${r.edit!.requestedTime}`,
    };
  },
};

// ─── Снять отгул ───────────────────────────────────────────────────────

interface MonthItem {
  id: string; name: string; role: string; totalMinutes: number; workedDays: number; avgMinutes: number;
  normMinutes: number; diffMinutes: number; lateDays: number[]; autoDays: number[]; absences: Record<string, string>;
}
interface MonthView { ym: string; daysInMonth: number; items: MonthItem[] }

async function loadMonth(ctx: ToolContext, ym: string): Promise<MonthView> {
  let res: any;
  try { res = await ctx.api.get('/work-shifts/month', { ym }); } catch (e) { throw apiErr(e); }
  return {
    ym: res?.ym || ym,
    daysInMonth: Number(res?.daysInMonth) || 31,
    items: (Array.isArray(res?.items) ? res.items : []).map((i: any) => ({
      id: i.id, name: String(i.name || ''), role: i.role, totalMinutes: Number(i.totalMinutes) || 0,
      workedDays: Number(i.workedDays) || 0, avgMinutes: Number(i.avgMinutes) || 0, normMinutes: Number(i.normMinutes) || 0,
      diffMinutes: Number(i.diffMinutes) || 0, lateDays: Array.isArray(i.lateDays) ? i.lateDays : [],
      autoDays: Array.isArray(i.autoDays) ? i.autoDays : [], absences: i.absences || {},
    })),
  };
}

async function absenceOn(ctx: ToolContext, userId: string, date: string): Promise<string | null> {
  const m = await loadMonth(ctx, date.slice(0, 7));
  const me = m.items.find((i) => i.id === userId);
  return me?.absences[String(Number(date.slice(8, 10)))] ?? null;
}

export const absenceRemove: ToolDef<{ employee: string; date: string }> = {
  name: 'absence_remove',
  kind: 'write',
  description:
    'СНЯТЬ отметку отгула / отпуска-дня / больничного / праздника у сотрудника на дату: «сними отгул Фирузу на завтра», «Сабрина завтра работает». '
    + 'Без отметки день снова рабочий (будут опоздание и прогул). НЕ для отпуска целиком — это vacation_end.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка сотрудника E…' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
    },
    required: ['employee', 'date'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const { emp, date, kind } = await prepareAbsenceRemove(args, ctx);
    return `🗓 СНЯТЬ ${ABSENCE_RU[kind].toUpperCase()}\n👤 ${emp.label}\n📅 ${fmtDateRu(date)} станет обычным рабочим днём`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { emp, date, kind } = await prepareAbsenceRemove(args, ctx);
    try { await ctx.api.delete(`/work-shifts/absence?employeeId=${encodeURIComponent(emp.id)}&date=${date}`); } catch (e) { throw apiErr(e); }
    return {
      summary: `🗓 ${emp.label}: ${ABSENCE_RU[kind]} на ${fmtDateRu(date)} снят`,
      undo: [{ method: 'POST', path: '/work-shifts/absence', body: { employeeId: emp.id, date, kind } }],
    };
  },
};

async function prepareAbsenceRemove(args: { employee: string; date: string }, ctx: ToolContext) {
  const emp = ensureEmployee(ctx, args.employee);
  const date = checkDate(args.date);
  const kind = await absenceOn(ctx, emp.id, date);
  if (!kind) throw new ToolError(`У ${emp.label} на ${fmtDateRu(date)} нет отметки отгула или отпуска.`);
  return { emp, date, kind };
}

// ─── Графики работы и авто-штраф ───────────────────────────────────────

interface SchedBody { startTime: string; endTime: string; graceMinutes: number; workdays: string; floating: boolean; normMinutes: number }
interface SchedPerson extends SchedBody { id: string; name: string; custom: boolean; since: string | null }
interface SchedView {
  today: string;
  company: SchedBody & { validFrom: string | null; upcoming: any[] };
  settings: { autoFine: boolean; fineAmount: number; graceMinutes: number; runHour: number; noticeDaysBefore: number };
  items: SchedPerson[];
}

const pickSched = (s: any): SchedBody => ({
  startTime: s.startTime, endTime: s.endTime, graceMinutes: Number(s.graceMinutes), workdays: String(s.workdays),
  floating: !!s.floating, normMinutes: Number(s.normMinutes),
});

async function loadSchedules(ctx: ToolContext): Promise<SchedView> {
  let r: any;
  try { r = await ctx.api.get('/work-shifts/schedules'); } catch (e) { throw apiErr(e); }
  return {
    today: r?.today || ctx.today,
    company: { ...pickSched(r?.company || {}), validFrom: r?.company?.validFrom ?? null, upcoming: r?.company?.upcoming || [] },
    settings: {
      autoFine: !!r?.settings?.autoFine, fineAmount: Number(r?.settings?.fineAmount) || 0, graceMinutes: Number(r?.settings?.graceMinutes) || 0,
      runHour: Number(r?.settings?.runHour) || 0, noticeDaysBefore: Number(r?.settings?.noticeDaysBefore) || 0,
    },
    items: (Array.isArray(r?.items) ? r.items : []).map((i: any) => ({
      id: i.id, name: String(i.name || ''), custom: !!i.custom, since: i.since ?? null, ...pickSched(i),
    })),
  };
}

function daysText(workdays: string): string {
  return String(workdays).split(',').map((x) => WD[Number(x.trim())]).filter(Boolean).join(', ');
}
function schedText(s: SchedBody): string {
  return s.floating
    ? 'свободное начало (опоздания не считаются)'
    : `${s.startTime}–${s.endTime}, допуск ${s.graceMinutes} мин, норма ${hm(s.normMinutes)}, дни: ${daysText(s.workdays)}`;
}

export const workSchedules: ToolDef<{ employee?: string }> = {
  name: 'work_schedules',
  kind: 'read',
  description:
    'Графики работы (вкладка «График работы»): общий график компании и личные графики, настройки авто-штрафа за опоздание. '
    + '«Какой у нас график», «во сколько начинает смену монтажёр», «включён ли авто-штраф». Только админ и основатель.',
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Метка E… или имя — график одного человека. Пусто — общий и все личные.' } },
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    const v = await loadSchedules(ctx);
    const settings = {
      autoFine: v.settings.autoFine ? 'включён' : 'выключен', fine: money(v.settings.fineAmount),
      summaryHour: `${String(v.settings.runHour).padStart(2, '0')}:00`, warnDaysBefore: v.settings.noticeDaysBefore,
    };
    const person = (p: SchedPerson) => ({
      ref: ctx.refs.add('E', p.id, p.name), name: p.name, schedule: schedText(p), own: p.custom, ...(p.since ? { since: p.since } : {}),
    });
    if (args.employee) {
      const ref = ctx.refs.resolve('E', args.employee);
      const p = ref ? v.items.find((i) => i.id === ref.id) : pickByName(String(args.employee), v.items, 'График сотрудника');
      if (!p) throw new ToolError('У этого сотрудника график не ведётся (основатель и админ смен не ведут).');
      return { settings, person: person(p) };
    }
    return {
      today: v.today,
      company: { schedule: schedText(v.company), ...(v.company.upcoming.length ? { upcoming: v.company.upcoming } : {}) },
      settings,
      ownSchedule: v.items.filter((i) => i.custom).map(person),
      onCompanySchedule: v.items.filter((i) => !i.custom).map((i) => ({ ref: ctx.refs.add('E', i.id, i.name), name: i.name })),
    };
  },
};

interface SchedSetArgs {
  employees?: string[]; company?: boolean; startTime?: string; endTime?: string; graceMinutes?: number;
  workdays?: number[]; floating?: boolean; normMinutes?: number; validFrom?: string;
}

async function prepareSchedSet(args: SchedSetArgs, ctx: ToolContext) {
  const names = (Array.isArray(args.employees) ? args.employees : []).filter((x) => String(x ?? '').trim());
  if (args.company && names.length) throw new ToolError('Общий график и личные — разные действия. Назовите что-то одно.');
  if (!args.company && !names.length) throw new ToolError('Чей график менять? Назовите сотрудников или скажите «общий график компании».');
  if (args.company && !isFounder(ctx.user)) throw new ToolError('Общий график компании меняет только основатель.');

  const patch: Partial<SchedBody> = {};
  if (args.startTime !== undefined) patch.startTime = checkTime(args.startTime);
  if (args.endTime !== undefined) patch.endTime = checkTime(args.endTime);
  if (args.graceMinutes !== undefined) {
    const g = Number(args.graceMinutes);
    if (!Number.isInteger(g) || g < 0 || g > 240) throw new ToolError('Допуск на опоздание — от 0 до 240 минут.');
    patch.graceMinutes = g;
  }
  if (args.workdays !== undefined) {
    const d = (Array.isArray(args.workdays) ? args.workdays : []).map(Number);
    if (!d.length || d.some((x) => !Number.isInteger(x) || x < 1 || x > 7)) throw new ToolError('Рабочие дни — числа от 1 (пн) до 7 (вс).');
    patch.workdays = [...new Set(d)].sort().join(',');
  }
  if (args.floating !== undefined) patch.floating = !!args.floating;
  if (args.normMinutes !== undefined) {
    const n = Number(args.normMinutes);
    if (!Number.isInteger(n) || n < 0 || n > 960) throw new ToolError('Норма — от 0 до 960 минут.');
    patch.normMinutes = n;
  }
  if (!Object.keys(patch).length) throw new ToolError('Что поменять в графике: начало, конец, допуск, дни, норму?');
  const v = await loadSchedules(ctx);
  const validFrom = args.validFrom ? checkDate(args.validFrom) : v.today;
  if (validFrom < v.today) throw new ToolError('Задним числом график менять нельзя — прошлые дни уже посчитаны.');

  const targets: Array<{ id: string | null; name: string; before: SchedBody; custom: boolean }> = [];
  if (args.company) targets.push({ id: null, name: 'Общий график компании', before: pickSched(v.company), custom: true });
  else {
    for (const n of names) {
      const ref = ctx.refs.resolve('E', n);
      const p = ref ? v.items.find((i) => i.id === ref.id) : pickByName(String(n), v.items, 'График сотрудника');
      if (!p) throw new ToolError(`У ${ref?.label ?? n} график не ведётся (основатель и админ смен не ведут).`);
      if (!targets.some((t) => t.id === p.id)) targets.push({ id: p.id, name: p.name, before: pickSched(p), custom: p.custom });
    }
  }
  return { patch, validFrom, targets, explicitFrom: !!args.validFrom };
}

const schedDiff = (before: SchedBody, patch: Partial<SchedBody>) => (Object.keys(patch) as Array<keyof SchedBody>)
  .map((k) => {
    const label = { startTime: 'начало', endTime: 'конец', graceMinutes: 'допуск, мин', workdays: 'дни', floating: 'свободное начало', normMinutes: 'норма, мин' }[k];
    const show = (x: any) => (k === 'workdays' ? daysText(String(x)) : k === 'floating' ? (x ? 'да' : 'нет') : String(x));
    return `${label}: ${show(before[k])} → ${show(patch[k])}`;
  }).join('; ');

function schedRestore(t: { id: string | null; before: SchedBody; custom: boolean }, validFrom: string): UndoStep {
  if (t.id === null) return { method: 'PATCH', path: '/work-shifts/schedules/company', body: { ...t.before, validFrom } };
  if (!t.custom) return { method: 'DELETE', path: `/work-shifts/schedules/${t.id}`, body: { validFrom } };
  return { method: 'PATCH', path: `/work-shifts/schedules/${t.id}`, body: { ...t.before, validFrom } };
}

export const workScheduleSet: ToolDef<SchedSetArgs> = {
  name: 'work_schedule_set',
  kind: 'write',
  description:
    'ИЗМЕНИТЬ график работы с даты: сотруднику или нескольким («поставь Фирузу смену с 14:00 до 22:00», «Сабрине выходной в субботу — '
    + 'рабочие дни пн-пт») либо общий график компании (company=true, только основатель). Меняется только названное; по умолчанию с сегодняшнего дня, '
    + 'задним числом нельзя. От графика зависят опоздания и штрафы. Дни: 1 пн … 7 вс. НЕ для разового отгула (set_absence) и НЕ для «приду позже».',
  parameters: {
    type: 'object',
    properties: {
      employees: { type: 'array', items: { type: 'string' }, description: 'Метки E… сотрудников.' },
      company: { type: 'boolean', description: 'true — общий график компании.' },
      startTime: { type: 'string', description: 'Начало смены ЧЧ:ММ.' },
      endTime: { type: 'string', description: 'Конец смены ЧЧ:ММ.' },
      graceMinutes: { type: 'number', description: 'Сколько минут после начала не считается опозданием (0–240).' },
      workdays: { type: 'array', items: { type: 'number' }, description: 'Рабочие дни: 1 пн … 7 вс.' },
      floating: { type: 'boolean', description: 'Свободное начало (выездные съёмки): опоздания не считаются.' },
      normMinutes: { type: 'number', description: 'Норма в минутах; не называли — посчитается сама.' },
      validFrom: { type: 'string', description: 'С какой даты, ГГГГ-ММ-ДД. По умолчанию сегодня.' },
    },
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareSchedSet(args, ctx);
    return `🕘 ИЗМЕНИТЬ ГРАФИК РАБОТЫ\n📅 с ${fmtDateRu(p.validFrom)}\n${p.targets.map((t) => `👤 ${t.name}\n   ${schedDiff(t.before, p.patch)}`).join('\n')}\nОт графика зависят опоздания и штрафы`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareSchedSet(args, ctx);
    const body: Record<string, any> = { ...p.patch, ...(p.explicitFrom ? { validFrom: p.validFrom } : {}) };
    try {
      if (p.targets[0].id === null) await ctx.api.patch('/work-shifts/schedules/company', body);
      else {
        const rest = p.targets.slice(1).map((t) => t.id);
        await ctx.api.patch(`/work-shifts/schedules/${p.targets[0].id}`, { ...body, ...(rest.length ? { alsoUserIds: rest } : {}) });
      }
    } catch (e) { throw apiErr(e); }
    return {
      summary: `🕘 График с ${fmtDateRu(p.validFrom)}: ${p.targets.map((t) => t.name).join(', ')} — ${schedDiff(p.targets[0].before, p.patch)}`,
      undo: p.targets.map((t) => schedRestore(t, p.validFrom)),
    };
  },
};

export const workScheduleReset: ToolDef<{ employee: string; validFrom?: string }> = {
  name: 'work_schedule_reset',
  kind: 'write',
  description:
    'ВЕРНУТЬ сотрудника к общему графику компании с даты (сбросить личный): «верни Фируза на общий график». '
    + 'По умолчанию с сегодня. Работает, только если у человека свой график.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… сотрудника.' },
      validFrom: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    required: ['employee'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareReset(args, ctx);
    return `🕘 ВЕРНУТЬ К ОБЩЕМУ ГРАФИКУ\n👤 ${p.person.name} (сейчас: ${schedText(p.person)})\n📅 с ${fmtDateRu(p.validFrom)}\nПо общему: ${schedText(p.company)}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareReset(args, ctx);
    try { await ctx.api.delete(`/work-shifts/schedules/${p.person.id}`, { validFrom: p.validFrom }); } catch (e) { throw apiErr(e); }
    return {
      summary: `🕘 ${p.person.name} с ${fmtDateRu(p.validFrom)} снова по общему графику`,
      undo: [schedRestore({ id: p.person.id, before: pickSched(p.person), custom: true }, p.validFrom)],
    };
  },
};

async function prepareReset(args: { employee: string; validFrom?: string }, ctx: ToolContext) {
  const v = await loadSchedules(ctx);
  const ref = ctx.refs.resolve('E', args.employee);
  const person = ref ? v.items.find((i) => i.id === ref.id) : pickByName(String(args.employee), v.items, 'График сотрудника');
  if (!person) throw new ToolError('У этого сотрудника график не ведётся.');
  if (!person.custom) throw new ToolError(`${person.name} и так работает по общему графику.`);
  const validFrom = args.validFrom ? checkDate(args.validFrom) : v.today;
  if (validFrom < v.today) throw new ToolError('Задним числом график менять нельзя — прошлые дни уже посчитаны.');
  return { person, company: v.company, validFrom };
}

interface AutoFineArgs { autoFine?: boolean; fineAmount?: number; runHour?: number; noticeDaysBefore?: number }

async function prepareAutoFine(args: AutoFineArgs, ctx: ToolContext) {
  const patch: Partial<AutoFineArgs> = {};
  if (args.autoFine !== undefined) patch.autoFine = !!args.autoFine;
  if (args.fineAmount !== undefined) {
    const a = Number(args.fineAmount);
    if (!(a >= 0) || a > 1_000_000) throw new ToolError('Сумма авто-штрафа — от 0 сомони.');
    patch.fineAmount = a;
  }
  if (args.runHour !== undefined) {
    const h = Number(args.runHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new ToolError('Час подведения итога — от 0 до 23.');
    patch.runHour = h;
  }
  if (args.noticeDaysBefore !== undefined) {
    const d = Number(args.noticeDaysBefore);
    if (!Number.isInteger(d) || d < 0 || d > 7) throw new ToolError('Предупреждать заранее можно за 0–7 дней.');
    patch.noticeDaysBefore = d;
  }
  if (!Object.keys(patch).length) throw new ToolError('Что поменять: включить/выключить, сумму, час или срок предупреждения?');
  const before = (await loadSchedules(ctx)).settings;
  return { patch, before };
}

const autoFineText = (s: Partial<AutoFineArgs>) => [
  s.autoFine !== undefined ? `авто-штраф ${s.autoFine ? 'включён' : 'выключен'}` : '',
  s.fineAmount !== undefined ? `сумма ${money(s.fineAmount)}` : '',
  s.runHour !== undefined ? `итог дня в ${String(s.runHour).padStart(2, '0')}:00` : '',
  s.noticeDaysBefore !== undefined ? `предупреждать за ${s.noticeDaysBefore} дн.` : '',
].filter(Boolean).join(', ');

export const shiftAutoFineSet: ToolDef<AutoFineArgs> = {
  name: 'shift_auto_fine_set',
  kind: 'write',
  description:
    'НАСТРОЙКИ АВТО-ШТРАФА за опоздание (только основатель): «включи авто-штраф», «выключи авто-штраф», «авто-штраф 150 сомони», '
    + '«подводить итог дня в 20:00», «предупреждать за 2 дня». При включении система сама штрафует опоздавших без предупреждения '
    + 'в час итога дня и пишет им в Telegram. Текущие настройки смотри в work_schedules. НЕ для штрафа конкретному человеку (late_fine).',
  parameters: {
    type: 'object',
    properties: {
      autoFine: { type: 'boolean', description: 'true — включить, false — выключить.' },
      fineAmount: { type: 'number', description: 'Сумма штрафа, сомони.' },
      runHour: { type: 'number', description: 'Час подведения итога дня, 0–23.' },
      noticeDaysBefore: { type: 'number', description: 'За сколько дней нужно предупредить, 0–7.' },
    },
    additionalProperties: false,
  },
  available: isFounder,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareAutoFine(args, ctx);
    return `⚙️ АВТО-ШТРАФ ЗА ОПОЗДАНИЕ — НАСТРОЙКИ\nБудет: ${autoFineText(p.patch)}\nСейчас: ${autoFineText(p.before)}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareAutoFine(args, ctx);
    try { await ctx.api.patch('/work-shifts/settings', p.patch); } catch (e) { throw apiErr(e); }
    const prev: Record<string, any> = {};
    for (const k of Object.keys(p.patch) as Array<keyof AutoFineArgs>) prev[k] = p.before[k];
    return { summary: `⚙️ Авто-штраф: ${autoFineText(p.patch)}`, undo: [{ method: 'PATCH', path: '/work-shifts/settings', body: prev }] };
  },
};

// ─── Табель месяца ─────────────────────────────────────────────────────

export const teamTimesheet: ToolDef<{ month?: string; employee?: string }> = {
  name: 'team_timesheet',
  kind: 'read',
  description:
    'Табель месяца по команде (вкладка «Табель месяца»): сколько часов отработал каждый, рабочих дней, средний день, норма и '
    + 'недоработка/переработка, дни опозданий, отгулы/отпуска/больничные. «Сколько отработала команда в октябре», '
    + '«сколько часов у Фируза за месяц», «кто больше всех опаздывал». Только админ и основатель. Свой табель — shift_status month=true.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      employee: { type: 'string', description: 'Метка E… или имя — только один человек.' },
    },
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    const ym = checkYm(args.month, ctx.today.slice(0, 7));
    const m = await loadMonth(ctx, ym);
    let items = m.items;
    if (args.employee) {
      const ref = ctx.refs.resolve('E', args.employee);
      items = [ref ? ((): MonthItem => {
        const hit = m.items.find((i) => i.id === ref.id);
        if (!hit) throw new ToolError(`${ref.label} нет в табеле.`);
        return hit;
      })() : pickByName(String(args.employee), m.items, 'В табеле')];
    }
    const dateOf = (d: number) => fmtDateRu(`${m.ym}-${String(d).padStart(2, '0')}`);
    return {
      month: ymRu(m.ym),
      people: items.slice(0, 60).map((i) => {
        const abs: Record<string, number> = {};
        for (const k of Object.values(i.absences)) abs[ABSENCE_RU[k] || k] = (abs[ABSENCE_RU[k] || k] || 0) + 1;
        return {
          ref: ctx.refs.add('E', i.id, i.name), name: i.name, worked: hm(i.totalMinutes), workedDays: i.workedDays,
          averageDay: hm(i.avgMinutes), norm: hm(i.normMinutes),
          [i.diffMinutes >= 0 ? 'overtime' : 'shortfall']: hm(Math.abs(i.diffMinutes)),
          lateCount: i.lateDays.length, ...(i.lateDays.length ? { lateDates: i.lateDays.map(dateOf) } : {}),
          ...(Object.keys(abs).length ? { absences: abs } : {}),
        };
      }),
    };
  },
};

// ─── Отпуска сотрудников ───────────────────────────────────────────────

interface EmpRecord { id: string; userId: string; name: string; status: string; from: string | null; until: string | null; paid: boolean }

async function loadEmployeeRecords(ctx: ToolContext): Promise<EmpRecord[]> {
  let list: any;
  try { list = await ctx.api.get('/employees'); } catch (e) { throw apiErr(e); }
  return (Array.isArray(list) ? list : []).filter((e) => e?.userId).map((e: any) => ({
    id: e.id, userId: e.userId, name: String(e.fullName || e.user?.name || '').trim(), status: e.status || 'active',
    from: e.vacationFrom ? day10(e.vacationFrom) : null, until: e.vacationUntil ? day10(e.vacationUntil) : null, paid: !!e.vacationPaid,
  }));
}

async function recordOf(ctx: ToolContext, ref: unknown): Promise<EmpRecord> {
  const e = ensureEmployee(ctx, ref);
  const rec = (await loadEmployeeRecords(ctx)).find((r) => r.userId === e.id);
  if (!rec) throw new ToolError(`${e.label}: нет карточки сотрудника.`);
  return rec;
}

const vacText = (from: string | null, until: string | null) => `${from ? fmtDateRu(from) : '?'} — ${until ? fmtDateRu(until) : '?'}`;

export const vacationsList: ToolDef<{ month?: string; employee?: string }> = {
  name: 'vacations_list',
  kind: 'read',
  description:
    'Отпуска сотрудников: кто сейчас в отпуске или ему назначен отпуск (с датами, оплачиваемый или за свой счёт) и кто в отпуске в выбранном '
    + 'месяце по табелю. «Какие отпуска в декабре», «кто сейчас в отпуске», «когда Фарзон возвращается». Только админ и основатель.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      employee: { type: 'string', description: 'Метка E… или имя — только один человек.' },
    },
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    const ym = checkYm(args.month, ctx.today.slice(0, 7));
    const [records, m] = await Promise.all([loadEmployeeRecords(ctx), loadMonth(ctx, ym)]);
    let only: string | null = null;
    if (args.employee) {
      const ref = ctx.refs.resolve('E', args.employee);
      only = ref ? ref.id : pickByName(String(args.employee), records, 'Сотрудник').userId;
    }
    const statusRows = records.filter((r) => r.status === 'vacation' && (!only || r.userId === only));
    const days = (u: MonthItem) => Object.entries(u.absences).filter(([, k]) => k === 'vacation').map(([d]) => Number(d)).sort((a, b) => a - b);
    const runs = (u: MonthItem) => {
      const out: string[] = [];
      let start = 0; let prev = 0;
      const flush = () => { if (start) out.push(start === prev ? dateOfDay(m.ym, start) : `${dateOfDay(m.ym, start)} — ${dateOfDay(m.ym, prev)}`); };
      for (const d of days(u)) {
        if (start && d === prev + 1) { prev = d; continue; }
        flush(); start = d; prev = d;
      }
      flush();
      return out;
    };
    return {
      month: ymRu(m.ym),
      byStatus: statusRows.map((r) => ({
        ref: ctx.refs.add('E', r.userId, r.name), name: r.name, vacation: vacText(r.from, r.until), until: r.until,
        kind: r.paid ? 'оплачиваемый' : 'за свой счёт',
        state: r.from && r.from > ctx.today ? 'ещё не начался' : 'идёт',
      })),
      inTimesheet: m.items.filter((u) => (!only || u.id === only) && days(u).length).map((u) => ({
        ref: ctx.refs.add('E', u.id, u.name), name: u.name, days: days(u).length, periods: runs(u),
      })),
    };
  },
};

function dateOfDay(ym: string, d: number) { return fmtDateRu(`${ym}-${String(d).padStart(2, '0')}`); }

/** Оплачиваемый или за свой счёт — только по словам человека: от этого зависит зарплата. */
export function vacationPaidFromSpeech(text: string): boolean | null {
  const unpaid = /за свой счет|за свой счёт|неоплачива|без оплаты|без сохранения|бе музд|ба ҳисоби худ|ба хисоби худ/i.test(text);
  const paid = /(?<!не)оплачиваем|оплачен|с сохранением|с оплатой|музднок|пулакӣ|пулаки/i.test(text);
  if (unpaid === paid) return null;
  return paid;
}

interface VacationSetArgs { employee: string; from?: string; until: string; paid?: boolean }

async function prepareVacation(args: VacationSetArgs, ctx: ToolContext) {
  const rec = await recordOf(ctx, args.employee);
  if (rec.status === 'inactive') throw new ToolError(`${rec.name} — неактивный сотрудник, отпуск ему не ставят.`);
  const from = args.from ? checkDate(args.from) : ctx.today;
  const until = checkDate(args.until, 'дата окончания');
  if (until < from) throw new ToolError('Конец отпуска раньше начала.');
  if (until < ctx.today) throw new ToolError('Этот отпуск уже закончился.');
  const days = Math.round((Date.parse(until) - Date.parse(from)) / 86400000) + 1;
  if (days > 366) throw new ToolError('Отпуск не может быть длиннее года.');
  const paid = vacationPaidFromSpeech(ctx.utterance);
  if (paid === null) {
    throw new ToolError('Отпуск оплачиваемый или за свой счёт? Человек не сказал — уточните через ask_choice (варианты «Оплачиваемый», «За свой счёт»), не выбирайте сами: от этого зависит зарплата.');
  }
  let cost = '';
  if (!paid && hasGrant(ctx.user, 'finance.manage')) {
    try {
      const pr: any = await ctx.api.get('/finance/vacation-preview', { userId: rec.userId, from, until });
      if (pr?.linked && Array.isArray(pr.months) && pr.months.length) {
        cost = pr.months.map((m: any) => `${ymRu(m.ym)}: ${m.days} раб. дн. из ${m.monthWorkdays}${m.amount != null ? `, подсказка −${money(m.amount)}` : ''}`).join('\n   ');
      }
    } catch { cost = ''; }
  }
  return { rec, from, until, days, paid, cost };
}

function restoreVacationStep(rec: EmpRecord): UndoStep {
  return {
    method: 'PATCH', path: `/employees/${rec.id}`,
    body: rec.status === 'vacation'
      ? { status: 'vacation', vacationFrom: rec.from, vacationUntil: rec.until, vacationPaid: rec.paid }
      : { status: 'active' },
  };
}

export const vacationSet: ToolDef<VacationSetArgs> = {
  name: 'vacation_set',
  kind: 'write',
  description:
    'ОТПРАВИТЬ СОТРУДНИКА В ОТПУСК с даты по дату включительно — как статус «В отпуске» в карточке сотрудника: «отправь Фарзона в отпуск '
    + 'с 1 по 10 декабря». Пока отпуск идёт, у человека в CRM открыт только профиль, дни отметятся в табеле. Нужно знать: оплачиваемый '
    + 'или за свой счёт — если человек не сказал, спроси через ask_choice, сам не выбирай. НЕ для одного дня отгула (set_absence) и НЕ для '
    + 'удержания денег (vacation_pay_decide / salary_accrual).',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка сотрудника E…' },
      from: { type: 'string', description: 'Первый день, ГГГГ-ММ-ДД. Не названа — сегодня.' },
      until: { type: 'string', description: 'Последний день включительно, ГГГГ-ММ-ДД.' },
      paid: { type: 'boolean', description: 'true — оплачиваемый, false — за свой счёт. Только если человек так сказал.' },
    },
    required: ['employee', 'until'],
    additionalProperties: false,
  },
  available: canVacation,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareVacation(args, ctx);
    const now = p.rec.status === 'vacation' ? `\n⚠️ Заменит текущий отпуск (${vacText(p.rec.from, p.rec.until)})` : '';
    return `🏖 ОТПРАВИТЬ В ОТПУСК\n👤 ${p.rec.name}\n📅 ${fmtDateRu(p.from)} — ${fmtDateRu(p.until)} (${p.days} дн.)\n`
      + `💼 ${p.paid ? 'Оплачиваемый — зарплата не меняется' : 'За свой счёт — в ведомости появится подсказка удержать'}${p.cost ? `\n   ${p.cost}` : ''}${now}\n`
      + 'В CRM у сотрудника будет открыт только профиль';
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareVacation(args, ctx);
    try {
      await ctx.api.patch(`/employees/${p.rec.id}`, { status: 'vacation', vacationFrom: p.from, vacationUntil: p.until, vacationPaid: p.paid });
    } catch (e) { throw apiErr(e); }
    return {
      summary: `🏖 ${p.rec.name} в отпуске ${fmtDateRu(p.from)} — ${fmtDateRu(p.until)} (${p.paid ? 'оплачиваемый' : 'за свой счёт'})`,
      undo: [restoreVacationStep(p.rec)],
    };
  },
};

export const vacationEnd: ToolDef<{ employee: string }> = {
  name: 'vacation_end',
  kind: 'write',
  description:
    'ВЕРНУТЬ ИЗ ОТПУСКА / ОТМЕНИТЬ ОТПУСК сотрудника: «отмени отпуск Фарзону», «Фарзон вышел из отпуска». Статус снова «Активный», '
    + 'будущие дни отпуска в табеле освобождаются. НЕ для одного дня (absence_remove).',
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Метка сотрудника E…' } },
    required: ['employee'],
    additionalProperties: false,
  },
  available: canVacation,
  confirm: () => true,
  async preview(args, ctx) {
    const rec = await currentVacation(args, ctx);
    return `🏖 ВЕРНУТЬ ИЗ ОТПУСКА\n👤 ${rec.name}\n📅 был отпуск ${vacText(rec.from, rec.until)}\nСтатус станет «Активный», будущие дни отпуска в табеле освободятся`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const rec = await currentVacation(args, ctx);
    try { await ctx.api.patch(`/employees/${rec.id}`, { status: 'active' }); } catch (e) { throw apiErr(e); }
    return { summary: `🏖 ${rec.name} возвращён из отпуска (был ${vacText(rec.from, rec.until)})`, undo: [restoreVacationStep(rec)] };
  },
};

async function currentVacation(args: { employee: string }, ctx: ToolContext): Promise<EmpRecord> {
  const rec = await recordOf(ctx, args.employee);
  if (rec.status !== 'vacation') throw new ToolError(`${rec.name} сейчас не в отпуске и отпуск ему не назначен.`);
  return rec;
}

// ─── Отпуск в зарплате: «Удержать / Не удерживать» ─────────────────────

interface VacHint { vacationId: string; from: string; until: string; monthFrom: string; monthUntil: string; paid: boolean; days: number; monthWorkdays: number; salary: number; amount: number; state: string }
interface VacRow { id: string; name: string; userId: string | null; hints: VacHint[]; vacationEntries: Array<{ id: string }> }

async function loadVacationRows(ctx: ToolContext, ym: string): Promise<VacRow[]> {
  let res: any;
  try { res = await ctx.api.get('/finance/expense/detail/salary', { ym }); } catch (e) { throw apiErr(e); }
  return (Array.isArray(res?.rows) ? res.rows : []).map((r: any) => ({
    id: r.id, name: String(r.name || ''), userId: r.userId ?? null,
    hints: (Array.isArray(r.vacationHints) ? r.vacationHints : []).map((h: any) => ({
      vacationId: h.vacationId, from: day10(h.from), until: day10(h.until), monthFrom: day10(h.monthFrom), monthUntil: day10(h.monthUntil),
      paid: !!h.paid, days: Number(h.days) || 0, monthWorkdays: Number(h.monthWorkdays) || 0, salary: Number(h.salary) || 0,
      amount: Number(h.amount) || 0, state: h.state,
    })),
    vacationEntries: Array.isArray(r.vacationEntries) ? r.vacationEntries : [],
  }));
}

const HINT_RU: Record<string, string> = { pending: 'ждёт решения', withheld: 'удержано', dismissed: 'не удерживать', paid: 'оплачиваемый' };

export const vacationPayPending: ToolDef<{ month?: string }> = {
  name: 'vacation_pay_pending',
  kind: 'read',
  description:
    'Отпуска в зарплатной ведомости за месяц и решения по ним: сколько подсказано удержать за отпуск «за свой счёт», '
    + 'ждёт ли решения. «Какие отпуска ждут решения по зарплате», «сколько удержать за отпуск Фарзона». Только у кого finance.manage.',
  parameters: {
    type: 'object',
    properties: { month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' } },
    additionalProperties: false,
  },
  available: financeManage,
  async run(args, ctx) {
    const ym = checkYm(args.month, ctx.today.slice(0, 7));
    const rows = (await loadVacationRows(ctx, ym)).filter((r) => r.hints.length);
    return {
      month: ymRu(ym),
      vacations: rows.flatMap((r) => r.hints.map((h) => ({
        ref: r.userId ? ctx.refs.add('E', r.userId, r.name) : ctx.refs.add('S', r.id, r.name), name: r.name,
        vacation: vacText(h.from, h.until), inThisMonth: vacText(h.monthFrom, h.monthUntil),
        workdays: `${h.days} из ${h.monthWorkdays}`, suggested: h.paid ? null : money(h.amount), state: HINT_RU[h.state] || h.state,
      }))),
    };
  },
};

interface VacPayArgs { employee: string; month?: string; action: 'withhold' | 'dismiss'; amount?: number }

async function prepareVacPay(args: VacPayArgs, ctx: ToolContext) {
  if (args.action !== 'withhold' && args.action !== 'dismiss') throw new ToolError('Удержать или не удерживать?');
  const ym = checkYm(args.month, ctx.today.slice(0, 7));
  const rows = (await loadVacationRows(ctx, ym)).filter((r) => r.hints.some((h) => !h.paid));
  if (!rows.length) throw new ToolError(`В ведомости за ${ymRu(ym)} нет отпусков «за свой счёт».`);
  const s = String(args.employee ?? '').trim();
  const eref = ctx.refs.resolve('E', s);
  const sref = ctx.refs.resolve('S', s);
  const row = eref ? rows.find((r) => r.userId === eref.id)
    : sref ? rows.find((r) => r.id === sref.id)
      : pickByName(s, rows, `Отпуск за свой счёт в ${ymRu(ym)}`);
  if (!row) throw new ToolError('У этого сотрудника в этом месяце нет отпуска «за свой счёт».');
  const hints = row.hints.filter((h) => !h.paid);
  if (hints.length > 1) throw new ToolError(`У ${row.name} в этом месяце несколько отпусков: ${hints.map((h) => vacText(h.from, h.until)).join('; ')}. Решайте по одному на сайте.`);
  const hint = hints[0];
  let amount: number | undefined;
  if (args.action === 'withhold') {
    amount = args.amount === undefined || args.amount === null ? hint.amount : Math.round(Number(args.amount) * 100) / 100;
    if (!(amount > 0) || amount > 10_000_000) throw new ToolError('Сумма удержания должна быть больше нуля (на сайте подсказка 0 — введите свою).');
  }
  return { ym, row, hint, amount };
}

export const vacationPayDecide: ToolDef<VacPayArgs> = {
  name: 'vacation_pay_decide',
  kind: 'write',
  description:
    'РЕШЕНИЕ ПО ОТПУСКУ В ЗАРПЛАТЕ — кнопки «Удержать» / «Не удерживать» в ведомости для отпуска «за свой счёт»: '
    + '«удержи за отпуск Фарзона», «не удерживай за отпуск Сабрины», «удержи за отпуск 800». action=withhold — удержать подсказанную сумму '
    + '(или свою в amount), dismiss — не удерживать. Сотруднику сообщение не уходит. НЕ для штрафа/премии (salary_accrual) и не для самого отпуска (vacation_set).',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… или S…, либо имя.' },
      month: { type: 'string', description: 'За какой месяц ведомости, ГГГГ-ММ; по умолчанию текущий.' },
      action: { type: 'string', enum: ['withhold', 'dismiss'] },
      amount: { type: 'number', description: 'Своя сумма вместо подсказанной (только для withhold), сомони.' },
    },
    required: ['employee', 'action'],
    additionalProperties: false,
  },
  available: financeManage,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareVacPay(args, ctx);
    const head = `🏖 ${args.action === 'withhold' ? 'УДЕРЖАТЬ ЗА ОТПУСК ИЗ ЗАРПЛАТЫ' : 'НЕ УДЕРЖИВАТЬ ЗА ОТПУСК'}`;
    return `${head}\n👤 ${p.row.name}\n📅 отпуск ${vacText(p.hint.from, p.hint.until)}, за ${ymRu(p.ym)}: ${p.hint.days} раб. дн. из ${p.hint.monthWorkdays}\n`
      + (args.action === 'withhold'
        ? `💵 −${money(p.amount)}${args.amount !== undefined ? ` (своя сумма, подсказка ${money(p.hint.amount)})` : ''} из зарплаты за ${ymRu(p.ym)}`
        : '💵 Из зарплаты ничего не вычитается')
      + (p.hint.state !== 'pending' ? `\n⚠️ Прежнее решение (${HINT_RU[p.hint.state] || p.hint.state}) будет заменено` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareVacPay(args, ctx);
    try {
      await ctx.api.post(`/finance/employees/${p.row.id}/vacation-hint`, {
        vacationId: p.hint.vacationId, ym: p.ym, action: args.action, ...(args.action === 'withhold' ? { amount: p.amount } : {}),
      });
    } catch (e) { throw apiErr(e); }
    let undo: UndoStep[] | undefined;
    if (args.action === 'withhold' && p.hint.state === 'pending') {
      const after = (await loadVacationRows(ctx, p.ym)).find((r) => r.id === p.row.id);
      const before = new Set(p.row.vacationEntries.map((e) => e.id));
      const entry = after?.vacationEntries.find((e) => !before.has(e.id));
      if (entry) undo = [{ method: 'DELETE', path: `/finance/employees/${p.row.id}/deduction/${entry.id}?kind=vacation&ym=${p.ym}` }];
    }
    return {
      summary: args.action === 'withhold'
        ? `🏖 Удержано за отпуск ${p.row.name}: ${money(p.amount)} (зарплата за ${ymRu(p.ym)})`
        : `🏖 ${p.row.name}: за отпуск ${vacText(p.hint.from, p.hint.until)} не удерживаем`,
      undo,
    };
  },
};

export const ATTENDANCE_TOOLS: ToolDef[] = [
  lateArrivals, lateFine, lateForgive, lateCancel,
  shiftRequestsPending, shiftRequestDecide, absenceRemove,
  workSchedules, workScheduleSet, workScheduleReset, shiftAutoFineSet, teamTimesheet,
  vacationsList, vacationSet, vacationEnd, vacationPayPending, vacationPayDecide,
];

