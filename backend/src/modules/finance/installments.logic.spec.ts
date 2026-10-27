import {
  capParts, deductionOf, deductionParts, dueDateOf, manualPaid, plannedFor, schedule, summarize, walk, InstallmentLike,
} from './installments.logic';

const phone = (over: Partial<InstallmentLike> = {}): InstallmentLike => ({
  id: 'i1', name: 'iPhone 15', totalAmount: 9600, monthlyAmount: 800, startYm: '2026-10',
  paidBefore: 0, overrides: null, payments: null, ...over,
});
const separate = (over: Partial<InstallmentLike> = {}) => phone({ method: 'separate', dueDay: 5, startYm: '2026-11', ...over });
const TODAY = '2026-10-27';

describe('installments: план месяца', () => {
  it('до первого месяца не удерживаем', () => {
    expect(plannedFor(phone(), '2026-09')).toBe(0);
    expect(plannedFor(phone(), '2026-10')).toBe(800);
  });

  it('своя сумма месяца и пропуск', () => {
    const i = phone({ overrides: { '2026-11': 1600, '2026-12': 0 } });
    expect(plannedFor(i, '2026-11')).toBe(1600);
    expect(plannedFor(i, '2026-12')).toBe(0);
  });
});

describe('installments: даты платежей', () => {
  it('из зарплаты — 10-е следующего месяца', () => {
    expect(dueDateOf(phone(), '2026-10')).toBe('2026-11-10');
    expect(dueDateOf(phone(), '2026-12')).toBe('2027-01-10');
  });

  it('отдельно — своё число, в коротком месяце последний день', () => {
    expect(dueDateOf(separate(), '2026-11')).toBe('2026-11-05');
    expect(dueDateOf(separate({ dueDay: 31 }), '2027-02')).toBe('2027-02-28');
  });

  it('перенесённая дата важнее числа', () => {
    expect(dueDateOf(separate({ dueDates: { '2026-11': '2026-11-20' } }), '2026-11')).toBe('2026-11-20');
  });
});

describe('installments: удержание месяца', () => {
  it('последний платёж урезается до остатка', () => {
    const i = phone({ totalAmount: 2000 });
    expect(deductionOf(i, null, '2026-10')).toBe(800);
    expect(deductionOf(i, null, '2026-11')).toBe(800);
    expect(deductionOf(i, null, '2026-12')).toBe(400);
    expect(deductionOf(i, null, '2027-01')).toBe(0);
  });

  it('выплаченный месяц берёт сумму из снимка, а не из нового плана', () => {
    const snaps = { '2026-10': { installments: { i1: 500 } } };
    const i = phone({ monthlyAmount: 1000 });
    expect(deductionOf(i, snaps, '2026-10')).toBe(500);
    expect(deductionOf(i, snaps, '2026-11')).toBe(1000);
  });

  it('платёж вручную уменьшает остаток и закрывает рассрочку раньше', () => {
    const i = phone({ totalAmount: 2000, payments: [{ id: 'p', date: '2026-10-20', amount: 1500 }] });
    expect(manualPaid(i)).toBe(1500);
    expect(deductionOf(i, null, '2026-10')).toBe(500);
    expect(deductionOf(i, null, '2026-11')).toBe(0);
  });

  it('месяц без работы в ведомости не удерживается и сдвигает срок', () => {
    const worked = (ym: string) => ym !== '2026-11';
    const i = phone({ totalAmount: 1600 });
    expect(deductionOf(i, null, '2026-11', worked)).toBe(0);
    expect(deductionOf(i, null, '2026-12', worked)).toBe(800);
  });

  it('«платит отдельно» из зарплаты не удерживается', () => {
    expect(deductionOf(separate({ startYm: '2026-10' }), null, '2026-10')).toBe(0);
  });

  it('удержание не больше, чем причитается за месяц', () => {
    const parts = [{ id: 'a', name: 'A', amount: 800 }, { id: 'b', name: 'B', amount: 600 }];
    expect(capParts(parts, 1000)).toEqual([{ id: 'a', name: 'A', amount: 800 }, { id: 'b', name: 'B', amount: 200 }]);
    expect(capParts(parts, 0)).toEqual([]);
  });

  it('части по нескольким рассрочкам', () => {
    const a = phone();
    const b = phone({ id: 'i2', name: 'Стиральная машина', totalAmount: 3600, monthlyAmount: 600 });
    expect(deductionParts([a, b, separate({ id: 'i3' })], null, '2026-10')).toEqual([
      { id: 'i1', name: 'iPhone 15', amount: 800 },
      { id: 'i2', name: 'Стиральная машина', amount: 600 },
    ]);
  });
});

describe('installments: график «отдельно»', () => {
  it('платежи покрывают месяцы по порядку, недостача — просрочка', () => {
    const i = separate({ startYm: '2026-09', totalAmount: 2400, monthlyAmount: 600, payments: [{ id: 'p', date: '2026-09-05', amount: 900 }] });
    const plan = schedule(i, null, TODAY);
    expect(plan.map(e => [e.date, e.status, e.outstanding])).toEqual([
      ['2026-09-05', 'done', 0],
      ['2026-10-05', 'overdue', 300],
      ['2026-11-05', 'planned', 600],
      ['2026-12-05', 'planned', 600],
    ]);
  });

  it('итог: просрочка, ближайший и последний платёж', () => {
    const i = separate({ startYm: '2026-10', totalAmount: 1800, monthlyAmount: 600 });
    const s = summarize(i, null, undefined, TODAY);
    expect(s.overdue).toEqual({ amount: 600, count: 1, since: '2026-10-05', ym: '2026-10' });
    expect(s.next).toEqual({ ym: '2026-11', date: '2026-11-05', amount: 600 });
    expect(s.endDate).toBe('2026-12-05');
    expect(s.paymentsLeft).toBe(3);
  });

  it('пропуск сдвигает срок на месяц', () => {
    const s = summarize(separate({ totalAmount: 1200, monthlyAmount: 600, overrides: { '2026-12': 0 } }), null, undefined, TODAY);
    expect(s.endDate).toBe('2027-01-05');
  });
});

describe('installments: итог «из зарплаты»', () => {
  it('считает возвращённое, остаток и последний платёж', () => {
    const snaps = { '2026-10': { installments: { i1: 800 } } };
    const s = summarize(phone({ paidBefore: 3200 }), snaps, undefined, TODAY);
    expect(s.paid).toBe(4000);
    expect(s.remaining).toBe(5600);
    expect(s.next).toEqual({ ym: '2026-11', date: '2026-12-10', amount: 800 });
    expect(s.paymentsLeft).toBe(7);
    expect(s.endDate).toBe('2027-06-10');
    expect(s.overdue).toBeNull();
  });

  it('пропуск сдвигает срок на месяц', () => {
    const s = summarize(phone({ totalAmount: 1600, overrides: { '2026-11': 0 } }), null, undefined, TODAY);
    expect(s.endDate).toBe('2027-01-10');
    expect(s.paymentsLeft).toBe(2);
  });

  it('закрытая рассрочка', () => {
    const s = summarize(phone({ totalAmount: 800, payments: [{ id: 'p', date: '2026-10-01', amount: 800 }] }), null);
    expect(s.done).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.next).toBeNull();
  });

  it('без суммы в месяц срока нет', () => {
    const s = summarize(phone({ monthlyAmount: 0 }), null, undefined, TODAY);
    expect(s.endDate).toBeNull();
    expect(s.next).toBeNull();
  });

  it('уволенному дальше не удерживаем', () => {
    const worked = (ym: string) => ym <= '2026-10';
    const s = summarize(phone(), null, worked, TODAY);
    expect(s.paymentsLeft).toBe(1);
    expect(s.endDate).toBeNull();
  });

  it('walk отдаёт помесячный путь', () => {
    const { steps, left } = walk(phone({ totalAmount: 1000 }), null, '2026-12');
    expect(steps.map(x => x.amount)).toEqual([800, 200, 0]);
    expect(left).toBe(0);
  });
});
