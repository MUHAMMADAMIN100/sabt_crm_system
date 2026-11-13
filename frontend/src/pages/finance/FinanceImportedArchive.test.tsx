import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceTransactionsPage, { buildFinanceTransactionCsv } from './FinanceTransactionsPage';
import { currentYm } from './finlib';
import { IMPORTED_ARCHIVE_HINT } from './ImportedArchiveBadge';

const mocks = vi.hoisted(() => ({
  transactions: vi.fn(),
  categories: vi.fn(),
  accounts: vi.fn(),
  projects: vi.fn(),
  employees: vi.fn(),
  debts: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    transactions: mocks.transactions,
    categories: mocks.categories,
    accounts: mocks.accounts,
    projects: mocks.projects,
    employees: mocks.employees,
    debts: mocks.debts,
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
    mocks.projects.mockReset();
    mocks.employees.mockReset();
    mocks.debts.mockReset();
    mocks.transactions.mockResolvedValue({ items: [importedTx], total: 1, page: 1, pageSize: 100 });
    mocks.categories.mockResolvedValue([{ id: 'rent', name: 'Аренда', type: 'expense' }]);
    mocks.accounts.mockResolvedValue([{ id: 'cash', name: 'Cash' }]);
    mocks.projects.mockResolvedValue([]);
    mocks.employees.mockResolvedValue([]);
    mocks.debts.mockResolvedValue([]);
  });

  // С 05.11.2026 «Транзакции» открываются календарём, таблица — ?view=table.
  it('renders an imported transaction read-only in table and calendar views', async () => {
    const user = userEvent.setup();
    wrap(<FinanceTransactionsPage />, '/finance/transactions?view=table');

    expect(screen.getByRole('textbox', { name: 'Поиск транзакций' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Тип транзакции' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Статус транзакции' })).toBeInTheDocument();
    const badge = await screen.findByLabelText('Notion · архив');
    expect(badge).toHaveAttribute('title', IMPORTED_ARCHIVE_HINT);
    const row = badge.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(row!).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'Подробнее об операции' })).toBeInTheDocument();
    await act(async () => { await user.click(within(row!).getByRole('button', { name: 'Подробнее об операции' })); });
    expect(screen.getByRole('region', { name: /Подробности операции/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Изменить/ })).not.toBeInTheDocument();
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Свернуть' })); });
    expect(screen.queryByRole('region', { name: /Подробности операции/ })).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Календарь' }));
    });
    const calendarBadge = await screen.findByLabelText('Notion · архив');
    const calendarRow = calendarBadge.closest('.tx-row');
    // div с role="button" (05.11.2026): нативный drag на <button> в Chrome не стартует.
    expect(calendarRow).toHaveAttribute('role', 'button');
    expect(calendarRow).toHaveAttribute('tabindex', '0');
    await act(async () => { await user.click(calendarRow!); });
    const dialog = screen.getByRole('dialog', { name: 'Операция' });
    expect(within(dialog).getByText('Аренда из старого учёта')).toBeInTheDocument();
    // Архив Notion — только просмотр: кнопки «Открыть» (правка) нет.
    expect(within(dialog).queryByRole('button', { name: 'Открыть' })).not.toBeInTheDocument();
  });

  it('shows an explicit retry state when the calendar request fails', async () => {
    const user = userEvent.setup();
    mocks.transactions.mockImplementation((params: any) => (
      params?.from
        ? Promise.reject(new Error('calendar unavailable'))
        : Promise.resolve({ items: [importedTx], total: 1, page: 1, pageSize: 100 })
    ));

    wrap(<FinanceTransactionsPage />, '/finance/transactions?view=table');
    await screen.findByLabelText('Notion · архив');
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Календарь' })); });

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Не удалось загрузить операции календаря.');
    expect(within(error).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('keeps regular transaction rows view-first and opens one edit form on demand', async () => {
    const user = userEvent.setup();
    const regular = { ...importedTx, id: 'regular-1', source: null, affectsBalance: true };
    mocks.transactions.mockResolvedValue({ items: [regular], total: 1, page: 1, pageSize: 50 });

    wrap(<FinanceTransactionsPage />, '/finance/transactions?view=table&type=expense');
    const action = await screen.findByLabelText(/Действия операции/);
    const row = action.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(row!).queryByRole('combobox')).not.toBeInTheDocument();

    await user.click(action);
    await user.click(screen.getByRole('button', { name: 'Редактировать' }));
    expect(screen.getAllByRole('dialog', { name: 'Изменить операцию' })).toHaveLength(1);
  });

  it('keeps the archive source in the CSV contract', () => {
    const rows = buildFinanceTransactionCsv([
      importedTx,
      { ...importedTx, id: 'regular', source: null, affectsBalance: true },
    ]);
    const last = (row: Array<string | number | null>) => row[row.length - 1];
    expect(last(rows[0])).toBe('Источник');
    expect(last(rows[1])).toBe('Notion · архив');
    expect(last(rows[2])).toBeNull();
  });
});
