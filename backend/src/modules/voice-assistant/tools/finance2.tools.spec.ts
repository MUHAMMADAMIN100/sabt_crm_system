import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import {
  FINANCE2_TOOLS, cancelDebtPayment, cancelOperation, clientPlanUpdate, editOperation, markSubscriptionPaid,
  payDebt, paySubscription, setOtherPlan, transportCreate, transportPay,
} from './finance2.tools';
import { ToolContext } from './types';

type Handler = (body?: any, query?: any) => any;

function fakeApi(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; body?: any; query?: any }> = [];
  const hit = (method: string, path: string, body?: any, query?: any) => {
    calls.push({ method, path, body, query });
    const h = routes[`${method} ${path}`];
    if (!h) throw new ApiError(404, `нет маршрута ${method} ${path}`);
    return Promise.resolve().then(() => h(body, query));
  };
  return {
    calls,
    get: (p: string, q?: any) => hit('GET', p, undefined, q),
    post: (p: string, b?: any) => hit('POST', p, b),
    patch: (p: string, b?: any) => hit('PATCH', p, b),
    delete: (p: string, b?: any) => hit('DELETE', p, b),
    request: (m: string, p: string, b?: any) => hit(m, p, b),
  };
}

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  return {
    user: {
      id: 'u1', name: 'Тест', role: 'founder', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user,
    } as any,
    api,
    refs: new RefTable(),
    today: '2026-11-10',
    nowTime: '10:00',
    utterance: 'тест',
  };
}

const ACC = [
  { id: 'acc-alif', key: 'alif', name: 'Alif', archived: false },
  { id: 'acc-cash', key: 'cash', name: 'Cash', archived: false },
];
const CATS = [
  { id: 'cat-ads', key: null, name: 'Реклама', type: 'expense', archived: false },
  { id: 'cat-sub', key: 'subscription', name: 'Подписки', type: 'expense', archived: false },
];
const TX = {
  id: 'tx-1', date: '2026-11-05', type: 'expense', amount: 300, status: 'completed', comment: 'Таргет',
  categoryId: 'cat-ads', categoryName: 'Реклама', accountId: 'acc-alif', accountName: 'Alif',
};

function withTx(tx: any, extra: Record<string, Handler> = {}) {
  const api = fakeApi({
    'GET /finance/transactions': () => ({ items: [tx], total: 1 }),
    'GET /finance/accounts': () => ACC,
    'GET /finance/categories': () => CATS,
    ...extra,
  });
  const ctx = ctxWith(api);
  const ref = ctx.refs.add('X', tx.id, `${tx.date}|300 сом. Реклама`);
  return { api, ctx, ref };
}

describe('права', () => {
  it('финансовые инструменты скрыты от не-основателя, транспорт — по ролям', () => {
    const smm: any = { role: 'smm_specialist', secondaryRole: null, extraPermissions: [], deniedPermissions: [] };
    const visible = FINANCE2_TOOLS.filter((t) => t.available?.(smm)).map((t) => t.name).sort();
    expect(visible).toEqual(['transport_cancel', 'transport_create', 'transport_list']);
    const founder: any = { role: 'founder', secondaryRole: null, extraPermissions: [], deniedPermissions: [] };
    expect(transportCreate.available?.(founder)).toBe(false);
    expect(transportPay.available?.(founder)).toBe(true);
    const director: any = { role: 'smm_director', secondaryRole: null, extraPermissions: [], deniedPermissions: [] };
    expect(FINANCE2_TOOLS.filter((t) => t.available?.(director))).toHaveLength(0);
  });

  it('имена уникальны', () => {
    const names = FINANCE2_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('edit_operation', () => {
  it('шлёт только изменённое и запоминает прежнее для отмены', async () => {
    const { api, ctx, ref } = withTx(TX, { 'PATCH /finance/transactions/tx-1': () => ({}) });
    const out = await editOperation.run({ operation: ref, amount: 350, comment: 'Таргет ноябрь' }, ctx);
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ amount: 350, comment: 'Таргет ноябрь' });
    expect(out.undo).toEqual([{ method: 'PATCH', path: '/finance/transactions/tx-1', body: { amount: 300, comment: 'Таргет' } }]);
    expect(await editOperation.preview!({ operation: ref, amount: 350 }, ctx)).toMatch(/^✏️ ИЗМЕНИТЬ ОПЕРАЦИЮ/);
  });

  it('отказывает, если менять нечего, и для зарплатных и импортных', async () => {
    const same = withTx(TX);
    await expect(editOperation.preview!({ operation: same.ref, amount: 300 }, same.ctx)).rejects.toThrow(/Нечего менять/);
    const salary = withTx({ ...TX, employeeId: 'e1' });
    await expect(editOperation.preview!({ operation: salary.ref, amount: 1 }, salary.ctx)).rejects.toThrow(/зарплатная/);
    const imported = withTx({ ...TX, imported: true });
    await expect(editOperation.preview!({ operation: imported.ref, amount: 1 }, imported.ctx)).rejects.toThrow(/импорта Notion/);
  });

  it('не знает метку, которую не показывали', async () => {
    const { ctx } = withTx(TX);
    await expect(editOperation.preview!({ operation: 'X77', amount: 1 }, ctx)).rejects.toThrow(/finance_journal/);
  });
});

describe('cancel_operation', () => {
  it('мягко отменяет через DELETE, без undo', async () => {
    const { api, ctx, ref } = withTx(TX, { 'DELETE /finance/transactions/tx-1': () => ({ ok: true }) });
    expect(await cancelOperation.preview!({ operation: ref }, ctx)).toMatch(/^🗑 ОТМЕНИТЬ ОПЕРАЦИЮ/);
    const out = await cancelOperation.run({ operation: ref }, ctx);
    expect(out.undo).toBeUndefined();
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('не трогает отменённые, импортные и платежи по долгу', async () => {
    for (const [tx, re] of [
      [{ ...TX, status: 'cancelled' }, /уже отменена/],
      [{ ...TX, source: 'notion' }, /импорта Notion/],
      [{ ...TX, debtId: 'd1' }, /cancel_debt_payment/],
    ] as Array<[any, RegExp]>) {
      const { ctx, ref } = withTx(tx);
      await expect(cancelOperation.preview!({ operation: ref }, ctx)).rejects.toThrow(re);
    }
  });
});

const DEBT_ROW = {
  id: 'debt-1', name: 'Долг Мухаммаду', counterparty: null, remaining: 1000, closed: false,
  payments: [{ txId: 'pay-1', date: '2026-11-01', amount: 200, account: 'Alif' }],
};

describe('долги', () => {
  const routes = () => ({
    'GET /finance/expense/detail/debts': () => ({ rows: [DEBT_ROW] }),
    'GET /finance/accounts': () => ACC,
  });

  it('pay_debt: ограничивает остатком и даёт отмену платежа', async () => {
    const api = fakeApi({ ...routes(), 'POST /finance/debts/debt-1/pay': () => ({ ok: true, txId: 'new-tx' }) });
    const ctx = ctxWith(api);
    await expect(payDebt.preview!({ debt: 'Мухаммаду', amount: 5000, account: 'алиф' }, ctx)).rejects.toThrow(/больше/);
    await expect(payDebt.preview!({ debt: 'Мухаммаду', amount: 10, account: 'алиф', date: '2026-12-01' }, ctx)).rejects.toThrow(/Будущий/);
    const out = await payDebt.run({ debt: 'Мухаммаду', amount: 400, account: 'алиф' }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ amount: 400, accountId: 'acc-alif', date: '2026-11-10' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/finance/debts/debt-1/payments/new-tx' }]);
  });

  it('cancel_debt_payment: только платёж этого долга', async () => {
    const api = fakeApi({ ...routes(), 'DELETE /finance/debts/debt-1/payments/pay-1': () => ({ ok: true }) });
    const ctx = ctxWith(api);
    const ok = ctx.refs.add('X', 'pay-1', 'x');
    const foreign = ctx.refs.add('X', 'other', 'x');
    await expect(cancelDebtPayment.preview!({ debt: 'Мухаммаду', payment: foreign }, ctx)).rejects.toThrow(/Не нашёл такой платёж/);
    await cancelDebtPayment.run({ debt: 'Мухаммаду', payment: ok }, ctx);
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});

describe('подписки', () => {
  const sub = (extra: any = {}) => ({ id: 's1', name: 'Claude', kind: 'subscription', amount: 2000, paidMonth: 0, paidMark: null, active: true, ...extra });

  it('pay_subscription: расход со статьёй подписок и отмена удалением операции', async () => {
    const api = fakeApi({
      'GET /finance/expense/detail/subscriptions': () => ({ rows: [sub()] }),
      'GET /finance/accounts': () => ACC,
      'GET /finance/categories': () => CATS,
      'POST /finance/operations': () => ({ id: 'op-9' }),
    });
    const ctx = ctxWith(api);
    const out = await paySubscription.run({ subscription: 'Claude', account: 'алиф' }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      type: 'expense', amount: 2000, accountId: 'acc-alif', categoryId: 'cat-sub', subscriptionId: 's1', date: '2026-11-10',
    });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/finance/transactions/op-9' }]);
  });

  it('pay_subscription: оплаченную не проводит повторно, больше остатка нельзя', async () => {
    const paid = fakeApi({ 'GET /finance/expense/detail/subscriptions': () => ({ rows: [sub({ paidMonth: 2000 })] }), 'GET /finance/accounts': () => ACC });
    await expect(paySubscription.preview!({ subscription: 'Claude', account: 'алиф' }, ctxWith(paid))).rejects.toThrow(/уже оплачена/);
    const part = fakeApi({ 'GET /finance/expense/detail/subscriptions': () => ({ rows: [sub({ paidMonth: 1500 })] }), 'GET /finance/accounts': () => ACC });
    await expect(paySubscription.preview!({ subscription: 'Claude', account: 'алиф', amount: 900 }, ctxWith(part))).rejects.toThrow(/осталось 500/);
  });

  it('mark_subscription_paid: без движения денег, undo снимает отметку', async () => {
    const api = fakeApi({
      'GET /finance/expense/detail/subscriptions': () => ({ rows: [sub()] }),
      'POST /finance/subscriptions/s1/mark-paid': () => ({}),
    });
    const ctx = ctxWith(api);
    const out = await markSubscriptionPaid.run({ subscription: 'Claude' }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ ym: '2026-11', date: '2026-11-10' });
    expect(out.undo).toEqual([{ method: 'POST', path: '/finance/subscriptions/s1/unmark-paid', body: { ym: '2026-11' } }]);
  });
});

describe('set_other_plan', () => {
  const plan = { avg: 2000, months: [{ ym: '2026-11', amount: null, estimate: 2000 }, { ym: '2026-12', amount: 3000, estimate: 3000 }] };

  it('ставит цифру и возвращает прежнюю при отмене (в т.ч. «среднее» = null)', async () => {
    const api = fakeApi({ 'GET /finance/expense/other-plan': () => plan, 'POST /finance/expense/other-plan': () => ({}) });
    const ctx = ctxWith(api);
    const out = await setOtherPlan.run({ month: '2026-11', amount: 4000 }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ ym: '2026-11', amount: 4000 });
    expect(out.undo?.[0].body).toEqual({ ym: '2026-11', amount: null });
    const back = await setOtherPlan.run({ month: '2026-12', reset_to_average: true }, ctx);
    expect(back.undo?.[0].body).toEqual({ ym: '2026-12', amount: 3000 });
  });

  it('отказывает за прошлое и без суммы', async () => {
    const ctx = ctxWith(fakeApi({ 'GET /finance/expense/other-plan': () => plan }));
    await expect(setOtherPlan.preview!({ month: '2026-09', amount: 1 }, ctx)).rejects.toThrow(/текущий/);
    await expect(setOtherPlan.preview!({ month: '2026-11' }, ctx)).rejects.toThrow(/Какую сумму/);
  });
});

describe('client_plan_update', () => {
  it('меняет срок и сумму ожидаемого плана, undo возвращает прежние', async () => {
    const api = fakeApi({
      'GET /finance/planned-payments': () => [{ id: 'pp1', ym: '2026-12', partNo: 1, amount: 2500, status: 'expected', dueDate: '2026-12-10' }],
      'PATCH /finance/planned-payments/pp1': () => ({}),
    });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('X', 'pp1', 'plan|proj-1|2026-12|Асан · декабрь 2026');
    const out = await clientPlanUpdate.run({ plan: ref, due_date: '2026-12-20', amount: 3000 }, ctx);
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ amount: 3000, dueDate: '2026-12-20' });
    expect(out.undo?.[0].body).toEqual({ amount: 2500, dueDate: '2026-12-10' });
  });

  it('полученный план не правит', async () => {
    const api = fakeApi({ 'GET /finance/planned-payments': () => [{ id: 'pp1', ym: '2026-12', partNo: 1, amount: 2500, status: 'received' }] });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('X', 'pp1', 'plan|proj-1|2026-12|Асан · декабрь 2026');
    await expect(clientPlanUpdate.preview!({ plan: ref, amount: 1 }, ctx)).rejects.toThrow(/Полученную/);
  });
});

describe('transport_create', () => {
  const projects = [
    { id: 'p1', name: 'Архидея', mine: true },
    { id: 'p2', name: 'Дубль', mine: true },
    { id: 'p3', name: 'Дубль', mine: false },
  ];
  const smm = { role: 'smm_specialist' };

  it('создаёт заявку и даёт отзыв как undo', async () => {
    const api = fakeApi({ 'GET /transport-requests/projects': () => projects, 'POST /transport-requests': () => ({ id: 'tr-1' }) });
    const ctx = ctxWith(api, smm);
    const out = await transportCreate.run({ project: 'Архидея', amount: 30, note: 'такси' }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ projectId: 'p1', amount: 30, date: '2026-11-10', note: 'такси' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/transport-requests/tr-1' }]);
  });

  it('проверяет сумму, дату и неоднозначный проект', async () => {
    const ctx = ctxWith(fakeApi({ 'GET /transport-requests/projects': () => projects }), smm);
    await expect(transportCreate.preview!({ project: 'Архидея', amount: 6000 }, ctx)).rejects.toThrow(/до 5000/);
    await expect(transportCreate.preview!({ project: 'Архидея', amount: 10, date: '2026-11-11' }, ctx)).rejects.toThrow(/будущем/);
    await expect(transportCreate.preview!({ project: 'Архидея', amount: 10, date: '2026-08-01' }, ctx)).rejects.toThrow(/60 дней/);
    await expect(transportCreate.preview!({ project: 'Неизвестный', amount: 10 }, ctx)).rejects.toThrow(/Не нашёл проект/);
    await expect(transportCreate.preview!({ project: 'Дубль', amount: 10 }, ctx)).resolves.toMatch(/ЗАЯВКА НА ТРАНСПОРТ/);
  });
});

describe('transport_pay', () => {
  it('платит только ждущую заявку с выбранного счёта', async () => {
    const api = fakeApi({
      'GET /transport-requests': () => ({ pending: [{ id: 'tr-1', employeeName: 'Рахимов', projectName: 'Архидея', amount: 30, date: '2026-11-09' }] }),
      'GET /finance/accounts': () => ACC,
      'POST /transport-requests/tr-1/pay': () => ({}),
    });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('R', 'tr-1', 'x');
    expect(await transportPay.preview!({ request: ref, account: 'алиф' }, ctx)).toMatch(/^🚗 ОПЛАТИТЬ ТРАНСПОРТ 30 сом\./);
    const out = await transportPay.run({ request: ref, account: 'алиф' }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ accountId: 'acc-alif' });
    expect(out.summary).toMatch(/Рахимов/);
    const other = ctx.refs.add('R', 'tr-2', 'x');
    await expect(transportPay.preview!({ request: other, account: 'алиф' }, ctx)).rejects.toThrow(/не найдена/);
  });
});
