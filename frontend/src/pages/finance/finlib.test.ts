import { describe, expect, it } from 'vitest';
import { formatDate, pluralRu, salaryPeriodOf } from './finlib';

describe('salaryPeriodOf payroll boundary', () => {
  it.each([
    ['2026-08-09', '2026-07'],
    ['2026-08-10', '2026-07'],
    ['2026-08-11', '2026-08'],
    ['2026-07-10', '2026-06'],
    ['2026-07-11', '2026-07'],
  ])('maps %s to payroll period %s', (date, expected) => {
    expect(salaryPeriodOf(date)).toBe(expected);
  });
});

describe('finance Russian copy formatters', () => {
  it('formats a long date in genitive case without a leading zero', () => {
    expect(formatDate('2026-07-28')).toBe('28 июля 2026');
  });

  it.each([[1, '1 проект'], [2, '2 проекта'], [5, '5 проектов'], [21, '21 проект']])(
    'uses the correct plural for %s',
    (count, expected) => expect(pluralRu(count, 'проект', 'проекта', 'проектов')).toBe(expected),
  );
});
