import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { checkDate, fmtDateRu, matchScore, nameScore, norm } from './common';
import { ToolContext, ToolDef, ToolError, UndoStep, WriteOutcome } from './types';

/**
 * Финансы, часть 3 — всё через собственный API, как кнопки сайта:
 *  • рассрочки: платёж сотрудника (удержано из ЗП / деньги на счёт) и платёж банку;
 *  • статьи (категории) доходов и расходов;
 *  • инвентарь (оборудование, амортизация);
 *  • корректировки прогноза;
 *  • закрытие и повторное открытие зарплатного месяца.
 * Только у кого finance.manage. Деньги и необратимое — через «Подтвердить»
 * с крупной первой строкой. Отмена — только там, где она честно возвращает как было.
 */

const finance = (u: any) => hasGrant(u, 'finance.manage');
const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n: unknown) => `${r2(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом.`;
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ymRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const ymGen = (ym: string) => `${MONTHS_GEN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dateRu = (d: string | null | undefined) => (d ? fmtDateRu(String(d).slice(0, 10)) : 'без срока');
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function checkYm(v: unknown, what = 'Месяц'): string {
  const s = String(v ?? '').trim();
  if (!YM_RE.test(s)) throw new ToolError(`${what} «${s}» не понял. Нужно ГГГГ-ММ.`);
  return s;
}

function checkAmount(v: unknown, allowZero = false): number {
  const n = r2(v);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n <= 0) || n > 100_000_000) {
    throw new ToolError(allowZero ? 'Сумма не может быть отрицательной.' : 'Сумма должна быть больше нуля.');
  }
  return n;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw apiErr(e); }
}

// ─── Счета ───────────────────────────────────────────────────────────────

const ACCOUNT_ALIASES: Record<string, string[]> = {
  cash: ['нал', 'наличн', 'кэш', 'кеш', 'касс'],
  alif: ['алиф', 'alif'],
  dushanbe_city: ['душанбе сити', 'dushanbe city', 'дс банк', 'сити'],
};

async function resolveAccount(ctx: ToolContext, spoken: unknown): Promise<{ id: string; name: string }> {
  const list = (await call(ctx.api.get<any[]>('/finance/accounts'))) || [];
  const active = list.filter((a) => !a.archived);
  const names = active.map((a) => a.name).join(', ');
  const s = norm(spoken);
  if (!s) throw new ToolError(`Какой счёт? Счета: ${names}. Уточните через ask_choice.`);
  const byAlias = active.filter((a) => (ACCOUNT_ALIASES[a.key] || []).some((al) => s.includes(al)));
  if (byAlias.length === 1) return { id: byAlias[0].id, name: byAlias[0].name };
  const scored = active.map((a) => ({ a, sc: matchScore(a.name, s) })).filter((x) => x.sc >= 0.5).sort((x, y) => y.sc - x.sc);
  if (scored.length === 1 || (scored.length > 1 && scored[0].sc > scored[1].sc)) return { id: scored[0].a.id, name: scored[0].a.name };
  throw new ToolError(`Не понял, какой счёт: «${spoken}». Счета: ${names}. Уточните через ask_choice.`);
}

/** Сущность по метке X (с префиксом в подписи) или по названию. */
function pickByRefOrName<T extends { id: string }>(
  ctx: ToolContext, spoken: unknown, prefix: string, list: T[], nameOf: (x: T) => string, what: string,
): T {
  const entry = ctx.refs.resolve('X', spoken);
  if (entry && entry.label.startsWith(`${prefix}|`)) {
    const hit = list.find((x) => x.id === entry.id);
    if (hit) return hit;
    throw new ToolError(`${what} не найден(а) — возможно, уже удалён(а). Покажите список заново.`);
  }
  const s = String(spoken ?? '').trim();
  if (!norm(s)) throw new ToolError(`Какой(ая) ${what}? Назовите или возьмите метку из списка.`);
  const scored = list.map((x) => ({ x, sc: matchScore(nameOf(x), s) })).filter((v) => v.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!scored.length) throw new ToolError(`Не нашёл: «${s}». Есть: ${list.slice(0, 15).map(nameOf).join(', ') || 'пусто'}.`);
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    throw new ToolError(`Подходит несколько: ${scored.slice(0, 6).map((v) => nameOf(v.x)).join(', ')}. Уточните через ask_choice.`);
  }
  return scored[0].x;
}

// ═══ 1. Рассрочки ═══════════════════════════════════════════════════════

const ENTRY_STATUS_RU: Record<string, string> = {
  planned: 'ожидается', overdue: 'просрочен', waiting: 'ждёт выплаты зарплаты', done: 'закрыт', skip: 'пропущен',
};
const isSeparate = (row: any) => row?.installment?.method === 'separate';

/** Платёж месяца можно закрывать, пока он не оплачен: «отдельно» — всегда,
 *  «из зарплаты» — пока зарплата месяца не выплачена и период открыт (как на сайте). */
function entryPayable(row: any, entry: any, openYm: string): boolean {
  if (row.done || entry.status === 'done' || entry.status === 'skip') return false;
  return isSeparate(row) || (!entry.frozen && entry.ym >= openYm);
}

const loadBoard = (ctx: ToolContext) => call(ctx.api.get<any>('/finance/installments'));

export const installmentPayments: ToolDef<{ only_overdue?: boolean; side?: 'employees' | 'banks' }> = {
  name: 'installment_payments',
  kind: 'read',
  description:
    'Ближайшие платежи по рассрочкам: сотрудник возвращает компании (удержание из зарплаты 10-го или платит отдельно) '
    + 'и компания платит банку. «Какие ближайшие платежи по рассрочкам», «что мы должны банку по рассрочке», «кто просрочил рассрочку». '
    + 'Возвращает метки (B…) для installment_pay. Общую картину и остатки даёт finance_installments.',
  parameters: {
    type: 'object',
    properties: {
      only_overdue: { type: 'boolean', description: 'Только просроченные.' },
      side: { type: 'string', enum: ['employees', 'banks'], description: 'Только платежи сотрудников или только платежи банку.' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const board = await loadBoard(ctx);
    const employees: any[] = [];
    if (args.side !== 'banks') {
      for (const row of board?.rows || []) {
        if (row.done) continue;
        const open = (row.schedule || []).filter((e: any) => e.status !== 'done' && e.status !== 'skip');
        const picked = open.filter((e: any) => !args.only_overdue || e.status === 'overdue').slice(0, 3);
        for (const e of picked) {
          employees.push({
            ref: ctx.refs.add('B', row.installment.id, `рассрочка ${row.installment.name} · ${row.employee?.name || 'сотрудник'}`),
            month: e.ym,
            employee: row.employee?.name || 'сотрудник',
            name: row.installment.name,
            method: isSeparate(row) ? 'платит отдельно' : 'удерживаем из зарплаты',
            date: dateRu(e.date),
            amount: money(e.outstanding),
            status: ENTRY_STATUS_RU[e.status] || e.status,
            canPay: entryPayable(row, e, board.latestOpenYm),
          });
        }
      }
    }
    const banks: any[] = [];
    if (args.side !== 'employees') {
      for (const b of board?.banks || []) {
        if (b.done) continue;
        const open = (b.plan || []).filter((p: any) => !p.paid).filter((p: any) => !args.only_overdue || p.overdue).slice(0, 3);
        for (const p of open) {
          banks.push({
            ref: ctx.refs.add('B', p.id, `платёж банку ${b.bank || ''} · ${b.name}`.trim()),
            bank: b.bank || 'банк',
            name: b.name,
            date: dateRu(p.date),
            amount: money(p.amount),
            status: p.overdue ? 'просрочен' : 'ожидается',
            bankRemaining: money(b.remaining),
          });
        }
      }
    }
    return { today: dateRu(board?.today), employees, banks };
  },
};

interface PayInstallmentArgs {
  payment: string; side?: 'employee' | 'bank'; month?: string; account?: string; amount?: number; date?: string; note?: string;
}

type PreparedPayInstallment =
  | { preview: string; kind: 'mark'; row: any; entry: any }
  | { preview: string; kind: 'cash'; row: any; entry: any; body: Record<string, any>; amount: number }
  | { preview: string; kind: 'bank'; bank: any; pp: any; body: Record<string, any>; full: boolean };

async function findInstallmentTarget(ctx: ToolContext, board: any, spoken: unknown, side?: 'employee' | 'bank') {
  const rows: any[] = board?.rows || [];
  const banks: any[] = board?.banks || [];
  const ref = ctx.refs.resolve('B', spoken);
  if (ref) {
    const row = rows.find((r) => r.installment.id === ref.id);
    const bankPp = banks.map((b) => ({ b, p: (b.plan || []).find((p: any) => p.id === ref.id) })).find((x) => x.p);
    if (row && (!side || side === 'employee')) return { row };
    if (bankPp && (!side || side === 'bank')) return { bank: bankPp.b, pp: bankPp.p };
    if (row && side === 'bank') {
      const bank = banks.find((b) => b.installmentId === row.installment.id);
      const pp = bank?.next ? (bank.plan || []).find((p: any) => p.id === bank.next.id) : null;
      if (bank && pp) return { bank, pp };
    }
    throw new ToolError('Не нашёл такой платёж по рассрочке — возможно, он уже закрыт. Покажите платежи заново (installment_payments).');
  }
  // По словам: имя сотрудника или название рассрочки.
  const s = String(spoken ?? '').trim();
  if (!norm(s)) throw new ToolError('Какая рассрочка? Назовите сотрудника или возьмите метку из installment_payments.');
  const rowHits = rows.filter((r) => !r.done && Math.max(
    nameScore(r.employee?.name || '', s), nameScore(s, r.employee?.name || ''), matchScore(r.installment.name, s),
  ) >= 0.5);
  const bankHits = banks.filter((b) => !b.done && matchScore(`${b.name} ${b.bank || ''}`, s) >= 0.5);
  if (side === 'employee') {
    if (rowHits.length === 1) return { row: rowHits[0] };
  } else if (side === 'bank') {
    if (bankHits.length === 1) {
      const pp = bankHits[0].next ? (bankHits[0].plan || []).find((p: any) => p.id === bankHits[0].next.id) : null;
      if (pp) return { bank: bankHits[0], pp };
    }
  } else if (rowHits.length === 1 && !bankHits.length) return { row: rowHits[0] };
  else if (bankHits.length === 1 && !rowHits.length) {
    const pp = bankHits[0].next ? (bankHits[0].plan || []).find((p: any) => p.id === bankHits[0].next.id) : null;
    if (pp) return { bank: bankHits[0], pp };
  }
  if (rowHits.length + bankHits.length > 1 || (rowHits.length && bankHits.length)) {
    throw new ToolError(
      `Под «${s}» подходит несколько платежей (сотрудник платит нам и/или мы платим банку). Покажите их через installment_payments и возьмите метку, либо уточните через ask_choice.`,
    );
  }
  throw new ToolError(`Не нашёл рассрочку «${s}». Покажите платежи через installment_payments.`);
}

async function preparePayInstallment(args: PayInstallmentArgs, ctx: ToolContext): Promise<PreparedPayInstallment> {
  const board = await loadBoard(ctx);
  const target = await findInstallmentTarget(ctx, board, args.payment, args.side);
  const date = args.date ? checkDate(args.date) : ctx.today;
  if (date > ctx.today) throw new ToolError('Будущий платёж не записываю — только тот, что уже состоялся.');
  const note = String(args.note || '').trim().slice(0, 300);

  if (target.bank && target.pp) {
    const { bank, pp } = target;
    if (pp.paid) throw new ToolError('Этот платёж банку уже оплачен.');
    const planned = r2(pp.amount);
    const amount = args.amount != null ? checkAmount(args.amount) : Math.min(planned, r2(bank.remaining));
    if (amount > planned + 0.005) throw new ToolError(`Больше платежа по графику (${money(planned)}) нельзя.`);
    if (amount > r2(bank.remaining) + 0.005) throw new ToolError(`Банку осталось отдать только ${money(bank.remaining)}.`);
    const acc = await resolveAccount(ctx, args.account);
    const full = amount >= planned - 0.005;
    const body: Record<string, any> = { accountId: acc.id, date };
    if (!full) body.amount = amount;
    return {
      kind: 'bank', bank, pp, body, full,
      preview: `🏦 ОПЛАТИТЬ БАНКУ ${money(amount)}\n${bank.name} · ${bank.bank || 'банк'}\n📅 По графику: ${dateRu(pp.date)}${pp.overdue ? ' (просрочен)' : ''} · оплата ${dateRu(date)}\n`
        + `💳 Со счёта: ${acc.name}\n`
        + (full ? `Банку останется отдать: ${money(Math.max(0, r2(bank.remaining) - amount))}` : `Остаток ${money(planned - amount)} останется в графике на ${dateRu(pp.date)}.`),
    };
  }

  const row = target.row;
  if (row.done) throw new ToolError(`Рассрочка «${row.installment.name}» уже полностью закрыта.`);
  const month = args.month ? checkYm(args.month) : row.next?.ym;
  const entry = (row.schedule || []).find((e: any) => e.ym === month);
  if (!entry) throw new ToolError(`В графике «${row.installment.name}» нет платежа за ${month ? ymRu(month) : 'этот месяц'}.`);
  if (entry.status === 'done') throw new ToolError(`Платёж за ${ymRu(entry.ym)} по «${row.installment.name}» уже закрыт.`);
  if (entry.status === 'skip') throw new ToolError(`Месяц ${ymRu(entry.ym)} в этой рассрочке пропущен.`);
  if (!entryPayable(row, entry, board.latestOpenYm)) {
    throw new ToolError(`Платёж за ${ymRu(entry.ym)} уже нельзя отметить: зарплата за этот месяц выплачена или период закрыт.`);
  }
  const who = `${row.employee?.name || 'сотрудник'} · ${row.installment.name}`;

  const useCash = isSeparate(row) || !!args.account;
  if (!useCash) {
    return {
      kind: 'mark', row, entry,
      preview: `✅ УДЕРЖАНО ИЗ ЗАРПЛАТЫ ${money(entry.outstanding)}\n${who}\n🗓 Платёж за ${ymRu(entry.ym)} (по графику ${dateRu(entry.date)})\n`
        + 'Деньги по счетам не двигаются: платёж просто отмечается удержанным.',
    };
  }
  const amount = args.amount != null ? checkAmount(args.amount) : r2(entry.outstanding);
  if (amount > r2(row.remaining) + 0.005) throw new ToolError(`Больше остатка рассрочки (${money(row.remaining)}) нельзя.`);
  const acc = await resolveAccount(ctx, args.account);
  const body: Record<string, any> = { amount, date, accountId: acc.id, ym: entry.ym };
  if (note) body.note = note;
  return {
    kind: 'cash', row, entry, body, amount,
    preview: `💵 ПРИНЯТЬ ПЛАТЁЖ ПО РАССРОЧКЕ ${money(amount)}\n${who}\n🗓 За ${ymRu(entry.ym)} · внесли ${dateRu(date)}\n`
      + `🏦 Деньги придут на счёт: ${acc.name} (доход «Возврат долга»)`
      + `\nОстаток рассрочки после платежа: ${money(Math.max(0, r2(row.remaining) - amount))}`,
  };
}

export const installmentPay: ToolDef<PayInstallmentArgs> = {
  name: 'installment_pay',
  kind: 'write',
  description:
    'Оплатить очередной платёж рассрочки, как кнопки на странице «Рассрочки». Три случая: '
    + '(1) рассрочка сотрудника «из зарплаты» — «отметь удержанным платёж Фарзоны за октябрь» (деньги не двигаются, счёт не нужен); '
    + '(2) сотрудник принёс деньги — «Фирдавс внёс 1000 наличными за рассрочку» (нужен account, деньги приходят на счёт); '
    + '(3) компания платит банку — «оплатили банку по рассрочке Алиф 1000 с Алифа» (side=bank, нужен account). '
    + 'Метку (B…) бери из installment_payments. НЕ для долгов (pay_debt), НЕ для штрафов и зарплаты (salary_*).',
  parameters: {
    type: 'object',
    properties: {
      payment: { type: 'string', description: 'Метка (B…) из installment_payments или имя сотрудника/название рассрочки.' },
      side: { type: 'string', enum: ['employee', 'bank'], description: 'employee — платёж сотрудника компании; bank — платёж компании банку. Нужен, если по имени подходят оба.' },
      month: { type: 'string', description: 'Только для платежа сотрудника: месяц ГГГГ-ММ. По умолчанию ближайший.' },
      account: { type: 'string', description: 'Счёт: Алиф / Dushanbe City / наличные. Нужен для платежа банку и для денег от сотрудника; для удержания из зарплаты НЕ нужен.' },
      amount: { type: 'number', description: 'Сумма, сомони. По умолчанию весь платёж по графику; меньше — частичный.' },
      date: { type: 'string', description: 'Дата платежа ГГГГ-ММ-ДД, по умолчанию сегодня (не будущее).' },
      note: { type: 'string' },
    },
    required: ['payment'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePayInstallment(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePayInstallment(args, ctx);
    if (p.kind === 'mark') {
      await call(ctx.api.post(`/finance/installments/${p.row.installment.id}/mark`, { ym: p.entry.ym, on: true }));
      return {
        summary: `✅ ${p.row.employee?.name || 'Сотрудник'}: «${p.row.installment.name}» за ${ymRu(p.entry.ym)} — удержано из зарплаты (${money(p.entry.outstanding)})`,
        undo: [{ method: 'POST', path: `/finance/installments/${p.row.installment.id}/mark`, body: { ym: p.entry.ym, on: false } }],
      };
    }
    if (p.kind === 'cash') {
      const before = new Set((p.row.installment.payments || []).map((x: any) => x.id));
      await call(ctx.api.post(`/finance/installments/${p.row.installment.id}/payments`, p.body));
      const after = await loadBoard(ctx);
      const fresh = (after?.rows || []).find((r: any) => r.installment.id === p.row.installment.id);
      const added = ((fresh?.installment?.payments || []) as any[]).filter((x) => !before.has(x.id));
      const undo: UndoStep[] | undefined = added.length === 1
        ? [{ method: 'DELETE', path: `/finance/installments/${p.row.installment.id}/payments/${added[0].id}` }]
        : undefined;
      return {
        summary: `💵 ${p.row.employee?.name || 'Сотрудник'}: платёж по «${p.row.installment.name}» ${money(p.amount)} принят на счёт (за ${ymRu(p.entry.ym)})`,
        undo,
      };
    }
    await call(ctx.api.post(`/finance/planned-payments/${p.pp.id}/receive`, p.body));
    return {
      summary: `🏦 Банку${p.bank.bank ? ` ${p.bank.bank}` : ''} по «${p.bank.name}» оплачено ${money(p.body.amount ?? p.pp.amount)}`,
      // Частичная оплата делит платёж на два — «вернуть как было» одним шагом нельзя.
      undo: p.full ? [{ method: 'POST', path: `/finance/planned-payments/${p.pp.id}/unreceive`, body: {} }] : undefined,
    };
  },
};

// ═══ 2. Статьи (категории) ══════════════════════════════════════════════

const CAT_TYPE_RU: Record<string, string> = { income: 'доход', expense: 'расход', saving: 'накопление', transfer: 'перевод' };
const catRef = (ctx: ToolContext, c: any) => ctx.refs.add('X', c.id, `cat|${c.name}`);
const loadCategories = (ctx: ToolContext) => call(ctx.api.get<any[]>('/finance/categories')).then((l) => l || []);

export const financeCategories: ToolDef<{ type?: 'income' | 'expense' }> = {
  name: 'finance_categories',
  kind: 'read',
  description:
    'Статьи (категории) доходов и расходов: «какие у нас статьи расходов», «есть ли статья Реклама». '
    + 'Системные (системная=true) менять нельзя. Метки (X…) нужны для category_rename и category_delete. Операции журнала — finance_journal.',
  parameters: {
    type: 'object',
    properties: { type: { type: 'string', enum: ['income', 'expense'], description: 'Только доходные или только расходные.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const list = (await loadCategories(ctx)).filter((c) => (args.type ? c.type === args.type : true));
    return {
      count: list.length,
      categories: list.map((c) => ({
        ref: catRef(ctx, c), name: c.name, type: CAT_TYPE_RU[c.type] || c.type, system: !!c.builtin,
      })),
    };
  },
};

export const categoryAdd: ToolDef<{ name: string; type: 'income' | 'expense' }> = {
  name: 'category_add',
  kind: 'write',
  description:
    'Добавить новую статью доходов или расходов: «добавь статью расходов Канцелярия», «заведи статью дохода Консультации». '
    + 'Нужны название и тип (доход или расход) — если тип не сказан, спроси через ask_choice. Это НЕ операция и НЕ счёт.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Название статьи.' },
      type: { type: 'string', enum: ['income', 'expense'] },
    },
    required: ['name', 'type'],
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx): Promise<WriteOutcome> {
    const name = String(args.name || '').trim();
    if (!name) throw new ToolError('Как назвать статью?');
    if (name.length > 120) throw new ToolError('Название статьи слишком длинное (до 120 знаков).');
    if (args.type !== 'income' && args.type !== 'expense') throw new ToolError('Это статья дохода или расхода?');
    const list = await loadCategories(ctx);
    if (list.some((c) => c.type === args.type && norm(c.name) === norm(name))) {
      throw new ToolError(`Статья «${name}» (${CAT_TYPE_RU[args.type]}) уже есть.`);
    }
    const created = await call(ctx.api.post<any>('/finance/categories', { name, type: args.type }));
    return {
      summary: `🗂 Добавлена статья ${args.type === 'income' ? 'доходов' : 'расходов'} «${name}»`,
      undo: created?.id ? [{ method: 'DELETE', path: `/finance/categories/${created.id}` }] : undefined,
    };
  },
};

export const categoryRename: ToolDef<{ category: string; name: string }> = {
  name: 'category_rename',
  kind: 'write',
  description:
    'Переименовать статью доходов/расходов: «переименуй статью Реклама в Маркетинг». Системные статьи (Зарплата, Аренда, Подписки, Долг, SMM…) '
    + 'не трогаем. Метку (X…) бери из finance_categories.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Метка (X…) или название статьи.' },
      name: { type: 'string', description: 'Новое название.' },
    },
    required: ['category', 'name'],
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx): Promise<WriteOutcome> {
    const list = await loadCategories(ctx);
    const cat = pickByRefOrName(ctx, args.category, 'cat', list, (c) => c.name, 'статья');
    if (cat.builtin) throw new ToolError(`«${cat.name}» — системная статья, её не переименовываю (на ней держатся расчёты).`);
    const name = String(args.name || '').trim();
    if (!name) throw new ToolError('Как назвать статью?');
    if (name.length > 120) throw new ToolError('Название статьи слишком длинное (до 120 знаков).');
    if (norm(name) === norm(cat.name) && name === cat.name) throw new ToolError('Название то же самое.');
    if (list.some((c) => c.id !== cat.id && c.type === cat.type && norm(c.name) === norm(name))) {
      throw new ToolError(`Статья «${name}» (${CAT_TYPE_RU[cat.type]}) уже есть.`);
    }
    await call(ctx.api.patch(`/finance/categories/${cat.id}`, { name }));
    return {
      summary: `✏️ Статья «${cat.name}» теперь называется «${name}»`,
      undo: [{ method: 'PATCH', path: `/finance/categories/${cat.id}`, body: { name: cat.name } }],
    };
  },
};

export const categoryDelete: ToolDef<{ category: string }> = {
  name: 'category_delete',
  kind: 'write',
  description:
    'УДАЛИТЬ свою (не системную) статью доходов/расходов: «удали статью Канцелярия». На сайте статьи не архивируются, только удаляются — '
    + 'если просят «в архив/скрыть», объясни это и спроси, удалять ли. Системные статьи не удаляются. Метку (X…) бери из finance_categories.',
  parameters: {
    type: 'object',
    properties: { category: { type: 'string', description: 'Метка (X…) или название статьи.' } },
    required: ['category'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const cat = await prepareCategoryDelete(args, ctx);
    return `🗑 УДАЛИТЬ СТАТЬЮ «${cat.name}»\nТип: ${CAT_TYPE_RU[cat.type] || cat.type}\n⚠ Прежние операции с этой статьёй останутся без статьи. Вернуть удалённую статью кнопкой «Отменить» нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const cat = await prepareCategoryDelete(args, ctx);
    await call(ctx.api.delete(`/finance/categories/${cat.id}`));
    return { summary: `🗑 Статья «${cat.name}» удалена` };
  },
};

async function prepareCategoryDelete(args: { category: string }, ctx: ToolContext) {
  const list = await loadCategories(ctx);
  const cat = pickByRefOrName(ctx, args.category, 'cat', list, (c) => c.name, 'статья');
  if (cat.builtin) throw new ToolError(`«${cat.name}» — системная статья, её удалять нельзя.`);
  return cat;
}

// ═══ 3. Инвентарь ═══════════════════════════════════════════════════════

const ASSET_STATUS_RU: Record<string, string> = { in_use: 'в работе', repair: 'в ремонте', written_off: 'списано', sold: 'продано' };
const ASSET_STATUSES = Object.keys(ASSET_STATUS_RU);
const assetRef = (ctx: ToolContext, a: any) => ctx.refs.add('X', a.id, `asset|${a.name}`);
const loadAssets = (ctx: ToolContext) => call(ctx.api.get<any[]>('/finance/assets')).then((l) => l || []);
const isoDate = (v: unknown, what: string): string => checkDate(v, what);

export const financeAssets: ToolDef<{ search?: string; category?: string; status?: string }> = {
  name: 'finance_assets',
  kind: 'read',
  description:
    'Инвентарь (оборудование, страница «Инвентарь»): что есть, цена, срок службы, амортизация в месяц, остаточная стоимость, у кого, гарантия: '
    + '«что в инвентаре», «сколько стоит наша техника», «где камера Sony», «что в ремонте». Метки (X…) — для asset_update и asset_delete.',
  parameters: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Часть названия, серийного номера или ответственного.' },
      category: { type: 'string', description: 'Категория: Техника, Свет, Звук, Мебель, Реквизит…' },
      status: { type: 'string', enum: ['all', 'active', ...ASSET_STATUSES], description: 'active — в работе и в ремонте (по умолчанию all).' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const all = await loadAssets(ctx);
    const list = all.filter((a) => {
      if (args.category && norm(a.category) !== norm(args.category)) return false;
      if (args.status === 'active' && !(a.status === 'in_use' || a.status === 'repair')) return false;
      if (args.status && args.status !== 'all' && args.status !== 'active' && a.status !== args.status) return false;
      if (args.search) {
        const hay = `${a.name} ${a.serial || ''} ${a.assignee || ''}`;
        if (matchScore(hay, args.search) < 0.5 && !norm(hay).includes(norm(args.search))) return false;
      }
      return true;
    });
    const active = list.filter((a) => a.status === 'in_use' || a.status === 'repair');
    return {
      count: list.length,
      totals: {
        purchaseValue: money(active.reduce((s, a) => s + Number(a.price), 0)),
        residualValue: money(active.reduce((s, a) => s + Number(a.residual), 0)),
        depreciationPerMonth: money(active.reduce((s, a) => s + (a.wornOut ? 0 : Number(a.monthlyDep)), 0)),
      },
      assets: list.slice(0, 60).map((a) => ({
        ref: assetRef(ctx, a),
        name: a.name,
        category: a.category,
        status: ASSET_STATUS_RU[a.status] || a.status,
        price: money(a.price),
        purchaseDate: a.purchaseDate ? dateRu(a.purchaseDate) : null,
        serviceMonths: a.serviceMonths,
        depreciationPerMonth: money(a.monthlyDep),
        residual: money(a.residual),
        ...(a.wornOut ? { wornOut: true } : {}),
        assignee: a.assignee,
        serial: a.serial,
        warrantyUntil: a.warrantyUntil ? dateRu(a.warrantyUntil) : null,
        note: a.note,
      })),
    };
  },
};

interface AssetFields {
  category?: string; purchase_date?: string; price?: number; service_months?: number; status?: string;
  assignee?: string; serial?: string; warranty_until?: string; note?: string;
}

const ASSET_FIELD_PROPS = {
  category: { type: 'string', description: 'Категория: Техника, Свет, Звук, Мебель, Реквизит, Прочее.' },
  purchase_date: { type: 'string', description: 'Дата покупки ГГГГ-ММ-ДД.' },
  price: { type: 'number', description: 'Цена покупки, сомони.' },
  service_months: { type: 'number', description: 'Срок службы в месяцах (0 — не амортизируется).' },
  status: { type: 'string', enum: ASSET_STATUSES, description: 'in_use в работе, repair в ремонте, written_off списано, sold продано.' },
  assignee: { type: 'string', description: 'Кому выдано (ответственный).' },
  serial: { type: 'string', description: 'Серийный номер.' },
  warranty_until: { type: 'string', description: 'Гарантия до, ГГГГ-ММ-ДД.' },
  note: { type: 'string' },
};

/** Поля сайта (DTO) из сказанного; '' очищает необязательное поле. */
function assetBody(args: AssetFields): Record<string, any> {
  const body: Record<string, any> = {};
  const text = (key: keyof AssetFields, dto: string, max: number, what: string) => {
    if (args[key] === undefined) return;
    const v = String(args[key] ?? '').trim();
    if (v.length > max) throw new ToolError(`${what}: слишком длинно (до ${max} знаков).`);
    body[dto] = v === '' ? null : v;
  };
  text('category', 'category', 60, 'Категория');
  text('assignee', 'assignee', 200, 'Ответственный');
  text('serial', 'serial', 120, 'Серийный номер');
  text('note', 'note', 2000, 'Заметка');
  if (args.purchase_date !== undefined) body.purchaseDate = String(args.purchase_date) === '' ? null : isoDate(args.purchase_date, 'дата покупки');
  if (args.warranty_until !== undefined) body.warrantyUntil = String(args.warranty_until) === '' ? null : isoDate(args.warranty_until, 'дата гарантии');
  if (args.price !== undefined) body.price = checkAmount(args.price, true);
  if (args.service_months !== undefined) {
    const m = Math.round(Number(args.service_months));
    if (!Number.isFinite(m) || m < 0 || m > 1200) throw new ToolError('Срок службы — число месяцев от 0 до 1200.');
    body.serviceMonths = m;
  }
  if (args.status !== undefined) {
    if (!ASSET_STATUSES.includes(args.status)) throw new ToolError(`Статус: ${ASSET_STATUSES.join(', ')}.`);
    body.status = args.status;
  }
  return body;
}

const assetLine = (a: any) => `${a.name}${a.category ? ` · ${a.category}` : ''} · ${money(a.price)}`;

export const assetCreate: ToolDef<AssetFields & { name: string }> = {
  name: 'asset_create',
  kind: 'write',
  description:
    'Добавить оборудование в инвентарь: «добавь в инвентарь камеру Sony A7 за 25000, срок службы 4 года, у Бехруза». '
    + 'Только запись в учёт: деньги со счёта НЕ списываются и расход не создаётся (покупку проводят отдельно через record_operation).',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Название позиции.' }, ...ASSET_FIELD_PROPS },
    required: ['name'],
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx): Promise<WriteOutcome> {
    const name = String(args.name || '').trim();
    if (!name) throw new ToolError('Как называется позиция?');
    if (name.length > 200) throw new ToolError('Название слишком длинное (до 200 знаков).');
    const body: Record<string, any> = { name, ...assetBody(args) };
    for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
    const created = await call(ctx.api.post<any>('/finance/assets', body));
    return {
      summary: `📦 В инвентарь добавлено: ${assetLine(created ?? { ...body, price: body.price ?? 0 })}`
        + (created && created.monthlyDep ? ` · амортизация ${money(created.monthlyDep)}/мес` : ''),
      undo: created?.id ? [{ method: 'DELETE', path: `/finance/assets/${created.id}` }] : undefined,
    };
  },
};

interface AssetUpdateArgs extends AssetFields { asset: string; name?: string }

async function prepareAssetUpdate(args: AssetUpdateArgs, ctx: ToolContext) {
  const list = await loadAssets(ctx);
  const asset = pickByRefOrName(ctx, args.asset, 'asset', list, (a) => a.name, 'позиция инвентаря');
  const body = assetBody(args);
  if (args.name !== undefined) {
    const n = String(args.name).trim();
    if (!n) throw new ToolError('Название не может быть пустым.');
    if (n.length > 200) throw new ToolError('Название слишком длинное (до 200 знаков).');
    body.name = n;
  }
  if (!Object.keys(body).length) throw new ToolError('Что изменить в этой позиции?');
  const changed = Object.keys(body).filter((k) => (asset[k] ?? null) !== body[k] && !(k === 'price' && Number(asset.price) === body.price));
  if (!changed.length) throw new ToolError('Всё уже так и записано — менять нечего.');
  const prev: Record<string, any> = {};
  for (const k of changed) prev[k] = asset[k] ?? null;
  return { asset, body: Object.fromEntries(changed.map((k) => [k, body[k]])), prev };
}

const FIELD_RU: Record<string, string> = {
  name: 'название', category: 'категория', purchaseDate: 'дата покупки', price: 'цена', serviceMonths: 'срок службы, мес',
  status: 'статус', assignee: 'ответственный', serial: 'серийный номер', warrantyUntil: 'гарантия до', note: 'заметка',
};
const showVal = (k: string, v: any) => {
  if (v === null || v === undefined || v === '') return 'пусто';
  if (k === 'status') return ASSET_STATUS_RU[v] || v;
  if (k === 'price') return money(v);
  if (k === 'purchaseDate' || k === 'warrantyUntil') return dateRu(v);
  return String(v);
};

export const assetUpdate: ToolDef<AssetUpdateArgs> = {
  name: 'asset_update',
  kind: 'write',
  description:
    'Изменить позицию инвентаря: переименовать, цена, срок службы, кому выдано, серийный номер, гарантия. А также СПИСАТЬ или пометить '
    + 'ПРОДАННОЙ / В РЕМОНТЕ / вернуть в работу через status: «спиши камеру Sony» → status=written_off, «камера в ремонте» → repair. '
    + 'Списание — это смена статуса (позиция остаётся в истории), а не удаление: удалить совсем — asset_delete. Метку (X…) бери из finance_assets. '
    + 'Чтобы очистить поле, передай пустую строку.',
  parameters: {
    type: 'object',
    properties: {
      asset: { type: 'string', description: 'Метка (X…) или название позиции.' },
      name: { type: 'string', description: 'Новое название.' },
      ...ASSET_FIELD_PROPS,
    },
    required: ['asset'],
    additionalProperties: false,
  },
  available: finance,
  // Списание/продажа и смена цены меняют итоги стоимости — спрашиваем.
  confirm: (args) => args.status === 'written_off' || args.status === 'sold' || args.price !== undefined,
  async preview(args, ctx) {
    const p = await prepareAssetUpdate(args, ctx);
    const title = p.body.status === 'written_off' ? '🗑 СПИСАТЬ ИЗ ИНВЕНТАРЯ'
      : p.body.status === 'sold' ? '💰 ПОМЕТИТЬ ПРОДАННЫМ' : '✏️ ИЗМЕНИТЬ ПОЗИЦИЮ ИНВЕНТАРЯ';
    const lines = Object.keys(p.body).map((k) => `• ${FIELD_RU[k] || k}: ${showVal(k, p.prev[k])} → ${showVal(k, p.body[k])}`);
    return `${title}\n📦 ${assetLine(p.asset)}\n${lines.join('\n')}`
      + (p.body.status === 'written_off' || p.body.status === 'sold' ? '\nОстаточная стоимость станет 0, позиция останется в истории.' : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareAssetUpdate(args, ctx);
    const saved = await call(ctx.api.patch<any>(`/finance/assets/${p.asset.id}`, p.body));
    const list = Object.keys(p.body).map((k) => `${FIELD_RU[k] || k}: ${showVal(k, p.body[k])}`).join(', ');
    return {
      summary: `📦 ${saved?.name || p.asset.name}: ${list}`,
      undo: [{ method: 'PATCH', path: `/finance/assets/${p.asset.id}`, body: p.prev }],
    };
  },
};

export const assetDelete: ToolDef<{ asset: string }> = {
  name: 'asset_delete',
  kind: 'write',
  description:
    'УДАЛИТЬ позицию из инвентаря совсем (история не сохранится): «удали из инвентаря старую лампу». Для выбывшей техники лучше asset_update '
    + 'со status=written_off («спиши») — удаляй только если человек именно просит удалить. Метку (X…) бери из finance_assets.',
  parameters: {
    type: 'object',
    properties: { asset: { type: 'string', description: 'Метка (X…) или название позиции.' } },
    required: ['asset'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const a = pickByRefOrName(ctx, args.asset, 'asset', await loadAssets(ctx), (x) => x.name, 'позиция инвентаря');
    return `🗑 УДАЛИТЬ ИЗ ИНВЕНТАРЯ\n📦 ${assetLine(a)}\n⚠ История позиции не сохранится, отменить нельзя. Для выбывшей техники лучше «списать».`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const a = pickByRefOrName(ctx, args.asset, 'asset', await loadAssets(ctx), (x) => x.name, 'позиция инвентаря');
    await call(ctx.api.delete(`/finance/assets/${a.id}`));
    return { summary: `🗑 «${a.name}» удалена из инвентаря` };
  },
};

// ═══ 4. Корректировки прогноза ══════════════════════════════════════════

const SCENARIO_RU: Record<string, string> = { all: 'все сценарии', base: 'базовый', conservative: 'осторожный', optimistic: 'оптимистичный' };
const SCENARIOS = Object.keys(SCENARIO_RU);
const ADJ_TYPE_RU: Record<string, string> = { income: 'доход', expense: 'расход' };
const adjRef = (ctx: ToolContext, a: any) => ctx.refs.add('X', a.id, `adj|${a.name}`);
const loadAdjustments = (ctx: ToolContext) => call(ctx.api.get<any[]>('/finance/forecast/adjustments')).then((l) => l || []);

function adjText(a: any): string {
  const when = a.recurrence === 'monthly'
    ? `каждый месяц с ${ymGen(a.startYm)}${a.endYm ? ` по ${ymRu(a.endYm)}` : ' без конца'}`
    : `разово, ${ymRu(a.startYm)}`;
  return `${ADJ_TYPE_RU[a.type] || a.type} ${money(a.amount)} · ${when} · ${SCENARIO_RU[a.scenario] || a.scenario}`;
}

export const forecastAdjustments: ToolDef<Record<string, never>> = {
  name: 'forecast_adjustments',
  kind: 'read',
  description:
    'Корректировки прогноза финансов (то, что владелец вручную добавил в прогноз: ожидаемая крупная покупка, разовый доход, новый расход каждый месяц): '
    + '«какие корректировки в прогнозе». Метки (X…) — для forecast_adjustment_update и forecast_adjustment_remove. Сам прогноз — finance_forecast.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: finance,
  async run(_args, ctx) {
    const list = await loadAdjustments(ctx);
    return {
      count: list.length,
      adjustments: list.sort((a, b) => String(a.startYm).localeCompare(String(b.startYm))).map((a) => ({
        ref: adjRef(ctx, a), name: a.name, text: adjText(a), ...(a.note ? { note: a.note } : {}),
      })),
    };
  },
};

interface AdjFields {
  type?: 'income' | 'expense'; amount?: number; start_month?: string; end_month?: string;
  recurrence?: 'once' | 'monthly'; scenario?: string; note?: string;
}

const ADJ_PROPS = {
  type: { type: 'string', enum: ['income', 'expense'], description: 'income — ожидаемый доход, expense — ожидаемый расход.' },
  amount: { type: 'number', description: 'Сумма, сомони (за раз или за месяц).' },
  start_month: { type: 'string', description: 'С какого месяца, ГГГГ-ММ.' },
  end_month: { type: 'string', description: 'По какой месяц включительно, ГГГГ-ММ (для повторяющихся). Пустая строка — без конца.' },
  recurrence: { type: 'string', enum: ['once', 'monthly'], description: 'once — один раз в start_month, monthly — каждый месяц.' },
  scenario: { type: 'string', enum: SCENARIOS, description: 'К какому сценарию прогноза относится (по умолчанию all — ко всем).' },
  note: { type: 'string' },
};

function adjBody(args: AdjFields & { name?: string }): Record<string, any> {
  const body: Record<string, any> = {};
  if (args.name !== undefined) {
    const n = String(args.name).trim();
    if (!n) throw new ToolError('Как назвать корректировку?');
    if (n.length > 160) throw new ToolError('Название слишком длинное (до 160 знаков).');
    body.name = n;
  }
  if (args.type !== undefined) {
    if (args.type !== 'income' && args.type !== 'expense') throw new ToolError('Это доход или расход?');
    body.type = args.type;
  }
  if (args.amount !== undefined) body.amount = checkAmount(args.amount);
  if (args.start_month !== undefined) body.startYm = checkYm(args.start_month, 'Месяц начала');
  if (args.end_month !== undefined) body.endYm = String(args.end_month).trim() === '' ? null : checkYm(args.end_month, 'Месяц конца');
  if (args.recurrence !== undefined) {
    if (args.recurrence !== 'once' && args.recurrence !== 'monthly') throw new ToolError('Разово (once) или каждый месяц (monthly)?');
    body.recurrence = args.recurrence;
  }
  if (args.scenario !== undefined) {
    if (!SCENARIOS.includes(args.scenario)) throw new ToolError(`Сценарий: ${SCENARIOS.join(', ')}.`);
    body.scenario = args.scenario;
  }
  if (args.note !== undefined) body.note = String(args.note).trim().slice(0, 2000) || null;
  return body;
}

export const forecastAdjustmentAdd: ToolDef<AdjFields & { name: string }> = {
  name: 'forecast_adjustment_add',
  kind: 'write',
  description:
    'Добавить корректировку в прогноз: «добавь в прогноз расход 5000 на ноябрь — покупка света», «с января ждём +3000 в месяц от нового клиента». '
    + 'Нужны название, тип (доход/расход), сумма и месяц начала; без повтора — разово. Это НЕ реальная операция: деньги и счета не меняются, только прогноз.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Название («Покупка света»).' }, ...ADJ_PROPS },
    required: ['name', 'type', 'amount', 'start_month'],
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx): Promise<WriteOutcome> {
    const body = adjBody(args);
    if (!body.name || !body.type || body.amount === undefined || !body.startYm) {
      throw new ToolError('Для корректировки нужны название, тип (доход/расход), сумма и месяц начала.');
    }
    if (body.endYm && body.endYm < body.startYm) throw new ToolError('Конец раньше начала.');
    if (body.recurrence !== 'monthly' && body.endYm) body.endYm = null;
    const created = await call(ctx.api.post<any>('/finance/forecast/adjustments', body));
    return {
      summary: `📈 В прогноз добавлено «${body.name}»: ${adjText({ ...body, recurrence: body.recurrence ?? 'once', scenario: body.scenario ?? 'all' })}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/finance/forecast/adjustments/${created.id}` }] : undefined,
    };
  },
};

export const forecastAdjustmentUpdate: ToolDef<AdjFields & { adjustment: string; name?: string }> = {
  name: 'forecast_adjustment_update',
  kind: 'write',
  description:
    'Изменить корректировку прогноза: сумму, месяц, повтор, сценарий, название: «поменяй корректировку Покупка света на 7000». '
    + 'Метку (X…) бери из forecast_adjustments.',
  parameters: {
    type: 'object',
    properties: {
      adjustment: { type: 'string', description: 'Метка (X…) или название корректировки.' },
      name: { type: 'string', description: 'Новое название.' },
      ...ADJ_PROPS,
    },
    required: ['adjustment'],
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx): Promise<WriteOutcome> {
    const adj = pickByRefOrName(ctx, args.adjustment, 'adj', await loadAdjustments(ctx), (a) => a.name, 'корректировка');
    const body = adjBody(args);
    if (!Object.keys(body).length) throw new ToolError('Что изменить в корректировке?');
    const next = { ...adj, ...body, amount: body.amount ?? Number(adj.amount) };
    if (next.endYm && next.endYm < next.startYm) throw new ToolError('Конец раньше начала.');
    if (body.recurrence === 'once' && adj.endYm && body.endYm === undefined) body.endYm = null;
    const prev: Record<string, any> = {};
    for (const k of Object.keys(body)) prev[k] = k === 'amount' ? Number(adj.amount) : (adj[k] ?? null);
    await call(ctx.api.patch(`/finance/forecast/adjustments/${adj.id}`, body));
    return {
      summary: `📈 Корректировка «${body.name ?? adj.name}»: ${adjText({ ...adj, ...body })}`,
      undo: [{ method: 'PATCH', path: `/finance/forecast/adjustments/${adj.id}`, body: prev }],
    };
  },
};

export const forecastAdjustmentRemove: ToolDef<{ adjustment: string }> = {
  name: 'forecast_adjustment_remove',
  kind: 'write',
  description: 'Убрать корректировку из прогноза: «убери из прогноза покупку света». Реальных денег не касается. Метку (X…) бери из forecast_adjustments.',
  parameters: {
    type: 'object',
    properties: { adjustment: { type: 'string', description: 'Метка (X…) или название корректировки.' } },
    required: ['adjustment'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const adj = pickByRefOrName(ctx, args.adjustment, 'adj', await loadAdjustments(ctx), (a) => a.name, 'корректировка');
    return `🗑 УБРАТЬ КОРРЕКТИРОВКУ ИЗ ПРОГНОЗА\n«${adj.name}»: ${adjText(adj)}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const adj = pickByRefOrName(ctx, args.adjustment, 'adj', await loadAdjustments(ctx), (a) => a.name, 'корректировка');
    await call(ctx.api.delete(`/finance/forecast/adjustments/${adj.id}`));
    const restore: Record<string, any> = {
      name: adj.name, type: adj.type, amount: Number(adj.amount), startYm: adj.startYm,
      recurrence: adj.recurrence, scenario: adj.scenario,
    };
    if (adj.endYm) restore.endYm = adj.endYm;
    if (adj.note) restore.note = adj.note;
    return {
      summary: `🗑 Корректировка «${adj.name}» убрана из прогноза`,
      undo: [{ method: 'POST', path: '/finance/forecast/adjustments', body: restore }],
    };
  },
};

// ═══ 5. Зарплатный месяц ════════════════════════════════════════════════

interface MonthArgs { month?: string }

async function salaryMonthState(ctx: ToolContext, spoken?: string) {
  const open = await call(ctx.api.get<any>('/finance/salary/period'));
  const ym = spoken ? checkYm(spoken) : String(open?.latestOpenYm || ctx.today.slice(0, 7));
  const [period, sheet] = await Promise.all([
    call(ctx.api.get<any>('/finance/salary/period', { ym })),
    call(ctx.api.get<any>('/finance/expense/detail/salary', { ym })),
  ]);
  const rows: any[] = Array.isArray(sheet?.rows) ? sheet.rows : [];
  return { ym, period, rows };
}

const monthParam = {
  month: { type: 'string', description: 'Зарплатный месяц ГГГГ-ММ. По умолчанию — текущий открытый месяц ведомости.' },
};

async function prepareCloseMonth(args: MonthArgs, ctx: ToolContext) {
  const { ym, period, rows } = await salaryMonthState(ctx, args.month);
  if (period?.status === 'closed') throw new ToolError(`Зарплатный месяц ${ymRu(ym)} уже закрыт.`);
  const active = rows.filter((r) => !r.frozen && (Number(r.salary) > 0 || Number(r.paid) > 0 || Number(r.toPay) > 0));
  const alreadyFrozen = rows.filter((r) => r.frozen).length;
  if (!active.length && !alreadyFrozen) throw new ToolError(`За ${ymRu(ym)} в ведомости нет сотрудников, которых можно закрыть.`);
  const unpaid = active.filter((r) => Number(r.toPay) > 0.005);
  if (unpaid.length) {
    const list = unpaid.slice(0, 8).map((r) => `${r.name} — ${money(r.toPay)}`).join('; ');
    throw new ToolError(
      `Месяц ${ymRu(ym)} закрыть нельзя: закрывается только когда выплачено всем (всё или ничего). Ещё не выплачено ${unpaid.length} из ${active.length}: ${list}${unpaid.length > 8 ? '…' : ''} `
      + 'Сначала проведите выплаты (salary_payout).',
    );
  }
  const total = active.reduce((s, r) => s + Number(r.paid), 0);
  return {
    ym, count: active.length, total,
    preview: `🔒 ЗАКРЫТЬ ЗАРПЛАТНЫЙ МЕСЯЦ — ${ymRu(ym).toUpperCase()}\n`
      + `👥 Закрывается: ${active.length} сотрудников · выплачено всего ${money(total)}${alreadyFrozen ? ` (ещё ${alreadyFrozen} уже зафиксированы)` : ''}\n`
      + '✅ Все выплаты за месяц проведены, долгов по зарплате нет.\n'
      + `⚠ После закрытия правки месяца недоступны: штрафы, премии, авансы и суммы за ${ymRu(ym)} менять нельзя, итоги фиксируются. `
      + 'Закрывается всё сразу, частично не бывает. Открыть обратно можно командой «переоткрыть месяц» (только по вашему решению).',
  };
}

export const salaryMonthClose: ToolDef<MonthArgs> = {
  name: 'salary_month_close',
  kind: 'write',
  description:
    'ЗАКРЫТЬ зарплатный месяц (кнопка «Закрыть месяц» в ведомости): «закрой зарплатный месяц», «закрой октябрь по зарплате». '
    + 'Закрывается только если выплачено ВСЕМ (всё или ничего); после закрытия суммы месяца замораживаются. Если есть невыплаченные — вернёт, кому ещё платить. '
    + 'НЕ для выплаты денег (salary_payout) и не для штрафов/премий (salary_accrual).',
  parameters: { type: 'object', properties: monthParam, additionalProperties: false },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareCloseMonth(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareCloseMonth(args, ctx);
    const res = await call(ctx.api.post<any>('/finance/salary/close-month', { ym: p.ym }));
    if (res?.alreadyClosed) return { summary: `🔒 Месяц ${ymRu(p.ym)} уже был закрыт` };
    return { summary: `🔒 Зарплатный месяц ${ymRu(p.ym)} закрыт: ${res?.closed ?? p.count} сотрудников, выплачено ${money(p.total)}` };
  },
};

async function prepareReopenMonth(args: MonthArgs, ctx: ToolContext) {
  const { ym, period, rows } = await salaryMonthState(ctx, args.month);
  const frozen = rows.filter((r) => r.frozen);
  if (period?.status !== 'closed' && !frozen.length) throw new ToolError(`Зарплатный месяц ${ymRu(ym)} и так открыт.`);
  return {
    ym, count: frozen.length,
    preview: `🔓 ПЕРЕОТКРЫТЬ ЗАРПЛАТНЫЙ МЕСЯЦ — ${ymRu(ym).toUpperCase()}\n`
      + `👥 С ${frozen.length} сотрудников снимается заморозка итогов.\n`
      + 'Выплаты и деньги на счетах НЕ меняются. Суммы месяца снова станут редактируемыми и начнут пересчитываться по текущим данным (оклады, штрафы, премии, авансы).\n'
      + '⚠ Кнопки «Отменить» не будет: чтобы снова зафиксировать месяц, его нужно закрыть заново (дата закрытия станет новой).',
  };
}

export const salaryMonthReopen: ToolDef<MonthArgs> = {
  name: 'salary_month_reopen',
  kind: 'write',
  description:
    'ПЕРЕОТКРЫТЬ закрытый зарплатный месяц, чтобы поправить штрафы, премии, авансы: «переоткрой октябрь по зарплате», «открой зарплатный месяц обратно». '
    + 'Деньги не двигает, выплаты не удаляет — только снимает заморозку итогов. Закрыть — salary_month_close.',
  parameters: { type: 'object', properties: monthParam, additionalProperties: false },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareReopenMonth(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareReopenMonth(args, ctx);
    const res = await call(ctx.api.post<any>('/finance/salary/reopen-month', { ym: p.ym }));
    return { summary: `🔓 Зарплатный месяц ${ymRu(p.ym)} переоткрыт (сотрудников: ${res?.reopened ?? p.count}). Выплаты не тронуты.` };
  },
};

export const FINANCE3_TOOLS: ToolDef[] = [
  installmentPayments, installmentPay,
  financeCategories, categoryAdd, categoryRename, categoryDelete,
  financeAssets, assetCreate, assetUpdate, assetDelete,
  forecastAdjustments, forecastAdjustmentAdd, forecastAdjustmentUpdate, forecastAdjustmentRemove,
  salaryMonthClose, salaryMonthReopen,
];
