import {
  capParts, deductionOf, deductionParts, manualPaid, plannedFor, summarize, walk, InstallmentLike,
} from './installments.logic';

const phone = (over: Partial<InstallmentLike> = {}): InstallmentLike => ({
  id: 'i1', name: 'iPhone 15', totalAmount: 9600, monthlyAmount: 800, startYm: '2026-10',
  paidBefore: 0, overrides: null, payments: null, ...over,
});

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
    // остаток 9100 → дальше по 1000
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

  it('удержание не больше, чем причитается за месяц', () => {
    const parts = [{ id: 'a', name: 'A', amount: 800 }, { id: 'b', name: 'B', amount: 600 }];
    expect(capParts(parts, 1000)).toEqual([{ id: 'a', name: 'A', amount: 800 }, { id: 'b', name: 'B', amount: 200 }]);
    expect(capParts(parts, 0)).toEqual([]);
  });

  it('части по нескольким рассрочкам', () => {
    const a = phone();
    const b = phone({ id: 'i2', name: 'Стиральная машина', totalAmount: 3600, monthlyAmount: 600 });
    expect(deductionParts([a, b], null, '2026-10')).toEqual([
      { id: 'i1', name: 'iPhone 15', amount: 800 },
      { id: 'i2', name: 'Стиральная машина', amount: 600 },
    ]);
  });
});

describe('installments: итог', () => {
  it('считает возвращённое, остаток и последний месяц', () => {
    const snaps = { '2026-10': { installments: { i1: 800 } } };
    const s = summarize(phone({ paidBefore: 3200 }), snaps);
    expect(s.paid).toBe(4000);
    expect(s.remaining).toBe(5600);
    expect(s.next).toEqual({ ym: '2026-11', amount: 800 });
    expect(s.paymentsLeft).toBe(7);
    expect(s.endYm).toBe('2027-05');
    expect(s.done).toBe(false);
  });

  it('пропуск сдвигает срок на месяц', () => {
    const s = summarize(phone({ totalAmount: 1600, overrides: { '2026-11': 0 } }), null);
    expect(s.endYm).toBe('2026-12');
    expect(s.paymentsLeft).toBe(2);
  });

  it('закрытая рассрочка', () => {
    const s = summarize(phone({ totalAmount: 800, payments: [{ id: 'p', date: '2026-10-01', amount: 800 }] }), null);
    expect(s.done).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.next).toBeNull();
  });

  it('без суммы в месяц срока нет', () => {
    const s = summarize(phone({ monthlyAmount: 0 }), null);
    expect(s.endYm).toBeNull();
    expect(s.next).toBeNull();
  });

  it('уволенному дальше не удерживаем', () => {
    const worked = (ym: string) => ym <= '2026-10';
    const s = summarize(phone(), null, worked);
    expect(s.paymentsLeft).toBe(1);
    expect(s.endYm).toBeNull();
  });

  it('walk отдаёт помесячный путь', () => {
    const { steps, left } = walk(phone({ totalAmount: 1000 }), null, '2026-12');
    expect(steps.map(x => x.amount)).toEqual([800, 200, 0]);
    expect(left).toBe(0);
  });
});
