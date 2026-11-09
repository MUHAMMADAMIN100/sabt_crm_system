import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { checkDate, fmtDateRu, matchScore, norm } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';
import { SALARY_WORDS } from './salary.tools';

/**
 * Финансы — только у кого finance.manage (основатель), как раздел на сайте.
 * Любые деньги — через «Подтвердить»; отмена = отмена операции на сайте.
 * Зарплаты, долги, подписки и рассрочки голосом не проводим: там нужны
 * сотрудник/долг/период — бот бы их угадывал.
 */

const finance = (u: any) => hasGrant(u, 'finance.manage');
const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
// Копейки (дирамы) не округляем: «7,5» не должно превратиться в «8».
const money = (n: unknown) => `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом.`;
const currentYm = (today: string) => today.slice(0, 7);

const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ymRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function checkYm(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ToolError(`Неверный месяц «${s}». Нужно ГГГГ-ММ.`);
  return s;
}

function checkAmount(v: unknown): number {
  const n = Math.round(Number(v) * 100) / 100;
  if (!(n > 0) || n > 100_000_000) throw new ToolError('Сумма должна быть больше нуля.');
  return n;
}

const ACCOUNT_ALIASES: Record<string, string[]> = {
  cash: ['нал', 'наличн', 'кэш', 'кеш', 'касс'],
  alif: ['алиф', 'alif'],
  dushanbe_city: ['душанбе сити', 'dushanbe city', 'дс банк', 'сити'],
};

async function resolveAccount(ctx: ToolContext, spoken: unknown): Promise<{ id: string; name: string }> {
  const list: any[] = (await ctx.api.get<any[]>('/finance/accounts').catch((e) => { throw apiErr(e); })) || [];
  const active = list.filter((a) => !a.archived);
  const names = active.map((a) => a.name).join(', ');
  const s = norm(spoken);
  if (!s) throw new ToolError(`С какого счёта? Счета: ${names}.`);
  const byAlias = active.filter((a) => (ACCOUNT_ALIASES[a.key] || []).some((al) => s.includes(al)));
  if (byAlias.length === 1) return { id: byAlias[0].id, name: byAlias[0].name };
  const scored = active.map((a) => ({ a, sc: matchScore(a.name, s) })).filter((x) => x.sc >= 0.5).sort((x, y) => y.sc - x.sc);
  if (scored.length === 1 || (scored.length > 1 && scored[0].sc > scored[1].sc)) return { id: scored[0].a.id, name: scored[0].a.name };
  throw new ToolError(`Не понял, какой счёт: «${spoken}». Счета: ${names}. Уточните через ask_choice.`);
}

async function resolveCategory(ctx: ToolContext, spoken: unknown, type: string): Promise<{ id: string; name: string } | null> {
  const list: any[] = (await ctx.api.get<any[]>('/finance/categories').catch((e) => { throw apiErr(e); })) || [];
  const fit = list.filter((c) => !c.archived && c.type === type);
  const s = norm(spoken);
  if (!s) return null;
  const scored = fit.map((c) => ({ c, sc: matchScore(c.name, s) })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!scored.length || (scored.length > 1 && scored[0].sc === scored[1].sc)) {
    throw new ToolError(`Не нашёл статью «${spoken}». Статьи (${type === 'income' ? 'доход' : 'расход'}): ${fit.map((c) => c.name).join(', ')}. Уточните через ask_choice.`);
  }
  const cat = scored[0].c;
  if (['salary', 'debt', 'subscription', 'installment'].includes(cat.key)) {
    throw new ToolError(`Статью «${cat.name}» голосом не провожу: нужен сотрудник/долг/период. Проведите её на сайте в «Финансах».`);
  }
  return { id: cat.id, name: cat.name };
}

async function resolveFinClient(ctx: ToolContext, spoken: unknown): Promise<{ id: string; name: string }> {
  const asRef = ctx.refs.resolve('F', spoken);
  if (asRef) return { id: asRef.id, name: asRef.label };
  const list: any[] = (await ctx.api.get<any[]>('/finance/projects').catch((e) => { throw apiErr(e); })) || [];
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

// ─── Чтение ─────────────────────────────────────────────────────────────

export const financeSummary: ToolDef<{ month?: string }> = {
  name: 'finance_summary',
  kind: 'read',
  description: 'Финансы за месяц: доход, расход, прибыль, балансы счетов, крупные статьи расходов. «Какой баланс», «сколько потратили в этом месяце».',
  parameters: {
    type: 'object',
    properties: { month: { type: 'string', description: 'ГГГГ-ММ, по умолчанию текущий.' } },
    additionalProperties: false,
  },
  available: finance,
  async run(args, ctx) {
    const ym = args.month ? checkYm(args.month) : currentYm(ctx.today);
    let ov: any;
    let bal: any;
    try {
      [ov, bal] = await Promise.all([ctx.api.get('/finance/overview', { ym }), ctx.api.get('/finance/accounts/balances')]);
    } catch (e) { throw apiErr(e); }
    const top = (ov?.expenseByCategory || [])
      .slice().sort((a: any, b: any) => Number(b.total) - Number(a.total)).slice(0, 6)
      .map((c: any) => `${c.name}: ${money(c.total)}`);
    return {
      month: ymRu(ym),
      income: money(ov?.income), expense: money(ov?.expense), profit: money(ov?.profit),
      balanceTotal: money(bal?.total?.balance),
      accounts: (bal?.perAccount || []).map((a: any) => `${a.name}: ${money(a.balance)}`),
      topExpenses: top,
      ...(ov?.stats?.expectedThisMonth != null ? { expectedIncomeThisMonth: money(ov.stats.expectedThisMonth) } : {}),
    };
  },
};

// ─── Запись ─────────────────────────────────────────────────────────────

interface OpArgs {
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  account?: string;
  to_account?: string;
  category?: string;
  comment?: string;
  date?: string;
}

async function prepareOperation(args: OpArgs, ctx: ToolContext) {
  // 09.11.2026: «Оштрафуй Мухаммадамина на 500» ИИ провёл как расход «Прочее».
  // Штраф, премия, аванс, зарплата — это ведомость сотрудника, не расход
  // компании: такую подмену не пропускаем.
  if (SALARY_WORDS.test(ctx.utterance)) {
    throw new ToolError('Это просьба про зарплату сотрудника (штраф/премия/аванс/выплата), а не расход компании. Используй salary_accrual или salary_payout; если сотрудник или смысл неясны — спроси через ask_choice.');
  }
  if (!['income', 'expense', 'transfer'].includes(args.type)) throw new ToolError('Тип операции: доход, расход или перевод.');
  const amount = checkAmount(args.amount);
  const date = args.date ? checkDate(args.date) : ctx.today;
  const body: Record<string, any> = { type: args.type, amount, date };
  if (args.comment) body.comment = String(args.comment).slice(0, 2000);
  const lines: string[] = [];
  if (args.type === 'transfer') {
    const from = await resolveAccount(ctx, args.account);
    const to = await resolveAccount(ctx, args.to_account);
    if (from.id === to.id) throw new ToolError('Перевод на тот же счёт.');
    body.fromAccountId = from.id; body.toAccountId = to.id;
    lines.push(`🔁 Перевод ${money(amount)}: ${from.name} → ${to.name}`);
  } else {
    const acc = await resolveAccount(ctx, args.account);
    const cat = await resolveCategory(ctx, args.category, args.type);
    if (!cat) throw new ToolError(`Какая статья ${args.type === 'income' ? 'дохода' : 'расхода'}? Уточните.`);
    body.accountId = acc.id; body.categoryId = cat.id;
    lines.push(`${args.type === 'income' ? '➕ Доход' : '➖ Расход'} ${money(amount)} — ${cat.name}, счёт ${acc.name}`);
  }
  lines.push(`📅 ${fmtDateRu(date)}${args.comment ? `\n📝 ${args.comment}` : ''}`);
  return { body, preview: lines.join('\n') };
}

export const recordOperation: ToolDef<OpArgs> = {
  name: 'record_operation',
  kind: 'write',
  description:
    'Записать операцию компании: расход («запиши расход 300 на рекламу с Алифа»), доход, перевод между счетами. '
    + 'НЕ для штрафов, премий, авансов и зарплаты сотрудникам — для них salary_accrual / salary_payout. '
    + 'Нужны сумма, счёт (Алиф / Dushanbe City / Наличные) и статья. Оплату клиента за проект проводи через client_payment.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
      amount: { type: 'number', description: 'Сумма в сомони.' },
      account: { type: 'string', description: 'Счёт, как сказали («с Алифа», «наличными»). Для перевода — откуда.' },
      to_account: { type: 'string', description: 'Для перевода — куда.' },
      category: { type: 'string', description: 'Статья: Реклама, Транспорт, Печать, Налоги, Прочее…' },
      comment: { type: 'string' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    required: ['type', 'amount'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareOperation(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { body, preview } = await prepareOperation(args, ctx);
    let tx: any;
    try { tx = await ctx.api.post('/finance/operations', body); } catch (e) { throw apiErr(e); }
    return {
      summary: `💰 Записано: ${preview.split('\n')[0].replace(/^[^\s]+\s/, '')}`,
      undo: tx?.id ? [{ method: 'DELETE', path: `/finance/transactions/${tx.id}` }] : undefined,
    };
  },
};

interface PayArgs { client: string; amount: number; month?: string; account: string }

async function preparePayment(args: PayArgs, ctx: ToolContext) {
  const client = await resolveFinClient(ctx, args.client);
  const amount = checkAmount(args.amount);
  const ym = args.month ? checkYm(args.month) : currentYm(ctx.today);
  const acc = await resolveAccount(ctx, args.account);
  let plans: any[] = [];
  try { plans = await ctx.api.get<any[]>('/finance/planned-payments', { projectId: client.id, ym }); } catch (e) { throw apiErr(e); }
  const expected = (plans || []).filter((p) => p.status === 'expected').sort((a, b) => (a.partNo || 1) - (b.partNo || 1));
  const plan = expected.find((p) => Number(p.amount) >= amount - 0.005) || null;
  return {
    client, amount, ym, acc, plan,
    preview: `💵 Оплата: ${client.name} — ${money(amount)} за ${ymRu(ym)}\n🏦 Счёт: ${acc.name}`
      + (plan ? `\n📌 Закрывает план${plan.partNo === 2 ? ' (2-я часть)' : ''} на ${money(plan.amount)}` : '\n📌 Без плана — проведу как оплату сразу'),
  };
}

export const clientPayment: ToolDef<PayArgs> = {
  name: 'client_payment',
  kind: 'write',
  description: '«Архидея оплатила 5000 за ноябрь на Алиф» — поступление оплаты клиента за проект (закрывает плановую оплату месяца).',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Клиент/проект в финансах, как назван.' },
      amount: { type: 'number', description: 'Сумма в сомони.' },
      month: { type: 'string', description: 'За какой месяц, ГГГГ-ММ. По умолчанию текущий.' },
      account: { type: 'string', description: 'На какой счёт пришли деньги.' },
    },
    required: ['client', 'amount', 'account'],
    additionalProperties: false,
  },
  available: finance,
  confirm: () => true,
  async preview(args, ctx) {
    return (await preparePayment(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await preparePayment(args, ctx);
    if (p.plan) {
      try { await ctx.api.post(`/finance/planned-payments/${p.plan.id}/receive`, { accountId: p.acc.id, amount: p.amount }); } catch (e) { throw apiErr(e); }
      return {
        summary: `💵 ${p.client.name}: оплата ${money(p.amount)} за ${ymRu(p.ym)} на ${p.acc.name}`,
        undo: [{ method: 'POST', path: `/finance/planned-payments/${p.plan.id}/unreceive` }],
      };
    }
    let res: any;
    try {
      res = await ctx.api.post('/finance/planned-payments/pay-now', { projectId: p.client.id, ym: p.ym, amount: p.amount, accountId: p.acc.id });
    } catch (e) { throw apiErr(e); }
    return {
      summary: `💵 ${p.client.name}: оплата ${money(p.amount)} за ${ymRu(p.ym)} на ${p.acc.name}`,
      undo: res?.id ? [{ method: 'DELETE', path: `/finance/planned-payments/${res.id}` }] : undefined,
    };
  },
};

export const FINANCE_TOOLS: ToolDef[] = [financeSummary, recordOperation, clientPayment];
