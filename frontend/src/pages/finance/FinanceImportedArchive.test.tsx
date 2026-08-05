import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceTransactionsPage, { buildFinanceTransactionCsv } from './FinanceTransactionsPage';
import FinancePlanningPage from './FinancePlanningPage';
import { currentYm } from './finlib';
import { IMPORTED_ARCHIVE_HINT } from './ImportedArchiveBadge';

const mocks = vi.hoisted(() => ({
  transactions: vi.fn(),
  categories: vi.fn(),
  accounts: vi.fn(),
  forecast: vi.fn(),
  removeForecastAdjustment: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    transactions: mocks.transactions,
    categories: mocks.categories,
    accounts: mocks.accounts,
    forecast: mocks.forecast,
    removeForecastAdjustment: mocks.removeForecastAdjustment,
  },
}));

function wrap(children: ReactNode, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('imported Notion finance history', () => {
  const ym = currentYm();
  const importedTx = {
    id: 'notion:tx-1',
    source: 'notion',
    externalId: 'tx-1',
    affectsBalance: false,
    date: `${ym}-10`,
    type: 'expense',
    amount: 1_250,
    status: 'completed',
    comment: 'Аренда из старого учёта',
    categoryId: 'rent',
    categoryName: 'Аренда',
    categoryIcon: 'building',
    categoryColor: '#64748b',
    accountId: 'cash',
    accountName: 'Cash',
  };

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    mocks.transactions.mockReset();
    mocks.categories.mockReset();
    mocks.accounts.mockReset();
    mocks.forecast.mockReset();
    mocks.removeForecastAdjustment.mockReset();
    mocks.transactions.mockResolvedValue({ items: [importedTx], total: 1, page: 1, pageSize: 100 });
    mocks.categories.mockResolvedValue([{ id: 'rent', name: 'Аренда', type: 'expense' }]);
    mocks.accounts.mockResolvedValue([{ id: 'cash', name: 'Cash' }]);
  });

  it('renders an imported transaction read-only in table and calendar views', async () => {
    const user = userEvent.setup();
    wrap(<FinanceTransactionsPage />, '/finance/transactions');

    const badge = await screen.findByLabelText('Notion · архив');
    expect(badge).toHaveAttribute('title', IMPORTED_ARCHIVE_HINT);
    const row = badge.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(row!).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row!).queryByRole('button')).not.toBeInTheDocument();
    expect(row).toHaveAttribute('title', IMPORTED_ARCHIVE_HINT);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Календарь' }));
    });
    const calendarBadge = await screen.findByLabelText('Notion · архив');
    const calendarRow = calendarBadge.closest('.tx-row');
    expect(calendarRow?.tagName).toBe('DIV');
    await act(async () => { await user.click(calendarRow!); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the archive source in the CSV contract', () => {
    const rows = buildFinanceTransactionCsv([
      importedTx,
      { ...importedTx, id: 'regular', source: null, affectsBalance: true },
    ]);
    expect(rows[0].at(-1)).toBe('Источник');
    expect(rows[1].at(-1)).toBe('Notion · архив');
    expect(rows[2].at(-1)).toBeNull();
  });

  it('shows imported source metadata in the expanded planning month', async () => {
    const user = userEvent.setup();
    mocks.forecast.mockResolvedValue({
      start: '2026-03',
      availableFrom: '2026-03',
      months: 6,
      scenario: 'base',
      openingBalance: 0,
      rows: [{
        ym: '2026-03',
        openingBalance: 0,
        income: 2_500,
        expense: 0,
        net: 2_500,
        closingBalance: 0,
        balanceNow: null,
        actualIncome: 2_500,
        actualExpense: 0,
        plannedIncome: 0,
        plannedExpense: 0,
        incomeSources: [{
          key: 'notion:income-1',
          source: 'notion',
          imported: true,
          label: 'Оплата старого проекта',
          kind: 'Исторический доход',
          amount: 2_500,
          date: '2026-03-12',
          categoryName: 'SMM',
          accountName: 'Cash',
        }],
        expenseSources: [],
        warning: false,
        balanceBasis: 'crm_cutover',
        balanceReset: true,
      }],
      adjustments: [],
      summary: {
        expectedIncome: 2_500,
        expectedExpense: 0,
        result: 2_500,
        endingBalance: 0,
        minBalance: 0,
        cashGapYm: null,
      },
    });

    wrap(<FinancePlanningPage />);
    await waitFor(() => expect(mocks.forecast).toHaveBeenLastCalledWith({
      start: `${currentYm().slice(0, 4)}-01`,
      months: 12,
      scenario: 'base',
    }));
    expect(await screen.findByText(/март 2026 — декабрь 2026/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Другой год' })).toHaveValue('2026');

    const month = await screen.findByText('март 2026');
    expect(screen.getByText('переход на остатки CRM')).toHaveAttribute(
      'title',
      'С этого месяца остаток считается по счетам CRM, а не по архиву Notion',
    );
    await act(async () => { await user.click(month.closest('tr')!); });

    expect(await screen.findByText('Оплата старого проекта')).toBeInTheDocument();
    expect(screen.getByLabelText('Notion · архив')).toHaveAttribute('title', IMPORTED_ARCHIVE_HINT);
    expect(screen.getByText(/12 март 2026.*категория: SMM.*счёт: Cash/)).toBeInTheDocument();

    await act(async () => {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Другой год' }), '2027');
    });
    await waitFor(() => expect(mocks.forecast).toHaveBeenLastCalledWith({
      start: '2027-01',
      months: 12,
      scenario: 'base',
    }));
  });
});
