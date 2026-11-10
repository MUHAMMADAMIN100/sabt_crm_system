import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { addDays, checkDate, fmtDateRu, matchScore, norm, roles, splitDushanbe } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Финансы (журнал, долги, подписки, рассрочки, планы клиентов, счета, прогноз)
 * и Транспорт. Всё через собственный API — те же права, что на сайте:
 * финансы только у finance.manage (основатель), заявку на транспорт подают
 * SMM-специалисты и видеографы.
 * Не делаем голосом: восстановление из бэкапа, сброс, импорт, загрузка фото чека,
 * зарплата (там salary.tools.ts).
 */

const finance = (u: any) => hasGrant(u, 'finance.manage');
const TRANSPORT_ROLES = ['smm_specialist', 'videographer'];
const canRequestTransport = (u: any) => roles(u).some((r) => TRANSPORT_ROLES.includes(r));
const transportUser = (u: any) => canRequestTransport(u) || finance(u);

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const money = (n: unknown) => `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом.`;
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ymRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dateRu = (d: string | null | undefined) => (d ? fmtDateRu(String(d).slice(0, 10)) : 'без срока');

function checkYm(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ToolError(`Неверный месяц «${s}». Нужно ГГГГ-ММ.`);
  return s;
}

function checkAmount(v: unknown): number {
  const n = r2(v);
  if (!(n > 0) || n > 100_000_000) throw new ToolError('Сумма должна быть больше нуля.');
  return n;
}

const ACCOUNT_ALIASES: Record<string, string[]> = {
  cash: ['нал', 'наличн', 'кэш', 'кеш', 'касс'],
  alif: ['алиф', 'alif'],
  dushanbe_city: ['душанбе сити', 'dushanbe city', 'дс банк', 'сити'],
};

async function loadAccounts(ctx: ToolContext): Promise<any[]> {
  try { return (await ctx.api.get<any[]>('/finance/accounts')) || []; } catch (e) { throw apiErr(e); }
}

function pickAccount(list: any[], spoken: unknown): { id: string; name: string } {
  const active = list.filter((a) => !a.archived);
  const names = active.map((a) => a.name).join(', ');
  const s = norm(spoken);
  if (!s) throw new ToolError(`Какой счёт? Счета: ${names}.`);
  const byAlias = active.filter((a) => (ACCOUNT_ALIASES[a.key] || []).some((al) => s.includes(al)));
  if (byAlias.length === 1) return { id: byAlias[0].id, name: byAlias[0].name };
  const scored = active.map((a) => ({ a, sc: matchScore(a.name, s) })).filter((x) => x.sc >= 0.5).sort((x, y) => y.sc - x.sc);
  if (scored.length === 1 || (scored.length > 1 && scored[0].sc > scored[1].sc)) return { id: scored[0].a.id, name: scored[0].a.name };
  throw new ToolError(`Не понял, какой счёт: «${spoken}». Счета: ${names}. Уточните через ask_choice.`);
}

const resolveAccount = async (ctx: ToolContext, spoken: unknown) => pickAccount(await loadAccounts(ctx), spoken);

const BLOCKED_CATEGORY_KEYS = ['salary', 'debt', 'subscription', 'installment'];

async function resolveCategory(ctx: ToolContext, spoken: unknown, type: string): Promise<{ id: string; name: string }> {
  let list: any[];
  try { list = (await ctx.api.get<any[]>('/finance/categories')) || []; } catch (e) { throw apiErr(e); }
  const fit = list.filter((c) => !c.archived && c.type === type);
  const s = norm(spoken);
  const scored = fit.map((c) => ({ c, sc: matchScore(c.name, s) })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!s || !scored.length || (scored.length > 1 && scored[0].sc === scored[1].sc)) {
    throw new ToolError(`Не нашёл статью «${spoken}». Статьи (${type === 'income' ? 'доход' : 'расход'}): ${fit.map((c) => c.name).join(', ')}. Уточните через ask_choice.`);
  }
  const cat = scored[0].c;
  if (BLOCKED_CATEGORY_KEYS.includes(cat.key)) {
    throw new ToolError(`Статью «${cat.name}» голосом не ставлю: нужен сотрудник/долг/период. Это делается на сайте.`);
  }
  return { id: cat.id, name: cat.name };
}

async function resolveFinClient(ctx: ToolContext, spoken: unknown): Promise<{ id: string; name: string }> {
  const asRef = ctx.refs.resolve('F', spoken);
  if (asRef) return { id: asRef.id, name: asRef.label };
  let list: any[];
  try { list = (await ctx.api.get<any[]>('/finance/projects')) || []; } catch (e) { throw apiErr(e); }
  const live = list.filter((p) => !p.archived);
  const scored = live.map((p) => ({ p, sc: matchScore(p.name, String(spoken || '')) })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!scored.length) throw new ToolError(`Не нашёл клиента «${spoken}» в финансах.`);
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    throw new ToolError(`Несколько клиентов подходят: ${scored.slice(0, 6).map((x) => x.p.name).join(', ')}. Уточните через ask_choice.`);
  }
  const p = scored[0].p;
  ctx.refs.add('F', p.id, p.name);
  return { id: p.id, name: p.name };
}

/** Подпись метки X хранит «дата|описание» — по дате находим операцию в журнале. */
const txLabel = (t: any) => `${String(t.date).slice(0, 10)}|${money(t.amount)} ${t.categoryName || t.type} ${t.comment || ''}`.trim();
const planLabel = (projectId: string, ym: string, text: string) => `plan|${projectId}|${ym}|${text}`;

const TX_TYPE_RU: Record<string, string> = { income: 'доход', expense: 'расход', transfer: 'перевод', saving: 'накопление' };

function txDescribe(t: any): string {
  const where = t.type === 'transfer' || t.type === 'saving'
    ? `${t.fromAccountName || '?'} → ${t.toAccountName || '?'}`
    : (t.accountName || '—');
  const cat = t.categoryName ? ` · ${t.categoryName}` : '';
  return `${TX_TYPE_RU[t.type] || t.type} ${money(t.amount)}${cat} · ${dateRu(t.date)} · ${where}${t.comment ? ` · «${t.comment}»` : ''}`;
}

const isImported = (t: any) => !!(t.imported || t.source || t.externalId || t.affectsBalance === false);

async function loadTx(ctx: ToolContext, ref: unknown): Promise<any> {
  const entry = ctx.refs.resolve('X', ref);
  const date = entry ? entry.label.split('|')[0] : '';
  if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ToolError('Не знаю такую операцию. Сначала найди её через finance_journal и возьми метку оттуда.');
  }
  let res: any;
  try { res = await ctx.api.get('/finance/transactions', { from: date, to: date, status: 'all', pageSize: 1000 }); } catch (e) { throw apiErr(e); }
  const tx = (res?.items || []).find((t: any) => t.id === entry.id);
  if (!tx) throw new ToolError('Операция не найдена — возможно, её уже изменили. Найди её заново через finance_journal.');
  return tx;
}

async function loadPlan(ctx: ToolContext, ref: unknown): Promise<any> {
  const entry = ctx.refs.resolve('X', ref);
  const parts = entry ? entry.label.split('|') : [];
  if (!entry || parts[0] !== 'plan') throw new ToolError('Не знаю такую плановую оплату. Сначала покажи планы клиента через client_plans.');
  let list: any[];
  try { list = (await ctx.api.get<any[]>('/finance/planned-payments', { projectId: parts[1], ym: parts[2] })) || []; } catch (e) { throw apiErr(e); }
  const plan = list.find((p) => p.id === entry.id);
  if (!plan) throw new ToolError('Плановая оплата не найдена — возможно, её уже убрали.');
  return { plan, projectId: parts[1], clientName: parts.slice(3).join('|').split(' · ')[0] };
}

// ─── Журнал операций ────────────────────────────────────────────────────

interface JournalArgs {
  from?: string; to?: string; search?: string; type?: string; status?: string;
  amount?: number; min_amount?: number; max_amount?: number; category?: string; account?: string; limit?: number;
}

export const financeJournal: ToolDef<JournalArgs> = {
  name: 'finance_journal',
  kind: 'read',
  description:
    'Найти операции в журнале финансов по дате, сумме, статье, счёту или слову в комментарии: «найди расход на 300 за вчера», '
    + '«что мы платили за рекламу в ноябре», «последние операции». Возвращает метки (X1…) — по ним потом cancel_operation и edit_operation. '
    + 'НЕ для общих итогов месяца (это finance_summary) и НЕ для записи новой операции.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'С даты, ГГГГ-ММ-ДД.' },
      to: { type: 'string', description: 'По дату, ГГГГ-ММ-ДД.' },
      search: { type: 'string', description: 'Слово из комментария или названия статьи.' },
      type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
      status: { type: 'string', enum: ['active', 'cancelled', 'all'], description: 'По умолчанию только действующие.' },
      amount: { type: 'number', description: 'Точная сумма.' },
      min_amount: { type: 'number' },
      max_amount: { type: 'number' },
      category: { type: 'string', description: 'Название статьи.' },
      account: { type: 'string', description: 'Счёт: Алиф, наличные…' },
      limit: { type: 'number', description: 'Сколько показать, до 30. По умолчанию 15.' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const from = args.from ? checkDate(args.from) : undefined;
    const to = args.to ? checkDate(args.to) : undefined;
    const query: Record<string, any> = { pageSize: 1000 };
    if (from) query.from = from;
    if (to) query.to = to;
    if (args.search) query.search = String(args.search).trim();
    if (args.type) query.type = args.type;
    if (args.status === 'cancelled' || args.status === 'all') query.status = args.status;
    let res: any;
    try { res = await ctx.api.get('/finance/transactions', query); } catch (e) { throw apiErr(e); }
    let items: any[] = res?.items || [];
    if (args.amount != null) items = items.filter((t) => Math.abs(Number(t.amount) - Number(args.amount)) < 0.005);
    if (args.min_amount != null) items = items.filter((t) => Number(t.amount) >= Number(args.min_amount) - 0.005);
    if (args.max_amount != null) items = items.filter((t) => Number(t.amount) <= Number(args.max_amount) + 0.005);
    if (args.category) items = items.filter((t) => t.categoryName && matchScore(t.categoryName, args.category as string) >= 0.5);
    if (args.account) {
      const accounts = await loadAccounts(ctx);
      const acc = pickAccount(accounts, args.account);
      items = items.filter((t) => [t.accountId, t.fromAccountId, t.toAccountId].includes(acc.id));
    }
    const limit = Math.min(30, Math.max(1, Math.trunc(Number(args.limit)) || 15));
    const shown = items.slice(0, limit);
    const sum = (type: string) => r2(items.filter((t) => t.type === type && t.status !== 'cancelled').reduce((s, t) => s + Number(t.amount), 0));
    return {
      found: items.length,
      shown: shown.length,
      ...(items.length ? { incomeTotal: money(sum('income')), expenseTotal: money(sum('expense')) } : {}),
      ...((res?.total ?? 0) > (res?.items?.length ?? 0) ? { note: 'Журнал большой: показана только часть, сузь период.' } : {}),
      operations: shown.map((t) => ({
        ref: ctx.refs.add('X', t.id, txLabel(t)),
        date: String(t.date).slice(0, 10),
        what: txDescribe(t),
        status: t.status === 'cancelled' ? 'отменена' : 'действует',
        ...(isImported(t) ? { imported: 'импорт из Notion — не меняется' } : {}),
        ...(t.employeeName || t.employeeId ? { salary: 'зарплатная операция' } : {}),
        ...(t.debtName ? { debt: t.debtName } : {}),
      })),
    };
  },
};

// ─── Отмена и правка операции ───────────────────────────────────────────

interface CancelOpArgs { operation: string }

function assertTouchable(t: any, what: string): void {
  if (t.status === 'cancelled') throw new ToolError('Эта операция уже отменена.');
  if (isImported(t)) throw new ToolError(`Операцию из импорта Notion сайт не даёт ${what}.`);
}

export const cancelOperation: ToolDef<CancelOpArgs> = {
  name: 'cancel_operation',
  kind: 'write',
  description:
    'Отменить операцию в журнале финансов (мягкая отмена: баланс счёта пересчитается, запись остаётся отменённой): «отмени эту операцию», '
    + '«удали расход на 300». Метку операции (X…) бери из finance_journal. Вернуть отменённую операцию нельзя. '
    + 'НЕ для платежа по долгу (cancel_debt_payment) и НЕ для оплаты клиента (client_plan_unreceive).',
  parameters: {
    type: 'object',
    properties: { operation: { type: 'string', description: 'Метка операции из finance_journal, например X3.' } },
    required: ['operation'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const t = await loadTx(ctx, args.operation);
    assertTouchable(t, 'отменить');
    if (t.debtId) throw new ToolError('Это платёж по долгу: отмени его через cancel_debt_payment.');
    return `🗑 ОТМЕНИТЬ ОПЕРАЦИЮ\n${txDescribe(t)}\n⚠ Баланс счёта пересчитается. Вернуть операцию потом нельзя.${t.employeeId ? '\n⚠ Это зарплатная операция.' : ''}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const t = await loadTx(ctx, args.operation);
    assertTouchable(t, 'отменить');
    if (t.debtId) throw new ToolError('Это платёж по долгу: отмени его через cancel_debt_payment.');
    try { await ctx.api.delete(`/finance/transactions/${t.id}`); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 Операция отменена: ${txDescribe(t)}` };
  },
};

interface EditOpArgs { operation: string; amount?: number; date?: string; comment?: string; category?: string; account?: string }

async function prepareEdit(args: EditOpArgs, ctx: ToolContext) {
  const t = await loadTx(ctx, args.operation);
  assertTouchable(t, 'изменить');
  if (t.employeeId) throw new ToolError('Это зарплатная операция — меняй её через зарплатные инструменты или на сайте.');
  const body: Record<string, any> = {};
  const back: Record<string, any> = {};
  const lines: string[] = [];
  const simple = t.type === 'income' || t.type === 'expense';

  if (args.amount != null) {
    const amount = checkAmount(args.amount);
    if (Math.abs(amount - Number(t.amount)) > 0.004) {
      body.amount = amount; back.amount = Number(t.amount);
      lines.push(`Сумма: ${money(t.amount)} → ${money(amount)}`);
    }
  }
  if (args.date) {
    const date = checkDate(args.date);
    if (date !== String(t.date).slice(0, 10)) {
      body.date = date; back.date = String(t.date).slice(0, 10);
      lines.push(`Дата: ${dateRu(t.date)} → ${dateRu(date)}`);
    }
  }
  if (args.comment !== undefined) {
    const comment = String(args.comment).slice(0, 2000);
    if (comment !== (t.comment || '')) {
      body.comment = comment; back.comment = t.comment ?? '';
      lines.push(`Комментарий: «${t.comment || ''}» → «${comment}»`);
    }
  }
  if (args.category) {
    if (!simple) throw new ToolError('Статью можно менять только у дохода и расхода.');
    const cat = await resolveCategory(ctx, args.category, t.type);
    if (cat.id !== t.categoryId) {
      body.categoryId = cat.id; back.categoryId = t.categoryId ?? null;
      lines.push(`Статья: ${t.categoryName || '—'} → ${cat.name}`);
    }
  }
  if (args.account) {
    if (!simple) throw new ToolError('Счёт можно менять только у дохода и расхода; у перевода — на сайте.');
    const acc = await resolveAccount(ctx, args.account);
    if (acc.id !== t.accountId) {
      body.accountId = acc.id; back.accountId = t.accountId;
      lines.push(`Счёт: ${t.accountName || '—'} → ${acc.name}`);
    }
  }
  if (!lines.length) throw new ToolError('Нечего менять: укажи новую сумму, дату, комментарий, статью или счёт (и они должны отличаться от текущих).');
  return { t, body, back, preview: `✏️ ИЗМЕНИТЬ ОПЕРАЦИЮ\n${txDescribe(t)}\n${lines.join('\n')}` };
}

export const editOperation: ToolDef<EditOpArgs> = {
  name: 'edit_operation',
  kind: 'write',
  description:
    'Изменить операцию журнала: сумму, дату, комментарий, статью или счёт: «поменяй сумму этой операции на 350», «перенеси на вчера». '
    + 'Метку (X…) бери из finance_journal. Тип операции, зарплатные операции и импорт Notion не меняются. '
    + 'НЕ для новой операции (record_operation) и НЕ для плана оплаты клиента (client_plan_update).',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'Метка операции из finance_journal.' },
      amount: { type: 'number', description: 'Новая сумма.' },
      date: { type: 'string', description: 'Новая дата ГГГГ-ММ-ДД.' },
      comment: { type: 'string', description: 'Новый комментарий.' },
      category: { type: 'string', description: 'Новая статья.' },
      account: { type: 'string', description: 'Новый счёт.' },
    },
    required: ['operation'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareEdit(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareEdit(args, ctx);
    try { await ctx.api.patch(`/finance/transactions/${p.t.id}`, p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `✏️ Операция изменена: ${p.preview.split('\n').slice(2).join('; ')}`,
      undo: [{ method: 'PATCH', path: `/finance/transactions/${p.t.id}`, body: p.back }],
    };
  },
};

// ─── Долги ──────────────────────────────────────────────────────────────

async function loadDebtRows(ctx: ToolContext): Promise<any[]> {
  try {
    const res: any = await ctx.api.get('/finance/expense/detail/debts', { ym: ctx.today.slice(0, 7) });
    return res?.rows || [];
  } catch (e) { throw apiErr(e); }
}

async function resolveDebt(ctx: ToolContext, spoken: unknown): Promise<any> {
  const rows = await loadDebtRows(ctx);
  const ref = ctx.refs.resolve('B', spoken);
  if (ref) {
    const hit = rows.find((r) => r.id === ref.id);
    if (hit) return hit;
  }
  const scored = rows.map((r) => ({ r, sc: matchScore(`${r.name} ${r.counterparty || ''}`, String(spoken || '')) }))
    .filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!scored.length) throw new ToolError(`Не нашёл долг «${spoken}». Долги: ${rows.map((r) => r.name).join(', ') || 'нет'}.`);
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    throw new ToolError(`Подходит несколько долгов: ${scored.slice(0, 5).map((x) => x.r.name).join(', ')}. Уточни через ask_choice.`);
  }
  return scored[0].r;
}

export const financeDebts: ToolDef<{ include_closed?: boolean }> = {
  name: 'finance_debts',
  kind: 'read',
  description:
    'Долги компании: сколько осталось отдать, что уже отдали, ближайшие транши: «какие у нас долги», «сколько осталось по долгу Мухаммаду». '
    + 'Возвращает метки долгов (B…) и платежей (X…) для pay_debt и cancel_debt_payment. Банковские кредиты и рассрочки — в finance_installments.',
  parameters: {
    type: 'object',
    properties: { include_closed: { type: 'boolean', description: 'Показать и закрытые долги.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const rows = (await loadDebtRows(ctx)).filter((r) => args.include_closed || !r.closed);
    return {
      count: rows.length,
      remainingTotal: money(rows.reduce((s, r) => s + Number(r.remaining), 0)),
      debts: rows.map((r) => ({
        ref: ctx.refs.add('B', r.id, r.name),
        name: r.name,
        counterparty: r.counterparty,
        total: money(r.totalAmount), paid: money(Number(r.paid) + Number(r.paidBefore || 0)), remaining: money(r.remaining),
        closed: !!r.closed,
        dueDate: r.dueDate ? dateRu(r.dueDate) : null,
        overdue: !!r.overdue,
        tranches: (r.tranches || []).map((t: any) => `${dateRu(t.date)}: ${money(t.amount)}`),
        payments: (r.payments || []).map((p: any) => ({
          ref: ctx.refs.add('X', p.txId, `${p.date}|${money(p.amount)} погашение долга ${r.name}`),
          text: `${dateRu(p.date)}: ${money(p.amount)}${p.account ? `, ${p.account}` : ''}`,
        })),
      })),
    };
  },
};

interface PayDebtArgs { debt: string; amount: number; account: string; date?: string; comment?: string }

async function preparePayDebt(args: PayDebtArgs, ctx: ToolContext) {
  const debt = await resolveDebt(ctx, args.debt);
  if (debt.closed) throw new ToolError(`Долг «${debt.name}» уже закрыт.`);
  const amount = checkAmount(args.amount);
  if (amount > Number(debt.remaining) + 0.005) throw new ToolError(`Это больше, чем осталось отдать по «${debt.name}» (${money(debt.remaining)}).`);
  const date = args.date ? checkDate(args.date) : ctx.today;
  if (date > ctx.today) throw new ToolError('Будущий платёж «Отдать» не записывает — только то, что уже отдали.');
  const acc = await resolveAccount(ctx, args.account);
  const left = r2(Number(debt.remaining) - amount);
  const body: Record<string, any> = { amount, accountId: acc.id, date };
  if (args.comment) body.comment = String(args.comment).slice(0, 2000);
  return {
    debt, amount, acc, body,
    preview: `💸 ОТДАТЬ ДОЛГ ${money(amount)}\n${debt.name}${debt.counterparty ? ` (${debt.counterparty})` : ''}\n🏦 Со счёта: ${acc.name} · 📅 ${dateRu(date)}\n`
      + (left <= 0.005 ? 'Долг будет закрыт полностью.' : `Останется отдать: ${money(left)}`),
  };
}

export const payDebt: ToolDef<PayDebtArgs> = {
  name: 'pay_debt',
  kind: 'write',
  description:
    'Отдать долг (всё или часть): «отдали Мухаммаду 500 с Алифа», «погасили долг за камеру». Деньги списываются со счёта. '
    + 'Долг и сумму называет человек; метку долга (B…) бери из finance_debts. НЕ для банковских рассрочек, НЕ для оплаты клиента.',
  parameters: {
    type: 'object',
    properties: {
      debt: { type: 'string', description: 'Метка долга (B…) или его название.' },
      amount: { type: 'number', description: 'Сколько отдали, сомони.' },
      account: { type: 'string', description: 'Со счёта: Алиф, Dushanbe City, наличные.' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня (не будущее).' },
      comment: { type: 'string' },
    },
    required: ['debt', 'amount', 'account'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePayDebt(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePayDebt(args, ctx);
    let res: any;
    try { res = await ctx.api.post(`/finance/debts/${p.debt.id}/pay`, p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `💸 Долг «${p.debt.name}»: отдано ${money(p.amount)} со счёта ${p.acc.name}`,
      undo: res?.txId ? [{ method: 'DELETE', path: `/finance/debts/${p.debt.id}/payments/${res.txId}` }] : undefined,
    };
  },
};

interface CancelDebtPayArgs { debt: string; payment: string }

async function prepareCancelDebtPayment(args: CancelDebtPayArgs, ctx: ToolContext) {
  const debt = await resolveDebt(ctx, args.debt);
  const entry = ctx.refs.resolve('X', args.payment);
  const pay = entry ? (debt.payments || []).find((p: any) => p.txId === entry.id) : null;
  if (!pay) throw new ToolError(`Не нашёл такой платёж по долгу «${debt.name}». Покажи платежи через finance_debts и возьми метку оттуда.`);
  return {
    debt, pay,
    preview: `↩ ОТМЕНИТЬ ПЛАТЁЖ ПО ДОЛГУ\n${debt.name}: ${money(pay.amount)} · ${dateRu(pay.date)}${pay.account ? ` · ${pay.account}` : ''}\n⚠ Деньги вернутся на счёт, долг вырастет на эту сумму. Закрытые платежом транши сами не вернутся.`,
  };
}

export const cancelDebtPayment: ToolDef<CancelDebtPayArgs> = {
  name: 'cancel_debt_payment',
  kind: 'write',
  description:
    'Отменить уже проведённый платёж по долгу (ошибся суммой или счётом): «отмени платёж по долгу Мухаммаду от 5 ноября». '
    + 'Метку платежа (X…) и долг (B…) бери из finance_debts. НЕ для обычной операции журнала (cancel_operation).',
  parameters: {
    type: 'object',
    properties: {
      debt: { type: 'string', description: 'Метка долга или название.' },
      payment: { type: 'string', description: 'Метка платежа из finance_debts.' },
    },
    required: ['debt', 'payment'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareCancelDebtPayment(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareCancelDebtPayment(args, ctx);
    try { await ctx.api.delete(`/finance/debts/${p.debt.id}/payments/${p.pay.txId}`); } catch (e) { throw apiErr(e); }
    return { summary: `↩ Платёж по долгу «${p.debt.name}» на ${money(p.pay.amount)} отменён` };
  },
};

// ─── Подписки и аренда ──────────────────────────────────────────────────

async function loadSubRows(ctx: ToolContext, ym: string): Promise<any[]> {
  try {
    const res: any = await ctx.api.get('/finance/expense/detail/subscriptions', { ym });
    return res?.rows || [];
  } catch (e) { throw apiErr(e); }
}

const subRemaining = (s: any) => (s.paidMark ? 0 : Math.max(0, r2(Number(s.amount) - Number(s.paidMonth || 0))));

async function resolveSub(ctx: ToolContext, spoken: unknown, ym: string): Promise<any> {
  const rows = await loadSubRows(ctx, ym);
  const ref = ctx.refs.resolve('B', spoken);
  if (ref) {
    const hit = rows.find((r) => r.id === ref.id);
    if (hit) return hit;
  }
  const scored = rows.map((r) => ({ r, sc: matchScore(r.name, String(spoken || '')) })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!scored.length) throw new ToolError(`Не нашёл подписку или аренду «${spoken}». Есть: ${rows.map((r) => r.name).join(', ') || 'ничего'}.`);
  if (scored.length > 1 && scored[0].sc === scored[1].sc) {
    throw new ToolError(`Подходит несколько: ${scored.slice(0, 5).map((x) => x.r.name).join(', ')}. Уточни через ask_choice.`);
  }
  return scored[0].r;
}

export const financeSubscriptions: ToolDef<{ month?: string; only_unpaid?: boolean }> = {
  name: 'finance_subscriptions',
  kind: 'read',
  description:
    'Аренда и подписки за месяц: что оплачено, что ещё к оплате и сколько: «какие подписки надо оплатить», «оплачена ли аренда». '
    + 'Метки (B…) нужны для pay_subscription и mark_subscription_paid.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      only_unpaid: { type: 'boolean', description: 'Только неоплаченные.' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const ym = args.month ? checkYm(args.month) : ctx.today.slice(0, 7);
    const all = (await loadSubRows(ctx, ym)).filter((s) => s.active !== false);
    const rows = args.only_unpaid ? all.filter((s) => subRemaining(s) > 0.005) : all;
    return {
      month: ymRu(ym),
      toPayTotal: money(all.reduce((s, x) => s + subRemaining(x), 0)),
      items: rows.map((s) => ({
        ref: ctx.refs.add('B', s.id, s.name),
        name: s.name,
        kind: s.kind === 'rent' ? 'аренда' : 'подписка',
        amount: money(s.amount),
        status: s.paidMark ? `отмечена оплаченной ${dateRu(s.paidMark)} (без движения денег)` : subRemaining(s) <= 0.005 ? 'оплачена' : Number(s.paidMonth) > 0 ? `оплачена частично, осталось ${money(subRemaining(s))}` : 'не оплачена',
        ...(s.dueDay ? { dueDay: s.dueDay } : {}),
      })),
    };
  },
};

interface PaySubArgs { subscription: string; account: string; amount?: number; date?: string }

async function preparePaySub(args: PaySubArgs, ctx: ToolContext) {
  const date = args.date ? checkDate(args.date) : ctx.today;
  const ym = date.slice(0, 7);
  const sub = await resolveSub(ctx, args.subscription, ym);
  if (sub.active === false) throw new ToolError(`«${sub.name}» сейчас не действует.`);
  const rest = subRemaining(sub);
  if (rest <= 0.005) throw new ToolError(`«${sub.name}» за ${ymRu(ym)} уже оплачена.`);
  const amount = args.amount != null ? checkAmount(args.amount) : rest;
  if (amount > rest + 0.005) throw new ToolError(`К оплате по «${sub.name}» за ${ymRu(ym)} осталось ${money(rest)}, больше нельзя.`);
  const acc = await resolveAccount(ctx, args.account);
  let cats: any[];
  try { cats = (await ctx.api.get<any[]>('/finance/categories')) || []; } catch (e) { throw apiErr(e); }
  const cat = cats.find((c) => c.key === (sub.kind === 'rent' ? 'rent' : 'subscription'));
  if (!cat) throw new ToolError('На сайте нет статьи для подписок/аренды — проведи оплату на сайте.');
  return {
    sub, ym, amount, acc,
    body: { type: 'expense', amount, date, accountId: acc.id, categoryId: cat.id, subscriptionId: sub.id, comment: sub.name },
    preview: `💳 ОПЛАТИТЬ ${sub.kind === 'rent' ? 'АРЕНДУ' : 'ПОДПИСКУ'} ${money(amount)}\n${sub.name} · за ${ymRu(ym)}\n🏦 Со счёта: ${acc.name} · 📅 ${dateRu(date)}`,
  };
}

export const paySubscription: ToolDef<PaySubArgs> = {
  name: 'pay_subscription',
  kind: 'write',
  description:
    'Оплатить аренду или подписку со счёта — создаёт расход и списывает деньги: «оплати Claude с Алифа», «аренду заплатили наличными». '
    + 'Если деньги уже ушли и нужна только отметка без движения денег — mark_subscription_paid. Метку (B…) бери из finance_subscriptions.',
  parameters: {
    type: 'object',
    properties: {
      subscription: { type: 'string', description: 'Метка (B…) или название подписки/аренды.' },
      account: { type: 'string', description: 'Со счёта.' },
      amount: { type: 'number', description: 'Сумма; по умолчанию весь остаток за месяц.' },
      date: { type: 'string', description: 'Дата оплаты ГГГГ-ММ-ДД; её месяц и есть месяц оплаты. По умолчанию сегодня.' },
    },
    required: ['subscription', 'account'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePaySub(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePaySub(args, ctx);
    let tx: any;
    try { tx = await ctx.api.post('/finance/operations', p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `💳 «${p.sub.name}» за ${ymRu(p.ym)}: оплачено ${money(p.amount)} со счёта ${p.acc.name}`,
      undo: tx?.id ? [{ method: 'DELETE', path: `/finance/transactions/${tx.id}` }] : undefined,
    };
  },
};

interface MarkSubArgs { subscription: string; month?: string; date?: string }

async function prepareMarkSub(args: MarkSubArgs, ctx: ToolContext) {
  const ym = args.month ? checkYm(args.month) : ctx.today.slice(0, 7);
  const date = args.date ? checkDate(args.date) : ctx.today;
  const sub = await resolveSub(ctx, args.subscription, ym);
  if (sub.paidMark) throw new ToolError(`«${sub.name}» за ${ymRu(ym)} уже отмечена оплаченной.`);
  return {
    sub, ym, date,
    preview: `✅ ОТМЕТИТЬ ОПЛАЧЕННОЙ (деньги по счетам не двигаются)\n${sub.name} · ${money(sub.amount)} · за ${ymRu(ym)}\n📅 Дата оплаты: ${dateRu(date)}`,
  };
}

export const markSubscriptionPaid: ToolDef<MarkSubArgs> = {
  name: 'mark_subscription_paid',
  kind: 'write',
  description:
    'Только ОТМЕТИТЬ подписку или аренду оплаченной за месяц, без списания денег со счёта (оплатили вне системы): «отметь аренду оплаченной». '
    + 'Если нужно реально списать деньги со счёта — pay_subscription.',
  parameters: {
    type: 'object',
    properties: {
      subscription: { type: 'string', description: 'Метка (B…) или название.' },
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      date: { type: 'string', description: 'Дата оплаты, по умолчанию сегодня.' },
    },
    required: ['subscription'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareMarkSub(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareMarkSub(args, ctx);
    try { await ctx.api.post(`/finance/subscriptions/${p.sub.id}/mark-paid`, { ym: p.ym, date: p.date }); } catch (e) { throw apiErr(e); }
    return {
      summary: `✅ «${p.sub.name}» за ${ymRu(p.ym)} отмечена оплаченной (без движения денег)`,
      undo: [{ method: 'POST', path: `/finance/subscriptions/${p.sub.id}/unmark-paid`, body: { ym: p.ym } }],
    };
  },
};

// ─── Рассрочки ──────────────────────────────────────────────────────────

export const financeInstallments: ToolDef<{ only_overdue?: boolean }> = {
  name: 'finance_installments',
  kind: 'read',
  description:
    'Рассрочки сотрудников и банковские рассрочки/кредиты: сколько осталось, ближайший платёж, просрочки: «у кого рассрочка», '
    + '«сколько осталось по рассрочке», «есть просроченные рассрочки». Только чтение.',
  parameters: {
    type: 'object',
    properties: { only_overdue: { type: 'boolean', description: 'Только с просрочкой.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    let board: any;
    try { board = await ctx.api.get('/finance/installments'); } catch (e) { throw apiErr(e); }
    const nextText = (n: any) => (n ? `${dateRu(n.date)}: ${money(n.amount)}` : null);
    const people = (board?.rows || [])
      .filter((r: any) => !r.done && (!args.only_overdue || r.overdue))
      .map((r: any) => ({
        employee: r.employee?.name || 'сотрудник',
        total: money(r.installment?.totalAmount), paid: money(r.paid), remaining: money(r.remaining),
        next: nextText(r.next),
        overdue: r.overdue ? `${money(r.overdue.amount)} (с ${dateRu(r.overdue.since)})` : null,
      }));
    const banks = (board?.banks || [])
      .filter((b: any) => !b.done && (!args.only_overdue || b.next?.overdue))
      .map((b: any) => ({
        name: b.name, bank: b.bank, remaining: money(b.remaining), monthly: money(b.monthly),
        next: nextText(b.next), overdue: !!b.next?.overdue,
      }));
    return {
      employees: people,
      banks,
      remainingEmployees: money(board?.stats?.remaining),
      remainingBanks: money(board?.bankStats?.remaining),
      overdue: board?.stats?.overdue ? `${money(board.stats.overdue.amount)} с ${dateRu(board.stats.overdue.since)}` : null,
    };
  },
};

// ─── План «Прочее» ──────────────────────────────────────────────────────

async function loadOtherPlan(ctx: ToolContext): Promise<any> {
  try { return await ctx.api.get('/finance/expense/other-plan'); } catch (e) { throw apiErr(e); }
}

export const financeOtherPlan: ToolDef<Record<string, never>> = {
  name: 'finance_other_plan',
  kind: 'read',
  description: 'План расходов «Прочее» на ближайшие 12 месяцев: среднее и свои цифры: «какой план на прочее».',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: finance,
  async run(_args, ctx) {
    const plan = await loadOtherPlan(ctx);
    return {
      average: money(plan?.avg),
      months: (plan?.months || []).map((m: any) => `${ymRu(m.ym)}: ${money(m.estimate)}${m.amount != null ? ' (своя цифра)' : ' (среднее)'}`),
    };
  },
};

interface OtherPlanArgs { month: string; amount?: number; reset_to_average?: boolean }

async function prepareOtherPlan(args: OtherPlanArgs, ctx: ToolContext) {
  const ym = checkYm(args.month);
  if (ym < ctx.today.slice(0, 7)) throw new ToolError('План «Прочего» ставится на текущий и будущие месяцы.');
  const reset = args.reset_to_average === true;
  if (!reset && args.amount == null) throw new ToolError('Какую сумму поставить? Или скажи «вернуть среднее».');
  const amount = reset ? null : r2(args.amount);
  if (amount !== null && !(amount >= 0)) throw new ToolError('Сумма не может быть меньше нуля.');
  const plan = await loadOtherPlan(ctx);
  const row = (plan?.months || []).find((m: any) => m.ym === ym);
  if (!row) throw new ToolError('План «Прочего» можно ставить только на ближайшие 12 месяцев.');
  return {
    ym, amount, prev: row.amount as number | null, estimate: row.estimate as number,
    preview: amount === null
      ? `📊 ПЛАН «ПРОЧЕЕ»: ВЕРНУТЬ СРЕДНЕЕ\n${ymRu(ym)}: ${money(row.estimate)} → среднее ${money(plan.avg)}`
      : `📊 ПЛАН «ПРОЧЕЕ» ${money(amount)}\n${ymRu(ym)}: сейчас ${money(row.estimate)} → ${money(amount)}`,
  };
}

export const setOtherPlan: ToolDef<OtherPlanArgs> = {
  name: 'set_other_plan',
  kind: 'write',
  description:
    'Поставить свою цифру плана расходов «Прочее» на месяц («на декабрь прочее 3000») или вернуть среднее. Это ПЛАН, а не расход: '
    + 'настоящий расход записывается через record_operation.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ (текущий или будущий).' },
      amount: { type: 'number', description: 'Плановая сумма, сомони.' },
      reset_to_average: { type: 'boolean', description: 'true — убрать свою цифру, вернуть среднее.' },
    },
    required: ['month'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareOtherPlan(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareOtherPlan(args, ctx);
    try { await ctx.api.post('/finance/expense/other-plan', { ym: p.ym, amount: p.amount }); } catch (e) { throw apiErr(e); }
    return {
      summary: p.amount === null ? `📊 «Прочее» ${ymRu(p.ym)}: возвращено среднее` : `📊 «Прочее» ${ymRu(p.ym)}: план ${money(p.amount)}`,
      undo: [{ method: 'POST', path: '/finance/expense/other-plan', body: { ym: p.ym, amount: p.prev } }],
    };
  },
};

// ─── Плановые оплаты клиентов ───────────────────────────────────────────

export const clientPlans: ToolDef<{ client: string; month?: string }> = {
  name: 'client_plans',
  kind: 'read',
  description:
    'Плановые оплаты клиента в финансах: что ожидается, на какую дату, что уже получено: «когда Архидея должна заплатить», '
    + '«какие планы по Сеченаку». Метки (X…) нужны для client_plan_update и client_plan_unreceive.',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Клиент/проект в финансах.' },
      month: { type: 'string', description: 'ГГГГ-ММ; без него — все ожидаемые.' },
    },
    required: ['client'],
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const client = await resolveFinClient(ctx, args.client);
    const ym = args.month ? checkYm(args.month) : undefined;
    let list: any[];
    try { list = (await ctx.api.get<any[]>('/finance/planned-payments', { projectId: client.id, ym })) || []; } catch (e) { throw apiErr(e); }
    const rows = list.filter((p) => ym || p.status === 'expected');
    return {
      client: client.name,
      clientRef: ctx.refs.add('F', client.id, client.name),
      plans: rows.map((p) => ({
        ref: ctx.refs.add('X', p.id, planLabel(client.id, p.ym, `${client.name} · ${ymRu(p.ym)}`)),
        month: ymRu(p.ym), part: p.partNo, amount: money(p.amount),
        status: p.status === 'received' ? 'получено' : 'ожидается',
        due: p.dueDate ? dateRu(p.dueDate) : 'срок не задан',
      })),
    };
  },
};

interface PlanCreateArgs { client: string; month: string; amount: number; due_date?: string; part?: number }

async function preparePlanCreate(args: PlanCreateArgs, ctx: ToolContext) {
  const client = await resolveFinClient(ctx, args.client);
  const ym = checkYm(args.month);
  const amount = checkAmount(args.amount);
  const due = args.due_date ? checkDate(args.due_date, 'дата срока') : undefined;
  let existing: any[];
  try { existing = (await ctx.api.get<any[]>('/finance/planned-payments', { projectId: client.id, ym })) || []; } catch (e) { throw apiErr(e); }
  const taken = new Set(existing.map((p) => Number(p.partNo) || 1));
  let part = args.part != null ? Math.trunc(Number(args.part)) : 1;
  if (!(part >= 1)) throw new ToolError('Номер части — 1 или больше.');
  if (args.part == null) while (taken.has(part)) part++;
  else if (taken.has(part)) throw new ToolError(`У «${client.name}» на ${ymRu(ym)} часть ${part} уже есть. Измени её через client_plan_update.`);
  const body: Record<string, any> = { projectId: client.id, ym, amount, partNo: part };
  if (due) body.dueDate = due;
  return {
    client, ym, amount, body,
    preview: `📌 ПЛАН ОПЛАТЫ КЛИЕНТА ${money(amount)}\n${client.name} · ${ymRu(ym)}${part > 1 ? ` · часть ${part}` : ''}\n📅 Срок: ${due ? dateRu(due) : 'не задан'}\nДеньги не поступают — это только ожидание.`,
  };
}

export const clientPlanCreate: ToolDef<PlanCreateArgs> = {
  name: 'client_plan_create',
  kind: 'write',
  description:
    'Запланировать ожидаемую оплату клиента на месяц (и срок): «ожидаем от Асана 2500 в декабре до 15-го». Деньги не поступают. '
    + 'Когда клиент реально заплатил — client_payment.',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Клиент/проект в финансах.' },
      month: { type: 'string', description: 'За какой месяц, ГГГГ-ММ.' },
      amount: { type: 'number' },
      due_date: { type: 'string', description: 'Срок оплаты ГГГГ-ММ-ДД.' },
      part: { type: 'number', description: 'Номер части оплаты (1, 2…); по умолчанию первая свободная.' },
    },
    required: ['client', 'month', 'amount'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePlanCreate(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePlanCreate(args, ctx);
    let res: any;
    try { res = await ctx.api.post('/finance/planned-payments', p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `📌 План: ${p.client.name} — ${money(p.amount)} за ${ymRu(p.ym)}`,
      undo: res?.id ? [{ method: 'DELETE', path: `/finance/planned-payments/${res.id}` }] : undefined,
    };
  },
};

interface PlanUpdateArgs { plan: string; amount?: number; due_date?: string; clear_due_date?: boolean }

async function preparePlanUpdate(args: PlanUpdateArgs, ctx: ToolContext) {
  const { plan, clientName } = await loadPlan(ctx, args.plan);
  if (plan.status === 'received') throw new ToolError('Полученную оплату не правят: сначала снять получение (client_plan_unreceive) или изменить операцию.');
  const body: Record<string, any> = {};
  const back: Record<string, any> = {};
  const lines: string[] = [];
  if (args.amount != null) {
    const amount = checkAmount(args.amount);
    if (Math.abs(amount - Number(plan.amount)) > 0.004) {
      body.amount = amount; back.amount = Number(plan.amount);
      lines.push(`Сумма: ${money(plan.amount)} → ${money(amount)}`);
    }
  }
  const prevDue = plan.dueDate ? String(plan.dueDate).slice(0, 10) : null;
  if (args.clear_due_date) {
    if (prevDue) { body.dueDate = null; back.dueDate = prevDue; lines.push(`Срок: ${dateRu(prevDue)} → без срока`); }
  } else if (args.due_date) {
    const due = checkDate(args.due_date, 'дата срока');
    if (due !== prevDue) { body.dueDate = due; back.dueDate = prevDue; lines.push(`Срок: ${dateRu(prevDue)} → ${dateRu(due)}`); }
  }
  if (!lines.length) throw new ToolError('Нечего менять: назови новую сумму или новый срок (отличающиеся от текущих).');
  return { plan, body, back, preview: `✏️ ИЗМЕНИТЬ ПЛАН ОПЛАТЫ\n${clientName} · ${ymRu(plan.ym)}\n${lines.join('\n')}` };
}

export const clientPlanUpdate: ToolDef<PlanUpdateArgs> = {
  name: 'client_plan_update',
  kind: 'write',
  description:
    'Изменить ожидаемую плановую оплату клиента: срок или сумму: «перенеси оплату Асана на 20-е», «Сеченак заплатит не 3500, а 3000». '
    + 'Только ещё не полученные. Метку (X…) бери из client_plans. НЕ для реальной оплаты (client_payment).',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'Метка плана из client_plans.' },
      amount: { type: 'number', description: 'Новая сумма.' },
      due_date: { type: 'string', description: 'Новый срок ГГГГ-ММ-ДД.' },
      clear_due_date: { type: 'boolean', description: 'true — убрать срок.' },
    },
    required: ['plan'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePlanUpdate(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePlanUpdate(args, ctx);
    try { await ctx.api.patch(`/finance/planned-payments/${p.plan.id}`, p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `✏️ План оплаты изменён: ${p.preview.split('\n').slice(2).join('; ')}`,
      undo: [{ method: 'PATCH', path: `/finance/planned-payments/${p.plan.id}`, body: p.back }],
    };
  },
};

export const clientPlanUnreceive: ToolDef<{ plan: string }> = {
  name: 'client_plan_unreceive',
  kind: 'write',
  description:
    'Снять получение: оплата клиента отмечена полученной по ошибке — вернуть её в ожидаемые, операция дохода отменяется, баланс счёта уменьшится: '
    + '«отмени оплату Сеченака». Метку (X…) бери из client_plans (статус «получено»).',
  parameters: {
    type: 'object',
    properties: { plan: { type: 'string', description: 'Метка полученного плана из client_plans.' } },
    required: ['plan'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const { plan, clientName } = await loadPlan(ctx, args.plan);
    if (plan.status !== 'received') throw new ToolError('Эта оплата ещё не получена — снимать нечего.');
    return `↩ СНЯТЬ ПОЛУЧЕНИЕ ОПЛАТЫ ${money(plan.amount)}\n${clientName} · ${ymRu(plan.ym)}\n⚠ Доход будет отменён, баланс счёта уменьшится. Оплата снова станет ожидаемой.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { plan, clientName } = await loadPlan(ctx, args.plan);
    if (plan.status !== 'received') throw new ToolError('Эта оплата ещё не получена — снимать нечего.');
    try { await ctx.api.post(`/finance/planned-payments/${plan.id}/unreceive`, {}); } catch (e) { throw apiErr(e); }
    return { summary: `↩ ${clientName}: получение ${money(plan.amount)} за ${ymRu(plan.ym)} снято` };
  },
};

// ─── Доходы, расходы, прогноз, балансы ──────────────────────────────────

const DIRECTIONS = ['smm', 'development', 'design', 'maintenance'];
const DIRECTION_RU: Record<string, string> = { smm: 'SMM', development: 'Разработка', design: 'Дизайн', maintenance: 'Сопровождение' };

export const financeIncome: ToolDef<{ month?: string; direction?: string; only_overdue?: boolean }> = {
  name: 'finance_income',
  kind: 'read',
  description:
    'Доходы по направлениям (SMM, разработка, дизайн, сопровождение): получено, план, ожидается; с направлением — по клиентам, '
    + 'кто просрочил оплату: «сколько получили по SMM», «кто просрочил оплату». Только чтение.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      direction: { type: 'string', enum: DIRECTIONS, description: 'Без него — сводка по всем направлениям.' },
      only_overdue: { type: 'boolean', description: 'Только клиенты с просрочкой (нужно направление).' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const ym = args.month ? checkYm(args.month) : ctx.today.slice(0, 7);
    if (!args.direction) {
      let dirs: any[];
      try { dirs = (await ctx.api.get<any[]>('/finance/income/directions', { ym })) || []; } catch (e) { throw apiErr(e); }
      return {
        month: ymRu(ym),
        directions: dirs.map((d) => ({
          direction: DIRECTION_RU[d.direction] || d.direction, code: d.direction,
          received: money(d.received), plan: money(d.plan), expected: money(d.expected), clients: d.projectCount,
        })),
      };
    }
    if (!DIRECTIONS.includes(args.direction)) throw new ToolError(`Направление: ${DIRECTIONS.join(', ')}.`);
    let detail: any;
    try { detail = await ctx.api.get(`/finance/income/directions/${args.direction}`, { ym }); } catch (e) { throw apiErr(e); }
    const rows: any[] = (detail?.rows || []).filter((r: any) => r.project);
    const picked = args.only_overdue ? rows.filter((r) => Number(r.overdue) > 0) : rows;
    return {
      month: ymRu(ym), direction: DIRECTION_RU[args.direction],
      clients: picked.map((r) => ({
        ref: ctx.refs.add('F', r.project.id, r.project.name),
        name: r.project.name,
        tariff: money(r.project.tariff),
        paidThisMonth: money(r.monthPaid),
        remaining: money(r.remaining),
        ...(Number(r.overdue) > 0 ? { overdue: money(r.overdue) } : {}),
        ...(r.nextDue ? { nextDue: `${money(r.nextDue.amount)} до ${dateRu(r.nextDue.dueDate)}` } : {}),
      })),
    };
  },
};

export const financeExpenseGroups: ToolDef<{ month?: string; group?: string }> = {
  name: 'finance_expense_groups',
  kind: 'read',
  description:
    'Расходы по группам за месяц: зарплаты, аренда и подписки, долги, рассрочки, прочее — сколько потрачено и сколько ещё к оплате: '
    + '«сколько ушло на зарплаты в ноябре», «что ещё надо оплатить в этом месяце». С group=other — «Прочее» по статьям. '
    + 'Сводка общих итогов — finance_summary; подписки и долги подробно — finance_subscriptions и finance_debts.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' },
      group: { type: 'string', enum: ['other', 'salary'], description: 'other — «Прочее» по статьям; salary — итоги зарплат. Без него — все группы.' },
    },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const ym = args.month ? checkYm(args.month) : ctx.today.slice(0, 7);
    if (args.group === 'other') {
      let d: any;
      try { d = await ctx.api.get('/finance/expense/detail/other', { ym }); } catch (e) { throw apiErr(e); }
      return { month: ymRu(ym), total: money(d?.total), categories: (d?.rows || []).map((r: any) => `${r.name}: ${money(r.total)} (${r.share}%)`) };
    }
    if (args.group === 'salary') {
      let d: any;
      try { d = await ctx.api.get('/finance/expense/detail/salary', { ym }); } catch (e) { throw apiErr(e); }
      const c = d?.cards || {};
      return {
        month: ymRu(ym), fund: money(c.fund), paid: money(c.paid), toPay: money(c.toPay),
        advances: money(c.advances), bonuses: money(c.bonuses), fines: money(c.fines), period: d?.period?.status,
      };
    }
    if (args.group) throw new ToolError('Группа: other или salary; остальное — finance_subscriptions, finance_debts, finance_installments.');
    let s: any;
    try { s = await ctx.api.get('/finance/expense/summary', { ym }); } catch (e) { throw apiErr(e); }
    return {
      month: ymRu(ym),
      salary: { spent: money(s?.salary?.spent), toPay: money(s?.salary?.toPay) },
      subscriptions: { spent: money(s?.subscriptions?.spent), toPay: money(s?.subscriptions?.toPay) },
      debts: { spent: money(s?.debts?.spent), toPay: money(s?.debts?.toPay), overdue: money(s?.debts?.overdue), remainingTotal: money(s?.debts?.remaining) },
      installments: { toPay: money(s?.installments?.banks?.month?.toPay), overdue: money(s?.installments?.banks?.month?.overdue) },
      other: { spent: money(s?.other?.spent) },
    };
  },
};

export const financeForecast: ToolDef<{ months?: number }> = {
  name: 'finance_forecast',
  kind: 'read',
  description: 'Прогноз денег по месяцам вперёд: ожидаемый доход, расход и остаток на конец месяца: «какой прогноз на квартал», «хватит ли денег до весны».',
  parameters: {
    type: 'object',
    properties: { months: { type: 'number', description: 'На сколько месяцев, 1–12. По умолчанию 6.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const months = Math.min(12, Math.max(1, Math.trunc(Number(args.months)) || 6));
    let f: any;
    try { f = await ctx.api.get('/finance/forecast', { start: ctx.today.slice(0, 7), months, scenario: 'base' }); } catch (e) { throw apiErr(e); }
    return {
      openingBalance: money(f?.openingBalance),
      months: (f?.rows || []).map((r: any) => ({
        month: ymRu(r.ym), income: money(r.income), expense: money(r.expense), net: money(r.net), closingBalance: money(r.closingBalance),
        negative: Number(r.closingBalance) < 0,
      })),
    };
  },
};

export const financeBalanceDays: ToolDef<{ month?: string }> = {
  name: 'finance_balance_days',
  kind: 'read',
  description: 'Остаток денег по дням месяца (сколько было на конец каждого дня), минимум и максимум: «как менялся баланс в ноябре», «когда было меньше всего денег».',
  parameters: {
    type: 'object',
    properties: { month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const ym = args.month ? checkYm(args.month) : ctx.today.slice(0, 7);
    let res: any;
    try { res = await ctx.api.get('/finance/accounts/balance-days', { ym }); } catch (e) { throw apiErr(e); }
    const known = (res?.days || []).filter((d: any) => d.balance != null);
    if (!known.length) return { month: ymRu(ym), note: 'За этот месяц остатков нет (месяц ещё не наступил или раньше начала учёта).' };
    const changes: string[] = [];
    let prev: number | null = null;
    for (const d of known) {
      if (prev === null || Math.abs(d.balance - prev) > 0.004) changes.push(`${dateRu(d.date)}: ${money(d.balance)}`);
      prev = d.balance;
    }
    const min = known.reduce((a: any, b: any) => (b.balance < a.balance ? b : a));
    const max = known.reduce((a: any, b: any) => (b.balance > a.balance ? b : a));
    return {
      month: ymRu(ym), last: `${dateRu(known[known.length - 1].date)}: ${money(known[known.length - 1].balance)}`,
      min: `${dateRu(min.date)}: ${money(min.balance)}`, max: `${dateRu(max.date)}: ${money(max.balance)}`,
      changes,
    };
  },
};

// ─── Счета и бэкапы ─────────────────────────────────────────────────────

const ACCOUNT_KIND_RU: Record<string, string> = { bank: 'банк', cash: 'наличные', savings: 'накопления' };
const ACCOUNT_KIND_BY_WORD: Record<string, string> = { банк: 'bank', наличные: 'cash', касса: 'cash', накопления: 'savings', накопительный: 'savings' };

export const financeAccounts: ToolDef<{ include_archived?: boolean }> = {
  name: 'finance_accounts',
  kind: 'read',
  description: 'Счета компании с текущими остатками: «какие у нас счета», «сколько на Алифе и в кассе».',
  parameters: {
    type: 'object',
    properties: { include_archived: { type: 'boolean', description: 'Показать и архивные счета.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const [accounts, bal]: [any[], any] = await Promise.all([loadAccounts(ctx), ctx.api.get('/finance/accounts/balances').catch((e) => { throw apiErr(e); })]);
    const balanceOf = new Map<string, number>((bal?.perAccount || []).map((a: any) => [a.id ?? a.accountId, Number(a.balance)]));
    const byName = new Map<string, number>((bal?.perAccount || []).map((a: any) => [a.name, Number(a.balance)]));
    return {
      total: money(bal?.total?.balance),
      accounts: accounts.filter((a) => args.include_archived || !a.archived).map((a) => ({
        name: a.name, kind: a.kind ? ACCOUNT_KIND_RU[a.kind] || a.kind : null,
        balance: money(balanceOf.get(a.id) ?? byName.get(a.name) ?? a.startBalance),
        ...(a.archived ? { archived: true } : {}),
      })),
    };
  },
};

interface CreateAccountArgs { name: string; start_balance?: number; kind?: string }

async function prepareCreateAccount(args: CreateAccountArgs, ctx: ToolContext) {
  const name = String(args.name || '').trim().slice(0, 120);
  if (!name) throw new ToolError('Как назвать счёт?');
  const list = await loadAccounts(ctx);
  if (list.some((a) => norm(a.name) === norm(name))) throw new ToolError(`Счёт «${name}» уже есть.`);
  const start = args.start_balance == null ? 0 : r2(args.start_balance);
  if (!Number.isFinite(start)) throw new ToolError('Неверный начальный остаток.');
  const kindWord = norm(args.kind);
  const kind = args.kind ? (['bank', 'cash', 'savings'].includes(kindWord) ? kindWord : ACCOUNT_KIND_BY_WORD[kindWord]) : undefined;
  if (args.kind && !kind) throw new ToolError('Тип счёта: банк, наличные или накопления.');
  const body: Record<string, any> = { name, startBalance: start };
  if (kind) body.kind = kind;
  return { name, start, kind, body, preview: `🏦 СОЗДАТЬ СЧЁТ «${name}»\nНачальный остаток: ${money(start)}${kind ? `\nТип: ${ACCOUNT_KIND_RU[kind]}` : ''}` };
}

export const createAccount: ToolDef<CreateAccountArgs> = {
  name: 'create_account',
  kind: 'write',
  description: 'Завести новый счёт в финансах: «создай счёт Эсхата с остатком 1000». Не для переводов между счетами (это record_operation).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Название счёта.' },
      start_balance: { type: 'number', description: 'Начальный остаток, по умолчанию 0.' },
      kind: { type: 'string', enum: ['bank', 'cash', 'savings'], description: 'банк / наличные / накопления.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareCreateAccount(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareCreateAccount(args, ctx);
    let acc: any;
    try { acc = await ctx.api.post('/finance/accounts', p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `🏦 Счёт «${p.name}» создан, остаток ${money(p.start)}`,
      undo: acc?.id ? [{ method: 'DELETE', path: `/finance/accounts/${acc.id}` }] : undefined,
    };
  },
};

interface ArchiveAccountArgs { account: string; restore?: boolean }

async function prepareArchive(args: ArchiveAccountArgs, ctx: ToolContext) {
  const restore = args.restore === true;
  const list = await loadAccounts(ctx);
  const pool = list.filter((a) => (restore ? a.archived : !a.archived));
  const s = norm(args.account);
  const scored = pool.map((a) => ({ a, sc: Math.max(matchScore(a.name, s), (ACCOUNT_ALIASES[a.key] || []).some((al) => s.includes(al)) ? 1 : 0) }))
    .filter((x) => x.sc >= 0.5).sort((x, y) => y.sc - x.sc);
  if (!scored.length || (scored.length > 1 && scored[0].sc === scored[1].sc)) {
    throw new ToolError(`Не понял, какой счёт: «${args.account}». ${restore ? 'Архивные' : 'Действующие'}: ${pool.map((a) => a.name).join(', ') || 'нет'}.`);
  }
  const acc = scored[0].a;
  let bal: any;
  try { bal = await ctx.api.get('/finance/accounts/balances'); } catch (e) { throw apiErr(e); }
  const cur = (bal?.perAccount || []).find((a: any) => (a.id ?? a.accountId) === acc.id || a.name === acc.name);
  return {
    acc, restore,
    preview: restore
      ? `♻️ ВЕРНУТЬ СЧЁТ ИЗ АРХИВА «${acc.name}»`
      : `📦 АРХИВИРОВАТЬ СЧЁТ «${acc.name}»\nОстаток сейчас: ${money(cur?.balance ?? acc.startBalance)} Счёт скроется из списков, история останется.`,
  };
}

export const archiveAccount: ToolDef<ArchiveAccountArgs> = {
  name: 'archive_account',
  kind: 'write',
  description: 'Архивировать счёт (скрыть из списков, история цела) или вернуть из архива: «убери счёт Эсхата в архив». Счёт не удаляется.',
  parameters: {
    type: 'object',
    properties: {
      account: { type: 'string', description: 'Название счёта.' },
      restore: { type: 'boolean', description: 'true — вернуть из архива.' },
    },
    required: ['account'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareArchive(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareArchive(args, ctx);
    try { await ctx.api.patch(`/finance/accounts/${p.acc.id}`, { archived: !p.restore }); } catch (e) { throw apiErr(e); }
    return {
      summary: p.restore ? `♻️ Счёт «${p.acc.name}» возвращён из архива` : `📦 Счёт «${p.acc.name}» в архиве`,
      undo: [{ method: 'PATCH', path: `/finance/accounts/${p.acc.id}`, body: { archived: p.restore } }],
    };
  },
};

export const financeBackups: ToolDef<Record<string, never>> = {
  name: 'finance_backups',
  kind: 'read',
  description: 'Список снимков (бэкапов) данных финансов: когда сделаны и что в них. Только чтение: восстановление из бэкапа голосом не делается — только на сайте.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: finance,
  async run(_args, ctx) {
    let list: any[];
    try { list = (await ctx.api.get<any[]>('/finance/backups')) || []; } catch (e) { throw apiErr(e); }
    return {
      count: list.length,
      backups: list.slice(0, 15).map((b) => {
        const when = splitDushanbe(b.createdAt);
        return {
          kind: b.kind,
          createdAt: when ? `${dateRu(when.date)}, ${when.time}` : null,
          transactions: b.stats?.transactions, accounts: b.stats?.accounts, employees: b.stats?.employees,
        };
      }),
    };
  },
};

// ─── Транспорт ──────────────────────────────────────────────────────────

const TRANSPORT_STATUS_RU: Record<string, string> = { pending: 'ждёт оплаты', paid: 'оплачена', rejected: 'отклонена' };
const TRANSPORT_MAX = 5000;

function transportView(ctx: ToolContext, r: any, withPerson: boolean) {
  const ref = ctx.refs.add('R', r.id, `${r.projectName || 'проект'} · ${money(r.amount)}${r.employeeName ? ` · ${r.employeeName}` : ''}`);
  return {
    ref,
    ...(withPerson ? { employee: r.employeeName } : {}),
    project: r.projectName, amount: money(r.amount), tripDate: dateRu(r.date),
    status: TRANSPORT_STATUS_RU[r.status] || r.status,
    ...(r.note ? { note: r.note } : {}),
    ...(r.rejectReason ? { rejectReason: r.rejectReason } : {}),
  };
}

export const transportList: ToolDef<{ month?: string }> = {
  name: 'transport_list',
  kind: 'read',
  description:
    'Заявки на транспорт (возврат денег за проезд). Основатель видит заявки всех, которые ждут оплаты, и решённые за месяц; '
    + 'SMM-специалист и видеограф — свои: «какие заявки на транспорт ждут оплаты», «мои заявки на проезд». Метки (R…) нужны для оплаты и отмены.',
  parameters: {
    type: 'object',
    properties: { month: { type: 'string', description: 'ГГГГ-ММ для решённых заявок (только основатель).' } },
    additionalProperties: false,
  },
  available: transportUser,
  async run(args, ctx) {
    if (finance(ctx.user)) {
      const ym = args.month ? checkYm(args.month) : undefined;
      let res: any;
      try { res = await ctx.api.get('/transport-requests', { ym }); } catch (e) { throw apiErr(e); }
      return {
        month: ymRu(res?.ym || ctx.today.slice(0, 7)),
        pendingTotal: money(res?.totals?.pendingSum), pendingCount: res?.totals?.pendingCount,
        paidTotal: money(res?.totals?.paidSum),
        pending: (res?.pending || []).map((r: any) => transportView(ctx, r, true)),
        decided: (res?.done || []).map((r: any) => transportView(ctx, r, true)),
      };
    }
    let res: any;
    try { res = await ctx.api.get('/transport-requests/my'); } catch (e) { throw apiErr(e); }
    return {
      waiting: money(res?.pendingSum), waitingCount: res?.pendingCount, returnedThisMonth: money(res?.paidMonthSum),
      requests: (res?.items || []).slice(0, 15).map((r: any) => transportView(ctx, r, false)),
    };
  },
};

interface TransportCreateArgs { project: string; amount: number; date?: string; note?: string }

async function prepareTransportCreate(args: TransportCreateArgs, ctx: ToolContext) {
  const amount = r2(args.amount);
  if (!(amount > 0) || amount > TRANSPORT_MAX) throw new ToolError(`Сумма заявки — от 1 до ${TRANSPORT_MAX} сомони.`);
  const date = args.date ? checkDate(args.date, 'дата поездки') : ctx.today;
  if (date > ctx.today) throw new ToolError('Дата поездки не может быть в будущем.');
  if (date < addDays(ctx.today, -60)) throw new ToolError('Заявку можно подать за поездку не старше 60 дней.');
  let projects: any[];
  try { projects = (await ctx.api.get<any[]>('/transport-requests/projects')) || []; } catch (e) { throw apiErr(e); }
  const byRef = ctx.refs.resolve('P', args.project);
  let project = byRef ? projects.find((p) => p.id === byRef.id) : undefined;
  if (!project) {
    const scored = projects.map((p) => ({ p, sc: matchScore(p.name, String(args.project || '')) })).filter((x) => x.sc >= 0.5);
    const best = scored.length ? Math.max(...scored.map((x) => x.sc)) : 0;
    const top = scored.filter((x) => x.sc === best);
    if (!top.length) throw new ToolError(`Не нашёл проект «${args.project}». Назови проект точнее.`);
    const mine = top.filter((x) => x.p.mine);
    const pool = mine.length ? mine : top;
    const names = new Set(pool.map((x) => x.p.name));
    if (pool.length > 1) {
      throw new ToolError(names.size === 1
        ? `В CRM несколько проектов с названием «${pool[0].p.name}» — подай заявку на сайте, чтобы выбрать нужный.`
        : `Подходит несколько проектов: ${[...names].slice(0, 6).join(', ')}. Уточни через ask_choice.`);
    }
    project = pool[0].p;
  }
  const note = args.note ? String(args.note).trim().slice(0, 300) : '';
  const body: Record<string, any> = { projectId: project.id, amount, date };
  if (note) body.note = note;
  return {
    project, amount, body,
    preview: `🚗 ЗАЯВКА НА ТРАНСПОРТ ${money(amount)}\nПроект: ${project.name}\n📅 Поездка: ${dateRu(date)}${note ? `\n📝 ${note}` : ''}\nЗаявка уйдёт основателю на оплату. Фото чека голосом не прикрепить — добавь на сайте.`,
  };
}

export const transportCreate: ToolDef<TransportCreateArgs> = {
  name: 'transport_create',
  kind: 'write',
  description:
    'Подать заявку на возврат денег за проезд по работе (только SMM-специалист и видеограф): «подай заявку на такси 30 сомони по проекту Архидея». '
    + 'Нужны проект и сумма (до 5000), дата поездки — не старше 60 дней. НЕ для записи расхода компании (record_operation).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Проект поездки.' },
      amount: { type: 'number', description: 'Сумма, сомони.' },
      date: { type: 'string', description: 'Дата поездки ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      note: { type: 'string', description: 'Куда ездил.' },
    },
    required: ['project', 'amount'],
    additionalProperties: false,
  },
  available: canRequestTransport,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareTransportCreate(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareTransportCreate(args, ctx);
    let res: any;
    try { res = await ctx.api.post('/transport-requests', p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `🚗 Заявка на транспорт подана: ${money(p.amount)} · ${p.project.name}`,
      undo: res?.id ? [{ method: 'DELETE', path: `/transport-requests/${res.id}` }] : undefined,
    };
  },
};

async function myTransport(ctx: ToolContext, ref: unknown): Promise<any> {
  const entry = ctx.refs.resolve('R', ref);
  if (!entry) throw new ToolError('Не знаю такую заявку. Сначала покажи заявки через transport_list.');
  let res: any;
  try { res = await ctx.api.get('/transport-requests/my'); } catch (e) { throw apiErr(e); }
  const r = (res?.items || []).find((x: any) => x.id === entry.id);
  if (!r) throw new ToolError('Это не твоя заявка или она уже удалена.');
  return r;
}

export const transportCancel: ToolDef<{ request: string }> = {
  name: 'transport_cancel',
  kind: 'write',
  description: 'Отозвать СВОЮ неоплаченную заявку на транспорт: «отмени мою заявку на такси». Метку (R…) бери из transport_list. Оплаченные не отзываются.',
  parameters: {
    type: 'object',
    properties: { request: { type: 'string', description: 'Метка заявки из transport_list.' } },
    required: ['request'],
    additionalProperties: false,
  },
  available: canRequestTransport,
  confirm: () => true,
  async preview(args, ctx) {
    const r = await myTransport(ctx, args.request);
    if (r.status !== 'pending') throw new ToolError('Отозвать можно только заявку, которая ждёт оплаты.');
    return `🗑 ОТОЗВАТЬ ЗАЯВКУ НА ТРАНСПОРТ ${money(r.amount)}\n${r.projectName} · поездка ${dateRu(r.date)}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const r = await myTransport(ctx, args.request);
    if (r.status !== 'pending') throw new ToolError('Отозвать можно только заявку, которая ждёт оплаты.');
    try { await ctx.api.delete(`/transport-requests/${r.id}`); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 Заявка на транспорт ${money(r.amount)} отозвана` };
  },
};

async function pendingTransport(ctx: ToolContext, ref: unknown): Promise<any> {
  const entry = ctx.refs.resolve('R', ref);
  if (!entry) throw new ToolError('Не знаю такую заявку. Сначала покажи заявки через transport_list.');
  let res: any;
  try { res = await ctx.api.get('/transport-requests'); } catch (e) { throw apiErr(e); }
  const r = (res?.pending || []).find((x: any) => x.id === entry.id);
  if (!r) throw new ToolError('Заявка не найдена среди ждущих оплаты — возможно, её уже оплатили или отклонили.');
  return r;
}

export const transportPay: ToolDef<{ request: string; account: string }> = {
  name: 'transport_pay',
  kind: 'write',
  description:
    'Оплатить заявку на транспорт (только основатель): со счёта списывается расход «Транспорт», сотрудник получает уведомление: '
    + '«оплати заявку Рахимова на такси с Алифа». Метку (R…) бери из transport_list.',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'Метка заявки из transport_list.' },
      account: { type: 'string', description: 'Со счёта: Алиф, Dushanbe City, наличные.' },
    },
    required: ['request', 'account'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const r = await pendingTransport(ctx, args.request);
    const acc = await resolveAccount(ctx, args.account);
    return `🚗 ОПЛАТИТЬ ТРАНСПОРТ ${money(r.amount)}\n${r.employeeName} · ${r.projectName} · поездка ${dateRu(r.date)}\n🏦 Со счёта: ${acc.name}\nСотрудник получит уведомление об оплате.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const r = await pendingTransport(ctx, args.request);
    const acc = await resolveAccount(ctx, args.account);
    try { await ctx.api.post(`/transport-requests/${r.id}/pay`, { accountId: acc.id }); } catch (e) { throw apiErr(e); }
    return { summary: `🚗 Транспорт оплачен: ${r.employeeName} — ${money(r.amount)} со счёта ${acc.name}` };
  },
};

export const transportReject: ToolDef<{ request: string; reason: string }> = {
  name: 'transport_reject',
  kind: 'write',
  description: 'Отклонить заявку на транспорт с причиной (только основатель); сотрудник увидит причину: «отклони заявку Рахимова, поездка не по работе». Метку (R…) бери из transport_list.',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'Метка заявки из transport_list.' },
      reason: { type: 'string', description: 'Причина отказа, как сказал основатель.' },
    },
    required: ['request', 'reason'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    const r = await pendingTransport(ctx, args.request);
    const reason = String(args.reason || '').trim().slice(0, 200);
    if (!reason) throw new ToolError('Нужна причина отказа — сотрудник её увидит.');
    return `❌ ОТКЛОНИТЬ ЗАЯВКУ НА ТРАНСПОРТ ${money(r.amount)}\n${r.employeeName} · ${r.projectName}\nПричина: ${reason}\nСотрудник получит уведомление.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const r = await pendingTransport(ctx, args.request);
    const reason = String(args.reason || '').trim().slice(0, 200);
    if (!reason) throw new ToolError('Нужна причина отказа — сотрудник её увидит.');
    try { await ctx.api.post(`/transport-requests/${r.id}/reject`, { reason }); } catch (e) { throw apiErr(e); }
    return { summary: `❌ Заявка ${r.employeeName} на ${money(r.amount)} отклонена: ${reason}` };
  },
};

export const FINANCE2_TOOLS: ToolDef[] = [
  financeJournal, cancelOperation, editOperation,
  financeDebts, payDebt, cancelDebtPayment,
  financeSubscriptions, paySubscription, markSubscriptionPaid,
  financeInstallments, financeOtherPlan, setOtherPlan,
  clientPlans, clientPlanCreate, clientPlanUpdate, clientPlanUnreceive,
  financeIncome, financeExpenseGroups, financeForecast, financeBalanceDays,
  financeAccounts, createAccount, archiveAccount, financeBackups,
  transportList, transportCreate, transportCancel, transportPay, transportReject,
];
