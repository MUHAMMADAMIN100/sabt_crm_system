import { clipToMonth, vacationHint, vacationMonthCost, workdaysBetween, ScheduleRowLike, VacationRecordLike } from './vacation-pay.logic';

const U = 'user-1';
const company: ScheduleRowLike[] = [{ userId: null, validFrom: '2020-01-01', workdays: '1,2,3,4,5,6' }];
const rec = (over: Partial<VacationRecordLike> = {}): VacationRecordLike => ({
  id: 'v1', userId: U, dateFrom: '2026-10-26', dateUntil: '2026-11-09', paid: false, decisions: null, ...over,
});

describe('vacation-pay.logic', () => {
  it('рабочие дни месяца по графику пн–сб', () => {
    expect(workdaysBetween(company, U, '2026-10-01', '2026-10-31')).toBe(27);
    expect(workdaysBetween(company, U, '2026-11-01', '2026-11-30')).toBe(25);
    // без строк графика — тоже пн–сб
    expect(workdaysBetween([], U, '2026-10-01', '2026-10-31')).toBe(27);
  });

  it('отпуск через два месяца делится по месяцам', () => {
    expect(clipToMonth('2026-10-26', '2026-11-09', '2026-10')).toEqual({ from: '2026-10-26', until: '2026-10-31' });
    expect(clipToMonth('2026-10-26', '2026-11-09', '2026-11')).toEqual({ from: '2026-11-01', until: '2026-11-09' });
    expect(clipToMonth('2026-10-26', '2026-11-09', '2026-12')).toBeNull();
  });

  it('сумма как на макете: 5 000 ÷ 27 × 6 и 5 000 ÷ 25 × 7', () => {
    expect(vacationMonthCost(company, U, 5000, '2026-10-26', '2026-11-09', '2026-10'))
      .toEqual({ monthFrom: '2026-10-26', monthUntil: '2026-10-31', days: 6, monthWorkdays: 27, amount: 1111 });
    expect(vacationMonthCost(company, U, 5000, '2026-10-26', '2026-11-09', '2026-11'))
      .toEqual({ monthFrom: '2026-11-01', monthUntil: '2026-11-09', days: 7, monthWorkdays: 25, amount: 1400 });
  });

  it('личный график сильнее общего, «как у всех» возвращает общий', () => {
    const rows: ScheduleRowLike[] = [
      ...company,
      { userId: U, validFrom: '2026-10-01', workdays: '1,2,3,4,5' },
      { userId: U, validFrom: '2026-10-29', workdays: null, followsCompany: true },
    ];
    // 1–28 окт. пн–пт (20 дней), 29–31 окт. снова пн–сб (чт, пт, сб — 3)
    expect(workdaysBetween(rows, U, '2026-10-01', '2026-10-31')).toBe(23);
  });

  it('подсказка ждёт решения, пока его нет', () => {
    const h = vacationHint(rec(), company, 5000, '2026-10', new Set())!;
    expect(h.state).toBe('pending');
    expect(h.amount).toBe(1111);
    expect(h.previousEntryId).toBeNull();
  });

  it('оплачиваемый — только виден', () => {
    expect(vacationHint(rec({ paid: true }), company, 5000, '2026-10', new Set())!.state).toBe('paid');
  });

  it('удержали — подсказка уходит; удалили запись — снова ждёт', () => {
    const decisions = { '2026-10': { decision: 'withheld' as const, from: '2026-10-26', until: '2026-10-31', entryId: 'e1', amount: 1111 } };
    expect(vacationHint(rec({ decisions }), company, 5000, '2026-10', new Set(['e1']))!.state).toBe('withheld');
    const again = vacationHint(rec({ decisions }), company, 5000, '2026-10', new Set())!;
    expect(again.state).toBe('pending');
    expect(again.previousEntryId).toBeNull();
  });

  it('не удерживать — подсказка не возвращается', () => {
    const decisions = { '2026-10': { decision: 'dismissed' as const, from: '2026-10-26', until: '2026-10-31' } };
    expect(vacationHint(rec({ decisions }), company, 5000, '2026-10', new Set())!.state).toBe('dismissed');
  });

  it('даты поменяли после удержания — снова ждёт, старую запись заменим', () => {
    const decisions = { '2026-10': { decision: 'withheld' as const, from: '2026-10-26', until: '2026-10-31', entryId: 'e1', amount: 1111 } };
    const h = vacationHint(rec({ dateFrom: '2026-10-29', decisions }), company, 5000, '2026-10', new Set(['e1']))!;
    expect(h.state).toBe('pending');
    expect(h.days).toBe(3);
    expect(h.amount).toBe(556);
    expect(h.previousEntryId).toBe('e1');
    expect(h.previousAmount).toBe(1111);
  });

  it('отпуск только на выходной — подсказки нет', () => {
    expect(vacationHint(rec({ dateFrom: '2026-10-25', dateUntil: '2026-10-25' }), company, 5000, '2026-10', new Set())).toBeNull();
  });
});
