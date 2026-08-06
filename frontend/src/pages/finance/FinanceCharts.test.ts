import { describe, expect, it } from 'vitest';
import { buildPlanningChartRows, flowBarPercent, formatChartMoney, type PlanningChartPoint } from './FinanceCharts';

const point = (overrides: Partial<PlanningChartPoint> = {}): PlanningChartPoint => ({
  ym: '2026-08',
  income: 1500,
  expense: 600,
  net: 900,
  closingBalance: 3900,
  actualIncome: 1000,
  plannedIncome: 500,
  actualExpense: 400,
  plannedExpense: 200,
  ...overrides,
});

describe('finance chart data transforms', () => {
  it('draws expenses below zero while preserving original values', () => {
    const [row] = buildPlanningChartRows([point()]);

    expect(row.actualExpenseChart).toBe(-400);
    expect(row.plannedExpenseChart).toBe(-200);
    expect(row.expense).toBe(600);
    expect(row.income).toBe(1500);
  });

  it('formats compact chart values including negative and million values', () => {
    expect(formatChartMoney(0)).toBe('0');
    expect(formatChartMoney(499)).toBe('499');
    expect(formatChartMoney(-12_000)).toContain('−12');
    expect(formatChartMoney(1_200_000)).toContain('1,2 млн');
    expect(formatChartMoney(Number.NaN)).toBe('0');
  });

  it('uses a shared scale for monthly flow comparison', () => {
    expect(flowBarPercent(500, 1000, 500)).toBe(50);
    expect(flowBarPercent(1, 1000, 1)).toBe(3);
    expect(flowBarPercent(0, 1000, 0)).toBe(0);
    expect(flowBarPercent(1000, 1000, 500)).toBe(100);
  });
});
