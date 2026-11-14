import { describe, expect, it } from 'vitest';
import { buildLateOther, buildMonthItems, type PlanSources } from './planItems';

// Сегодня — 14 ноября 2026, календарь — ноябрь.
const TODAY = '2026-11-14';
const base = (over: Partial<PlanSources> = {}): PlanSources => ({
  calYm: '2026-11', today: TODAY,
  planned: [], projects: [], debts: [], subscriptions: [], salary: null, txItems: [], installments: [],
  ...over,
});
const smm = (over: any = {}) => ({
  id: 'p-smm', name: 'Chrono', direction: 'smm', tariff: 5000, contractDate: '2026-06-05',
  status: 'active', archived: false, retentionMonths: null, ...over,
});
const dev = (over: any = {}) => ({
  id: 'p-dev', name: 'Сайт', direction: 'development', tariff: 30000, contractDate: '2026-10-01',
  status: 'active', archived: false, ...over,
});
const byId = (items: any[], id: string) => items.find((x) => x.id === id);
const ids = (items: any[]) => items.map((x) => x.id).sort();
const total = (items: any[], type: string) => items.filter((x) => x.type === type).reduce((s, x) => s + Number(x.amount), 0);

describe('Планирование: плановые оплаты', () => {
  it('ожидаемая оплата — в срок, полученная — в день прихода денег, без повтора операции', () => {
    const items = buildMonthItems(base({
      projects: [dev()],
      planned: [
        { id: 'a', projectId: 'p-dev', ym: '2026-11', dueDate: '2026-11-20', status: 'expected', amount: 10000 },
        { id: 'b', projectId: 'p-dev', ym: '2026-11', dueDate: '2026-11-03', status: 'received', amount: 5000, receivedTxId: 't1' },
      ],
      txItems: [{ id: 't1', type: 'income', projectId: 'p-dev', date: '2026-11-07', amount: 5000, status: 'completed' }],
    }));
    expect(byId(items, 'pp-a')).toMatchObject({ date: '2026-11-20', done: false, type: 'income' });
    expect(byId(items, 'pp-b')).toMatchObject({ date: '2026-11-07', done: true });
    expect(byId(items, 'tx-t1')).toBeUndefined();
  });

  it('оплата за декабрь, пришедшая в ноябре, считается один раз — в ноябре', () => {
    const plan = { id: 'dec', projectId: 'p-dev', ym: '2026-12', dueDate: '2026-12-10', status: 'received', amount: 7000, receivedTxId: 't-early' };
    const tx = { id: 't-early', type: 'income', projectId: 'p-dev', date: '2026-11-28', amount: 7000, status: 'completed' };
    const nov = buildMonthItems(base({ projects: [dev()], planned: [plan], txItems: [tx] }));
    const dec = buildMonthItems(base({ calYm: '2026-12', projects: [dev()], planned: [plan], txItems: [] }));
    expect(byId(nov, 'tx-t-early')).toMatchObject({ amount: 7000, done: false });
    expect(total(nov, 'income')).toBe(7000);
    expect(byId(dec, 'pp-dec')).toBeUndefined();
    expect(total(dec, 'income')).toBe(0);
  });

  it('оплата за октябрь, пришедшая в ноябре, не задваивает октябрь', () => {
    const plan = { id: 'oct', projectId: 'p-dev', ym: '2026-10', status: 'received', amount: 3000, receivedTxId: 't-late' };
    const tx = { id: 't-late', type: 'income', projectId: 'p-dev', date: '2026-11-03', amount: 3000, status: 'completed' };
    const oct = buildMonthItems(base({ calYm: '2026-10', projects: [dev()], planned: [plan], txItems: [] }));
    const nov = buildMonthItems(base({ projects: [dev()], planned: [plan], txItems: [tx] }));
    expect(oct).toHaveLength(0);
    expect(byId(nov, 'tx-t-late')).toMatchObject({ done: true, amount: 3000 });
  });

  it('полученное без операции («вне счёта») остаётся в своём месяце', () => {
    const items = buildMonthItems(base({
      projects: [dev()],
      planned: [{ id: 'off', projectId: 'p-dev', ym: '2026-11', status: 'received', amount: 2000, receivedTxId: null }],
    }));
    expect(byId(items, 'pp-off')).toMatchObject({ date: '2026-11-01', done: true });
  });

  it('у проекта на паузе ожидаемое скрыто, полученное остаётся; без срока — день договора', () => {
    const items = buildMonthItems(base({
      projects: [dev({ status: 'paused', contractDate: '2026-10-31' })],
      planned: [
        { id: 'e', projectId: 'p-dev', ym: '2026-11', status: 'expected', amount: 1000 },
        { id: 'r', projectId: 'p-dev', ym: '2026-11', status: 'received', amount: 1000, receivedTxId: null },
      ],
    }));
    expect(byId(items, 'pp-e')).toBeUndefined();
    // 31-е в ноябре — последний день месяца.
    expect(byId(items, 'pp-r')).toMatchObject({ date: '2026-11-30' });
  });

  it('транш долга — на день из настройки (по умолчанию 10-е), банк — «Рассрочка»', () => {
    const items = buildMonthItems(base({
      debts: [
        { id: 'd1', name: 'Мухаммад', kind: 'person', remaining: 5000 },
        { id: 'b1', name: 'Алиф кредит', kind: 'bank', dueDay: 25, counterparty: 'Алиф', remaining: 9000, monthlyPayment: 1500 },
      ],
      planned: [
        { id: 't', debtId: 'd1', ym: '2026-11', status: 'expected', amount: 1000 },
        { id: 'bk', debtId: 'b1', ym: '2026-11', status: 'expected', amount: 1500 },
      ],
    }));
    expect(byId(items, 'pp-t')).toMatchObject({ date: '2026-11-10', type: 'expense', comment: 'Мухаммад · транш' });
    expect(byId(items, 'pp-bk')).toMatchObject({ date: '2026-11-25', comment: 'Алиф кредит' });
  });

  it('долг «вернуть до»: в день срока — остаток вне траншей', () => {
    const items = buildMonthItems(base({
      debts: [{ id: 'd1', name: 'Мухаммад', kind: 'person', remaining: 5000, dueDate: '2026-11-30' }],
      planned: [{ id: 't', debtId: 'd1', ym: '2026-12', status: 'expected', amount: 2000 }],
    }));
    expect(byId(items, 'due-d1')).toMatchObject({ date: '2026-11-30', amount: 3000 });
  });
});

describe('Планирование: аренда и подписки', () => {
  const rent = { id: 's1', name: 'Аренда офиса', kind: 'rent', amount: 6000, active: true, dueDay: 5 };

  it('не оплачена — на день оплаты, оплачена отметкой — на дату отметки', () => {
    expect(byId(buildMonthItems(base({ subscriptions: [rent] })), 'sub-s1'))
      .toMatchObject({ date: '2026-11-05', amount: 6000, done: false });
    const marked = { ...rent, paidMarks: [{ ym: '2026-11', date: '2026-11-04' }] };
    expect(byId(buildMonthItems(base({ subscriptions: [marked] })), 'sub-s1'))
      .toMatchObject({ date: '2026-11-04', done: true });
  });

  it('оплачена операциями полностью — на день оплаты, сделано', () => {
    const items = buildMonthItems(base({
      subscriptions: [rent],
      txItems: [{ id: 'x', type: 'expense', subscriptionId: 's1', date: '2026-11-06', amount: 6000, status: 'completed' }],
    }));
    expect(byId(items, 'sub-s1')).toMatchObject({ date: '2026-11-06', amount: 6000, done: true });
    expect(byId(items, 'tx-x')).toBeUndefined();
  });

  it('оплачена частично — оплаченное «ушло», в срок — только остаток', () => {
    const items = buildMonthItems(base({
      subscriptions: [rent],
      txItems: [
        { id: 'x', type: 'expense', subscriptionId: 's1', date: '2026-11-03', amount: 2000, status: 'completed' },
        { id: 'y', type: 'expense', subscriptionId: 's1', date: '2026-11-04', amount: 500, status: 'cancelled' },
      ],
    }));
    expect(byId(items, 'subpaid-s1')).toMatchObject({ date: '2026-11-03', amount: 2000, done: true });
    expect(byId(items, 'sub-s1')).toMatchObject({ date: '2026-11-05', amount: 4000, done: false });
    expect(total(items, 'expense')).toBe(6000);
  });

  it('до начала и после окончания не показывается; без дня — день начала', () => {
    const sub = { id: 's2', name: 'Сервер', kind: 'subscription', amount: 300, active: true, dueDate: '2026-11-17', endDate: '2027-01-31' };
    expect(buildMonthItems(base({ calYm: '2026-10', subscriptions: [sub] }))).toHaveLength(0);
    expect(byId(buildMonthItems(base({ subscriptions: [sub] })), 'sub-s2')).toMatchObject({ date: '2026-11-17' });
    expect(buildMonthItems(base({ calYm: '2027-02', subscriptions: [sub] }))).toHaveLength(0);
    expect(buildMonthItems(base({ subscriptions: [{ ...sub, active: false }] }))).toHaveLength(0);
  });
});

describe('Планирование: зарплата', () => {
  const salary = { cards: { toPay: 12000, fund: 30000, paid: 18000 }, rows: [{}, {}, {}] };

  it('выплаты — на свои дни одной строкой, остаток за прошлый месяц — сегодня, если 10-е прошло', () => {
    const items = buildMonthItems(base({
      salary,
      txItems: [
        { id: 'a', type: 'expense', employeeId: 'e1', employeeName: 'Бехруз', date: '2026-11-10', amount: 8000, status: 'completed' },
        { id: 'b', type: 'expense', employeeId: 'e2', employeeName: 'Фарзона', date: '2026-11-10', amount: 10000, status: 'completed' },
        { id: 'c', type: 'expense', employeeId: 'e3', date: '2026-11-11', amount: 999, status: 'cancelled' },
      ],
    }));
    expect(byId(items, 'salpaid-2026-11-10')).toMatchObject({ amount: 18000, done: true, salaryYm: '2026-10' });
    expect(byId(items, 'salpaid-2026-11-11')).toBeUndefined();
    expect(byId(items, 'salary-2026-11')).toMatchObject({ date: TODAY, amount: 12000, done: false });
  });

  it('в будущем месяце остаток — на 10-е; выплаченный месяц без остатка', () => {
    expect(byId(buildMonthItems(base({ calYm: '2026-12', salary })), 'salary-2026-12')).toMatchObject({ date: '2026-12-10' });
    expect(buildMonthItems(base({ salary: { cards: { toPay: 0 } } }))).toHaveLength(0);
  });
});

describe('Планирование: прочие операции', () => {
  it('разовые — прошедшие сделаны, будущие ждём; отменённые и привязанные не показываются', () => {
    const items = buildMonthItems(base({
      projects: [dev({ status: 'paused' })],
      txItems: [
        { id: 'p', type: 'expense', date: '2026-11-02', amount: 900, status: 'completed', comment: 'Реклама' },
        { id: 'f', type: 'expense', date: '2026-11-25', amount: 1200, status: 'completed', comment: 'Налоги' },
        { id: 'c', type: 'expense', date: '2026-11-03', amount: 500, status: 'cancelled' },
        { id: 'tr', type: 'transfer', date: '2026-11-03', amount: 500, status: 'completed' },
        { id: 'pi', type: 'income', projectId: 'p-dev', date: '2026-11-20', amount: 4000, status: 'completed' },
        { id: 'pp', type: 'income', projectId: 'p-dev', date: '2026-11-02', amount: 4000, status: 'completed' },
      ],
    }));
    expect(ids(items)).toEqual(['tx-f', 'tx-p', 'tx-pp']);
    expect(byId(items, 'tx-p').done).toBe(true);
    expect(byId(items, 'tx-f').done).toBe(false);
  });

  it('несколько мелких расходов за день — одной строкой «Прочее»', () => {
    const items = buildMonthItems(base({
      txItems: [
        { id: 'a', type: 'expense', date: '2026-11-02', amount: 20, status: 'completed', comment: 'Такси' },
        { id: 'b', type: 'expense', date: '2026-11-02', amount: 150, status: 'completed', comment: 'Вода' },
        { id: 'c', type: 'expense', date: '2026-11-02', amount: 900, status: 'completed', comment: 'Реклама' },
      ],
    }));
    expect(ids(items)).toEqual(['misc-2026-11-02', 'tx-c']);
    expect(byId(items, 'misc-2026-11-02')).toMatchObject({ amount: 170, done: true });
  });
});

describe('Планирование: прогноз SMM и обслуживания', () => {
  it('без плана и оплаты — тариф на день договора; оплата или план месяц закрывают', () => {
    const only = buildMonthItems(base({ projects: [smm()] }));
    expect(byId(only, 'fc-p-smm-2026-11')).toMatchObject({ date: '2026-11-05', amount: 5000, done: false, direction: 'smm' });

    const paid = buildMonthItems(base({
      projects: [smm()],
      txItems: [{ id: 'x', type: 'income', projectId: 'p-smm', date: '2026-11-06', amount: 5000, status: 'completed' }],
    }));
    expect(byId(paid, 'fc-p-smm-2026-11')).toBeUndefined();

    const planned = buildMonthItems(base({
      projects: [smm()],
      planned: [{ id: 'pl', projectId: 'p-smm', ym: '2026-11', dueDate: '2026-11-08', status: 'expected', amount: 2500 }],
    }));
    expect(byId(planned, 'fc-p-smm-2026-11')).toBeUndefined();
    expect(byId(planned, 'pp-pl')).toBeTruthy();
  });

  it('удалённая (отменённая) оплата месяц не закрывает', () => {
    const items = buildMonthItems(base({
      projects: [smm()],
      txItems: [{ id: 'x', type: 'income', projectId: 'p-smm', date: '2026-11-06', amount: 5000, status: 'cancelled' }],
    }));
    expect(byId(items, 'fc-p-smm-2026-11')).toMatchObject({ amount: 5000 });
  });

  it('не прогнозирует прошлые месяцы, до начала договора, за сроком удержания и на паузе', () => {
    expect(buildMonthItems(base({ calYm: '2026-10', projects: [smm()] }))).toHaveLength(0);
    expect(buildMonthItems(base({ projects: [smm({ contractDate: '2026-12-01' })] }))).toHaveLength(0);
    expect(buildMonthItems(base({ calYm: '2027-02', projects: [smm({ retentionMonths: 2 })] }))).toHaveLength(0);
    expect(buildMonthItems(base({ calYm: '2027-01', projects: [smm({ retentionMonths: 2 })] }))).toHaveLength(1);
    expect(buildMonthItems(base({ projects: [smm({ status: 'paused' })] }))).toHaveLength(0);
    expect(buildMonthItems(base({ projects: [dev()] }))).toHaveLength(0);
  });
});

describe('Планирование: рассрочки сотрудников', () => {
  it('«платит отдельно» — ожидаемый приход (просроченный — сегодня), «из зарплаты» — пометка', () => {
    const items = buildMonthItems(base({
      installments: [
        { key: 'i1:2026-11', installmentId: 'i1', ym: '2026-11', date: '2026-11-03', amount: 1000, outstanding: 600, status: 'overdue', method: 'separate', employeeName: 'Бехруз', name: 'Телефон', remaining: 3000 },
        { key: 'i2:2026-11', installmentId: 'i2', ym: '2026-11', date: '2026-11-10', amount: 500, outstanding: 500, status: 'planned', method: 'salary', employeeName: 'Фарзона', name: 'Ноутбук', remaining: 2000 },
      ],
    }));
    expect(byId(items, 'inst-i1:2026-11')).toMatchObject({ date: TODAY, amount: 600, type: 'income', done: false });
    expect(byId(items, 'inst-i2:2026-11')).toMatchObject({ type: 'note', amount: 500 });
    expect(total(items, 'income')).toBe(600);
  });
});

describe('Планирование: «Просрочено» других месяцев', () => {
  it('не полученные оплаты и не отданные транши прошлых месяцев', () => {
    const late = buildLateOther({
      calYm: '2026-11', today: TODAY,
      projects: [dev()], debts: [{ id: 'd1', name: 'Мухаммад', kind: 'person' }],
      planned: [
        { id: 'a', projectId: 'p-dev', ym: '2026-10', dueDate: '2026-10-15', status: 'expected', amount: 3000 },
        { id: 'b', debtId: 'd1', ym: '2026-10', status: 'expected', amount: 1000 },
        { id: 'c', projectId: 'p-dev', ym: '2026-10', status: 'received', amount: 3000 },
        { id: 'n', projectId: 'p-dev', ym: '2026-11', dueDate: '2026-11-02', status: 'expected', amount: 3000 },
        { id: 'f', projectId: 'p-dev', ym: '2026-12', dueDate: '2026-12-02', status: 'expected', amount: 3000 },
      ],
      smmRows: [],
    });
    expect(ids(late)).toEqual(['pp-a', 'pp-b']);
    expect(late.find((x) => x.id === 'pp-b')).toMatchObject({ date: '2026-10-10', type: 'expense' });
  });

  it('долг «вернуть до» с прошедшим сроком прошлого месяца — в «Просрочено», остаток вне траншей', () => {
    const late = buildLateOther({
      calYm: '2026-11', today: TODAY, projects: [], smmRows: [],
      debts: [
        { id: 'd1', name: 'Мухаммад', kind: 'person', remaining: 5000, dueDate: '2026-10-31' },
        { id: 'd2', name: 'Закрыт', kind: 'person', remaining: 0, dueDate: '2026-10-31' },
        { id: 'd3', name: 'Ещё не срок', kind: 'person', remaining: 900, dueDate: '2026-12-20' },
        { id: 'b1', name: 'Банк', kind: 'bank', remaining: 9000, dueDate: '2026-10-01' },
      ],
      planned: [{ id: 't', debtId: 'd1', ym: '2026-12', dueDate: '2026-12-05', status: 'expected', amount: 2000 }],
    });
    expect(ids(late)).toEqual(['due-d1']);
    expect(late[0]).toMatchObject({ date: '2026-10-31', amount: 3000, type: 'expense' });
  });

  it('SMM: просрочка по дню договора — да, по сохранённому плану — не второй раз', () => {
    const late = buildLateOther({
      calYm: '2026-11', today: TODAY,
      projects: [smm()], debts: [],
      planned: [{ id: 'oct', projectId: 'p-smm', ym: '2026-10', dueDate: '2026-10-05', status: 'expected', amount: 5000 }],
      smmRows: [
        { project: { id: 'p-smm', name: 'Chrono' }, due: { date: '2026-10-05', state: 'late', planned: true }, overdue: 5000 },
        { project: { id: 'p-kb', name: 'Комерцбанк' }, due: { date: '2026-10-20', state: 'late', planned: false }, overdue: 8000 },
        { project: { id: 'p-x', name: 'В этом месяце' }, due: { date: '2026-11-02', state: 'late', planned: false }, overdue: 4000 },
      ],
    });
    expect(ids(late)).toEqual(['pp-oct', 'smmdue-p-kb-2026-10-20']);
    expect(late.reduce((s, x) => s + x.amount, 0)).toBe(13000);
  });
});
