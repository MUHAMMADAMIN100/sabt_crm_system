import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, parseAmount, pluralRu, salaryPeriodOf, todayISO } from './finlib';

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

// Разделители тысяч и дробной части (15.11.2026): «1,234.56» было 1.234.
describe('parseAmount', () => {
  it.each([
    ['3500', 3500],
    ['3 500', 3500],
    ['3\u00a0500', 3500],
    ['3\u202f500,50', 3500.5],
    ['1 234,56', 1234.56],
    ['1 234.56', 1234.56],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1234,5', 1234.5],
    ['1234.5', 1234.5],
    ['1 234', 1234],
    // Ровно три цифры после единственного вида разделителя — тысячи.
    ['1,234', 1234],
    ['1.234', 1234],
    ['1,234,567', 1234567],
    ['1.234.567,8', 1234567.8],
    ['10.500', 10500],
    // Округление до дирамов.
    ['10.1234', 10.12],
    ['10.1250', 10.13],
    ['0,5', 0.5],
    ['3 500 с.', 3500],
    ['1234.', 1234],
  ])('parses %j as %s', (input, expected) => {
    if (Number.isNaN(expected)) expect(parseAmount(input)).toBeNaN();
    else expect(parseAmount(input)).toBe(expected);
  });

  it('refuses to guess malformed three-digit tails instead of scaling money by 1000', () => {
    expect(parseAmount('1234,567')).toBeNaN();
    expect(parseAmount('0.125')).toBeNaN();
  });

  it('returns NaN for empty and non-numeric input', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount(',')).toBeNaN();
  });
});

// «Сегодня» — по Душанбе (UTC+5), а не по поясу браузера (15.11.2026).
describe('todayISO', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('uses the Asia/Dushanbe calendar date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 20:30 UTC 14.11 — в Душанбе уже 01:30 15.11.
    vi.setSystemTime(new Date('2026-11-14T20:30:00Z'));
    expect(todayISO()).toBe('2026-11-15');
  });
});
