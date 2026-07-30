import {
  NOTION_HISTORY_METADATA,
  NOTION_HISTORY_TOTALS,
  NOTION_HISTORY_TRANSACTIONS,
  NotionHistoryMonthTotals,
} from './notion-history.data';

const EXPECTED_BY_MONTH: Record<string, NotionHistoryMonthTotals> = {
  '2026-02': { count: 26, income: 8_550, expense: 1_313.02, transfer: 1_350 },
  '2026-03': { count: 37, income: 12_900, expense: 15_461, transfer: 6_040 },
  '2026-04': { count: 67, income: 38_214, expense: 33_034.79, transfer: 2_419 },
  '2026-05': { count: 80, income: 38_230, expense: 45_120.81, transfer: 11_190 },
};

const EXPECTED_ALL: NotionHistoryMonthTotals = {
  count: 210,
  income: 97_894,
  expense: 94_929.62,
  transfer: 20_999,
};

function calculateTotals(): {
  byMonth: Record<string, NotionHistoryMonthTotals>;
  all: NotionHistoryMonthTotals;
} {
  const centsByMonth: Record<string, {
    count: number;
    income: number;
    expense: number;
    transfer: number;
  }> = {};

  for (const transaction of NOTION_HISTORY_TRANSACTIONS) {
    const month = transaction.date.slice(0, 7);
    const totals = centsByMonth[month] ?? {
      count: 0,
      income: 0,
      expense: 0,
      transfer: 0,
    };
    totals.count += 1;
    totals[transaction.type] += Math.round(transaction.amount * 100);
    centsByMonth[month] = totals;
  }

  const byMonth = Object.fromEntries(
    Object.entries(centsByMonth).map(([month, totals]) => [
      month,
      {
        count: totals.count,
        income: totals.income / 100,
        expense: totals.expense / 100,
        transfer: totals.transfer / 100,
      },
    ]),
  );
  const all = Object.values(byMonth).reduce<NotionHistoryMonthTotals>(
    (sum, totals) => ({
      count: sum.count + totals.count,
      income: sum.income + totals.income,
      expense: sum.expense + totals.expense,
      transfer: sum.transfer + totals.transfer,
    }),
    { count: 0, income: 0, expense: 0, transfer: 0 },
  );

  return {
    byMonth,
    all: {
      count: all.count,
      income: Math.round(all.income * 100) / 100,
      expense: Math.round(all.expense * 100) / 100,
      transfer: Math.round(all.transfer * 100) / 100,
    },
  };
}

describe('Notion finance history archive', () => {
  it('contains exactly 210 rows with unique stable external ids', () => {
    const externalIds = NOTION_HISTORY_TRANSACTIONS.map(row => row.externalId);

    expect(externalIds).toHaveLength(210);
    expect(new Set(externalIds).size).toBe(210);
    expect(externalIds.every(Boolean)).toBe(true);
    expect(NOTION_HISTORY_METADATA.rowCount).toBe(210);
  });

  it('contains only positive transactions from February through May 2026', () => {
    for (const row of NOTION_HISTORY_TRANSACTIONS) {
      expect(row.date).toMatch(/^2026-(02|03|04|05)-\d{2}$/);
      expect(row.date >= NOTION_HISTORY_METADATA.dateFromInclusive).toBe(true);
      expect(row.date < NOTION_HISTORY_METADATA.dateToExclusive).toBe(true);
      expect(Number.isFinite(row.amount)).toBe(true);
      expect(row.amount).toBeGreaterThan(0);
    }

    const dates = NOTION_HISTORY_TRANSACTIONS.map(row => row.date).sort();
    expect(dates[0]).toBe(NOTION_HISTORY_METADATA.firstTransactionDate);
    expect(dates.at(-1)).toBe(NOTION_HISTORY_METADATA.lastTransactionDate);
  });

  it('uses account fields that match each transaction type', () => {
    for (const row of NOTION_HISTORY_TRANSACTIONS) {
      if (row.type === 'transfer') {
        expect(row.accountKey).toBeNull();
        expect(row.fromKey).not.toBeNull();
        expect(row.toKey).not.toBeNull();
        expect(row.fromKey).not.toBe(row.toKey);
      } else {
        expect(row.accountKey).not.toBeNull();
        expect(row.fromKey).toBeNull();
        expect(row.toKey).toBeNull();
      }
    }
  });

  it('matches the independently calculated monthly and overall control totals', () => {
    const calculated = calculateTotals();

    expect(Object.keys(calculated.byMonth).sort()).toEqual([
      ...NOTION_HISTORY_METADATA.months,
    ]);
    expect(calculated.byMonth).toEqual(EXPECTED_BY_MONTH);
    expect(NOTION_HISTORY_TOTALS.byMonth).toEqual(EXPECTED_BY_MONTH);
    expect(calculated.all).toEqual(EXPECTED_ALL);
    expect(NOTION_HISTORY_TOTALS.all).toEqual(EXPECTED_ALL);
  });
});
