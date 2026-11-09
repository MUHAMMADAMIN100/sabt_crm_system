import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { checkDate, esc, fmtDateRu, matchScore, nameScore, norm } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Зарплата — Финансы → Расходы → Зарплата (ведомость), как на сайте:
 *  • штраф / премия / удержание за отпуск — запись в журнал сотрудника за
 *    месяц (POST /finance/employees/:id/deduction), счёт не трогает;
 *  • аванс / зарплата / бонус «выдать деньги» — расход со статьёй «Зарплата»
 *    и привязкой к сотруднику (окно «Выдать аванс» / «Выплатить»).
 * Только у кого finance.manage. Любые деньги — через «Подтвердить».
 * Штраф и премию сотрудник узнаёт сообщением в Telegram (решение владельца
 * 09.11.2026), об отмене — тоже.
 */

const finance = (u: any) => hasGrant(u, 'finance.manage');
const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const money = (n: unknown) => `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом.`;
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ymRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function checkAmount(v: unknown): number {
  const n = Math.round(Number(v) * 100) / 100;
  if (!(n > 0) || n > 10_000_000) throw new ToolError('Сумма должна быть больше нуля.');
  return n;
}

interface PayrollEmployee { id: string; name: string; userId: string | null; role: string | null; status: string }

async function payrollEmployees(ctx: ToolContext): Promise<PayrollEmployee[]> {
  let list: any[];
  try { list = await ctx.api.get<any[]>('/finance/employees'); } catch (e) { throw apiErr(e); }
  return (Array.isArray(list) ? list : []).map((e) => ({
    id: e.id, name: String(e.name || '').trim(), userId: e.userId || null, role: e.role || null, status: e.status || 'active',
  }));
}

/** Сотрудник ведомости по метке S…, по метке E… (учётка CRM) или по имени. */
async function resolvePayrollEmployee(ctx: ToolContext, spoken: unknown): Promise<PayrollEmployee> {
  const list = (await payrollEmployees(ctx)).filter((e) => e.status !== 'fired');
  const s = String(spoken ?? '').trim();
  const bySref = ctx.refs.resolve('S', s);
  if (bySref) {
    const e = list.find((x) => x.id === bySref.id);
    if (e) return e;
  }
  const byEref = ctx.refs.resolve('E', s);
  if (byEref) {
    const e = list.find((x) => x.userId === byEref.id);
    if (e) return e;
    // В ведомости имя может быть короче, чем в CRM — ищем и по имени учётки.
    return pickByName(ctx, list, byEref.label);
  }
  return pickByName(ctx, list, s);
}

function pickByName(ctx: ToolContext, list: PayrollEmployee[], name: string): PayrollEmployee {
  if (!norm(name)) throw new ToolError('Какому сотруднику? Назовите имя.');
  const scored = list
    .map((e) => ({ e, sc: Math.max(nameScore(e.name, name), nameScore(name, e.name)) }))
    .filter((x) => x.sc >= 0.5)
    .sort((a, b) => b.sc - a.sc);
  if (!scored.length) {
    throw new ToolError(`В зарплатной ведомости нет сотрудника «${name}». Есть: ${list.map((e) => e.name).join(', ')}.`);
  }
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    const opts = scored.filter((x) => x.sc === scored[0].sc).slice(0, 6).map((x) => x.e.name);
    throw new ToolError(`Под «${name}» подходят несколько сотрудников: ${opts.join(', ')}. Уточните через ask_choice.`);
  }
  const e = scored[0].e;
  ctx.refs.add('S', e.id, e.name);
  return e;
}

// ─── Чтение ─────────────────────────────────────────────────────────────

export const salarySheet: ToolDef<{ month?: string; employee?: string }> = {
  name: 'salary_sheet',
  kind: 'read',
  description:
    'Зарплатная ведомость за месяц: оклад, бонус, аванс, штрафы (с датами и причинами), выплачено, к выплате — '
    + 'по всем или по одному сотруднику. «Сколько к выплате Мухаммадамину», «какие штрафы у Фарзоны в ноябре», «фонд зарплаты».',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      employee: { type: 'string', description: 'Сотрудник: метка S… / E… или имя. Пусто — все.' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const ym = args.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(args.month) ? args.month : ctx.today.slice(0, 7);
    let res: any;
    try { res = await ctx.api.get('/finance/expense/detail/salary', { ym }); } catch (e) { throw apiErr(e); }
    let rows: any[] = Array.isArray(res?.rows) ? res.rows : [];
    if (args.employee) {
      const emp = await resolvePayrollEmployee(ctx, args.employee);
      rows = rows.filter((r) => r.id === emp.id);
    }
    const entries = (list: any) => (Array.isArray(list) ? list : []).map((x: any) => `${fmtDateRu(String(x.date).slice(0, 10))}: ${money(x.amount)}${x.note ? ` (${x.note})` : ''}`);
    return {
      month: ymRu(ym),
      ...(res?.cards ? { totals: { fund: money(res.cards.fund), paid: money(res.cards.paid), toPay: money(res.cards.toPay), fines: money(res.cards.fines), bonuses: money(res.cards.bonuses), advances: money(res.cards.advances) } } : {}),
      employees: rows.slice(0, 40).map((r) => ({
        ref: ctx.refs.add('S', r.id, r.name),
        name: r.name,
        salary: money(r.salary), bonus: money(r.bonus), advance: money(r.advance), fine: money(r.fine),
        paid: money(r.paid), toPay: money(r.toPay),
        ...(r.fineEntries?.length ? { fines: entries(r.fineEntries) } : {}),
        ...(r.bonusEntries?.length ? { bonuses: entries(r.bonusEntries) } : {}),
        ...(r.status === 'fired' ? { fired: true } : {}),
      })),
    };
  },
};

// ─── Штраф / премия / удержание за отпуск ──────────────────────────────

type AccrualKind = 'fine' | 'bonus' | 'vacation';
const ACCRUAL_RU: Record<AccrualKind, { title: string; emoji: string; word: string }> = {
  fine: { title: 'ШТРАФ сотруднику', emoji: '⚠️', word: 'Штраф' },
  bonus: { title: 'ПРЕМИЯ сотруднику', emoji: '🎁', word: 'Премия' },
  vacation: { title: 'УДЕРЖАНИЕ за отпуск', emoji: '🏖', word: 'Удержание за отпуск' },
};

interface AccrualArgs { employee: string; kind: AccrualKind; amount: number; date?: string; date_to?: string; reason?: string }

async function prepareAccrual(args: AccrualArgs, ctx: ToolContext) {
  if (!ACCRUAL_RU[args.kind]) throw new ToolError('Вид: штраф, премия или удержание за отпуск.');
  const emp = await resolvePayrollEmployee(ctx, args.employee);
  const amount = checkAmount(args.amount);
  const date = args.date ? checkDate(args.date) : ctx.today;
  const dateTo = args.kind === 'vacation' && args.date_to ? checkDate(args.date_to) : null;
  if (dateTo && dateTo < date) throw new ToolError('Конец отпуска раньше начала.');
  const reason = String(args.reason || '').trim().slice(0, 300);
  const ym = date.slice(0, 7);
  const k = ACCRUAL_RU[args.kind];
  const preview = `${k.emoji} ${k.title}\n👤 ${emp.name}\n💵 ${money(amount)} — в зарплату за ${ymRu(ym)}`
    + `\n📅 ${fmtDateRu(date)}${dateTo ? ` — ${fmtDateRu(dateTo)}` : ''}`
    + (reason ? `\n📝 ${reason}` : '')
    + (args.kind !== 'vacation' ? (emp.userId ? '\n✉️ Сотрудник получит сообщение в Telegram' : '\n✉️ У сотрудника нет привязанной учётки — сообщение не уйдёт') : '');
  return { emp, amount, date, dateTo, reason, ym, preview };
}

export const salaryAccrual: ToolDef<AccrualArgs> = {
  name: 'salary_accrual',
  kind: 'write',
  description:
    'Начислить в зарплату: kind=fine — ШТРАФ («оштрафуй Мухаммадамина на 500 за опоздание»), kind=bonus — ПРЕМИЯ/бонус '
    + '(«дай премию Фарзоне 300»), kind=vacation — удержание за отпуск с date по date_to. Деньги со счёта не списывает: '
    + 'это строка в ведомости. Это НЕ расход компании — record_operation для этого не используй.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Сотрудник: метка E… из контекста, S… или имя как прозвучало.' },
      kind: { type: 'string', enum: ['fine', 'bonus', 'vacation'] },
      amount: { type: 'number', description: 'Сумма в сомони.' },
      date: { type: 'string', description: 'Дата ГГГГ-ММ-ДД (для отпуска — начало). По умолчанию сегодня.' },
      date_to: { type: 'string', description: 'Только для отпуска — конец, ГГГГ-ММ-ДД.' },
      reason: { type: 'string', description: 'Причина, если названа («опоздание», «за отличную съёмку»).' },
    },
    required: ['employee', 'kind', 'amount'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareAccrual(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareAccrual(args, ctx);
    const listKey = args.kind === 'fine' ? 'fineEntries' : args.kind === 'bonus' ? 'bonusEntries' : 'vacationEntries';
    const body: Record<string, any> = { kind: args.kind, ym: p.ym, amount: p.amount };
    if (args.kind === 'vacation') { body.dateFrom = p.date; body.dateTo = p.dateTo || p.date; } else body.date = p.date;
    if (p.reason) body.note = p.reason;

    // Запись создаёт сервер (id — его); чтобы отменить, сравниваем журнал до и после.
    const before = new Set(((await payrollRaw(ctx, p.emp.id))?.[listKey]?.[p.ym] || []).map((x: any) => x.id));
    let saved: any;
    try { saved = await ctx.api.post(`/finance/employees/${p.emp.id}/deduction`, body); } catch (e) { throw apiErr(e); }
    const after: any[] = saved?.[listKey]?.[p.ym] || [];
    const entry = after.find((x) => !before.has(x.id));
    const k = ACCRUAL_RU[args.kind];

    const dateText = `${fmtDateRu(p.date)}${p.dateTo ? ` — ${fmtDateRu(p.dateTo)}` : ''}`;
    const notify = args.kind !== 'vacation' && p.emp.userId
      ? [{
        userId: p.emp.userId,
        text: `<b>${k.emoji} ${k.word}: ${esc(money(p.amount))}</b>\n📅 ${esc(dateText)} · зарплата за ${esc(ymRu(p.ym))}${p.reason ? `\n📝 ${esc(p.reason)}` : ''}`,
      }]
      : undefined;
    return {
      summary: `${k.emoji} ${k.word} ${p.emp.name}: ${money(p.amount)} за ${dateText}${p.reason ? ` — ${p.reason}` : ''}${notify ? ' · сотруднику отправлено сообщение' : ''}`,
      undo: entry ? [{ method: 'DELETE', path: `/finance/employees/${p.emp.id}/deduction/${entry.id}?kind=${args.kind}&ym=${p.ym}` }] : undefined,
      notify,
      undoNotify: notify && p.emp.userId
        ? [{ userId: p.emp.userId, text: `↩️ ${k.word} ${esc(money(p.amount))} от ${esc(dateText)} отменён(а).` }]
        : undefined,
    };
  },
};

async function payrollRaw(ctx: ToolContext, id: string): Promise<any | null> {
  try {
    const list = await ctx.api.get<any[]>('/finance/employees');
    return (list || []).find((e) => e.id === id) || null;
  } catch { return null; }
}

// ─── Выдать деньги: аванс / зарплата / бонус ───────────────────────────

const PAYOUT_RU: Record<'advance' | 'salary' | 'bonus', { marker: string; title: string }> = {
  advance: { marker: 'Аванс', title: 'ВЫДАТЬ АВАНС' },
  salary: { marker: 'Зарплата', title: 'ВЫПЛАТИТЬ ЗАРПЛАТУ' },
  bonus: { marker: 'Бонус', title: 'ВЫПЛАТИТЬ БОНУС' },
};

const ACCOUNT_ALIASES: Record<string, string[]> = {
  cash: ['нал', 'наличн', 'кэш', 'кеш', 'касс'],
  alif: ['алиф', 'alif'],
  dushanbe_city: ['душанбе сити', 'dushanbe city', 'дс банк', 'сити'],
};

async function resolveAccount(ctx: ToolContext, spoken: unknown): Promise<{ id: string; name: string }> {
  let list: any[] = [];
  try { list = (await ctx.api.get<any[]>('/finance/accounts')) || []; } catch (e) { throw apiErr(e); }
  const active = list.filter((a) => !a.archived);
  const s = norm(spoken);
  if (!s) throw new ToolError(`С какого счёта? Счета: ${active.map((a) => a.name).join(', ')}. Уточните через ask_choice.`);
  const byAlias = active.filter((a) => (ACCOUNT_ALIASES[a.key] || []).some((al) => s.includes(al)));
  if (byAlias.length === 1) return { id: byAlias[0].id, name: byAlias[0].name };
  const sc = active.map((a) => ({ a, v: matchScore(a.name, s) })).filter((x) => x.v >= 0.5).sort((x, y) => y.v - x.v);
  if (sc.length === 1 || (sc.length > 1 && sc[0].v > sc[1].v)) return { id: sc[0].a.id, name: sc[0].a.name };
  throw new ToolError(`Не понял, какой счёт: «${spoken}». Счета: ${active.map((a) => a.name).join(', ')}. Уточните через ask_choice.`);
}

interface PayoutArgs { employee: string; kind: 'advance' | 'salary' | 'bonus'; amount: number; account: string; month?: string; date?: string; note?: string }

async function preparePayout(args: PayoutArgs, ctx: ToolContext) {
  const k = PAYOUT_RU[args.kind];
  if (!k) throw new ToolError('Что выдать: аванс, зарплату или бонус?');
  const emp = await resolvePayrollEmployee(ctx, args.employee);
  const amount = checkAmount(args.amount);
  const acc = await resolveAccount(ctx, args.account);
  const date = args.date ? checkDate(args.date) : ctx.today;
  const ym = args.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(args.month) ? args.month : ctx.today.slice(0, 7);
  let cats: any[] = [];
  try { cats = (await ctx.api.get<any[]>('/finance/categories')) || []; } catch (e) { throw apiErr(e); }
  const salaryCat = cats.find((c) => c.key === 'salary');
  if (!salaryCat) throw new ToolError('В финансах нет статьи «Зарплата» — проведите выплату на сайте.');
  const note = String(args.note || '').trim();
  return {
    emp, amount, acc, date, ym, salaryCat, note,
    preview: `💸 ${k.title}\n👤 ${emp.name}\n💵 ${money(amount)} со счёта ${acc.name}\n🗓 за ${ymRu(ym)} · выплата ${fmtDateRu(date)}${note ? `\n📝 ${note}` : ''}`,
  };
}

export const salaryPayout: ToolDef<PayoutArgs> = {
  name: 'salary_payout',
  kind: 'write',
  description:
    'Выдать сотруднику деньги со счёта: аванс («выдай аванс Фирузу 1000 с Алифа»), зарплату («выплати зарплату Сабрине за октябрь»), '
    + 'бонус. Нужны сотрудник, сумма и счёт. Начислить премию/штраф без выдачи денег — это salary_accrual.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… / S… или имя.' },
      kind: { type: 'string', enum: ['advance', 'salary', 'bonus'] },
      amount: { type: 'number', description: 'Сумма в сомони.' },
      account: { type: 'string', description: 'Счёт: Алиф / Dushanbe City / наличные.' },
      month: { type: 'string', description: 'За какой месяц, ГГГГ-ММ. По умолчанию текущий.' },
      date: { type: 'string', description: 'Дата выплаты ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      note: { type: 'string' },
    },
    required: ['employee', 'kind', 'amount', 'account'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePayout(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePayout(args, ctx);
    const marker = PAYOUT_RU[args.kind].marker;
    let tx: any;
    try {
      tx = await ctx.api.post('/finance/operations', {
        type: 'expense', amount: p.amount, date: p.date, accountId: p.acc.id, salaryYm: p.ym,
        // Тип выплаты сайт узнаёт по началу комментария («Аванс»/«Зарплата»/«Бонус»).
        categoryId: p.salaryCat.id, employeeId: p.emp.id, comment: p.note ? `${marker} — ${p.note}` : marker,
      });
    } catch (e) { throw apiErr(e); }
    return {
      summary: `💸 ${marker} ${p.emp.name}: ${money(p.amount)} со счёта ${p.acc.name}, за ${ymRu(p.ym)}`,
      undo: tx?.id ? [{ method: 'DELETE', path: `/finance/transactions/${tx.id}` }] : undefined,
    };
  },
};

export const SALARY_TOOLS: ToolDef[] = [salarySheet, salaryAccrual, salaryPayout];

/** Слова зарплатных действий — по ним ловим подмену «штрафа» расходом. */
export const SALARY_WORDS = /штраф|оштраф|ашраф|премир|преми[яюи]|бонус|аванс|зарплат|зарплат|отпускн|удерж|ҷарима|чарима|мукофот|маош/i;
