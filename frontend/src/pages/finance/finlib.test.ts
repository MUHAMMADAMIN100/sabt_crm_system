import { describe, expect, it } from 'vitest';
import { salaryPeriodOf } from './finlib';

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
