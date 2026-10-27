import { vacationNow, ymd } from './vacation';

describe('vacationNow', () => {
  const e = { status: 'vacation', vacationFrom: '2026-11-01', vacationUntil: '2026-11-15' };

  it('идёт внутри дат включительно', () => {
    expect(vacationNow(e, '2026-11-01')).toEqual({ from: '2026-11-01', until: '2026-11-15' });
    expect(vacationNow(e, '2026-11-15')).toEqual({ from: '2026-11-01', until: '2026-11-15' });
  });

  it('до начала и после конца — не отпуск', () => {
    expect(vacationNow(e, '2026-10-31')).toBeNull();
    expect(vacationNow(e, '2026-11-16')).toBeNull();
  });

  it('другой статус — не отпуск', () => {
    expect(vacationNow({ ...e, status: 'active' }, '2026-11-05')).toBeNull();
  });

  it('ymd понимает строку и пустое', () => {
    expect(ymd('2026-11-15T00:00:00.000Z')).toBe('2026-11-15');
    expect(ymd(null)).toBeNull();
  });
});
