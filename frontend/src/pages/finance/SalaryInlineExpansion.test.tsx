import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceExpenseGroupPage from './FinanceExpenseGroupPage';

const mocks = vi.hoisted(() => ({
  expenseDetail: vi.fn(),
  employees: vi.fn(),
  employeePayouts: vi.fn(),
  accounts: vi.fn(),
  categories: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    expenseDetail: mocks.expenseDetail,
    employees: mocks.employees,
    employeePayouts: mocks.employeePayouts,
    accounts: mocks.accounts,
    categories: mocks.categories,
  },
}));

describe('salary employee inline expansion', () => {
  beforeEach(() => {
    mocks.expenseDetail.mockReset();
    mocks.employees.mockReset();
    mocks.employeePayouts.mockReset();
    mocks.accounts.mockReset();
    mocks.categories.mockReset();
    mocks.accounts.mockResolvedValue([{ id: 'cash', name: 'Cash', archived: false }]);
    mocks.categories.mockResolvedValue([{ id: 'salary', key: 'salary', name: 'Зарплата' }]);
    const employee = {
      id: 'emp-1',
      name: 'Бехруз Миров',
      role: 'Руководитель',
      hireDate: '2026-03-26',
      salary: 5_000,
      salaryHistory: { '2026-03': 4_000, '2026-07': 5_000 },
      advance: 0,
      bonus: 0,
      fine: 0,
      paid: 0,
      toPay: 5_000,
      frozen: false,
      status: 'active',
    };
    mocks.expenseDetail.mockResolvedValue({
      cards: { fund: 5_000, advances: 0, bonuses: 0, fines: 0, paid: 0, toPay: 5_000 },
      rows: [employee],
      fired: [],
      allPaid: false,
    });
    mocks.employees.mockResolvedValue([employee]);
    mocks.employeePayouts.mockResolvedValue({
      currentSalary: 5_000,
      salaryChanges: [
        { effectiveYm: '2026-07', salary: 5_000, previousSalary: 4_000, delta: 1_000 },
        { effectiveYm: '2026-03', salary: 4_000, previousSalary: null, delta: null },
      ],
      rows: [],
      periods: [],
      totals: { advance: 0, paidByOperations: 0 },
    });
  });

  it('toggles history by clicking the free row area without an arrow or name button', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/expense/salary?ym=2026-07']}>
          <Routes>
            <Route path="/finance/expense/:kind" element={<FinanceExpenseGroupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const name = await screen.findByText('Бехруз Миров');
    const row = name.closest('tr');
    expect(row).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Бехруз Миров' })).not.toBeInTheDocument();
    expect(name.closest('td')?.querySelector('svg')).toBeNull();
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await act(async () => { await user.click(row!); });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Повышение оклада')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'История зарплаты — Бехруз Миров' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => { await user.click(row!); });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'История зарплаты — Бехруз Миров' })).not.toBeInTheDocument();
  });

  it('does not toggle history from nested inputs and action buttons', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/expense/salary?ym=2026-07']}>
          <Routes>
            <Route path="/finance/expense/:kind" element={<FinanceExpenseGroupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const name = await screen.findByText('Бехруз Миров');
    const row = name.closest('tr')!;
    const fineInput = row.querySelector('input')!;

    await act(async () => { await user.click(fineInput); });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await act(async () => {
      await user.click(within(row).getByRole('button', { name: 'Выплатить' }));
    });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Выплата ЗП · Бехруз Миров')).toBeInTheDocument();
  });

  it('supports Enter/Space and restores focus to the row after collapsing', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/expense/salary?ym=2026-07']}>
          <Routes>
            <Route path="/finance/expense/:kind" element={<FinanceExpenseGroupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const name = await screen.findByText('Бехруз Миров');
    const row = name.closest('tr')!;
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('region', { name: 'История зарплаты — Бехруз Миров' })).toBeInTheDocument();
    await screen.findByText('Повышение оклада');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    });
    await waitFor(() => expect(row).toHaveFocus());
    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(row, { key: ' ' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps fired employees in one accessible full-width section', async () => {
    const user = userEvent.setup();
    const firedEmployee = {
      id: 'emp-fired', name: 'Сотрудник Архивный', role: 'Менеджер',
      hireDate: '2025-03-01', salary: 3_000, status: 'fired',
    };
    mocks.expenseDetail.mockResolvedValue({
      cards: { fund: 0, advances: 0, bonuses: 0, fines: 0, paid: 0, toPay: 0 },
      rows: [], fired: [firedEmployee], allPaid: true,
    });
    mocks.employees.mockResolvedValue([firedEmployee]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/expense/salary?ym=2026-07']}>
          <Routes>
            <Route path="/finance/expense/:kind" element={<FinanceExpenseGroupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { name: /Уволенные сотрудники/ });
    expect(toggle).toHaveClass('fin-secondary-table-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'fired-employees-table');
    expect(toggle.closest('section')).toHaveClass('fin-secondary-table-section');

    await act(async () => { await user.click(toggle); });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('fired-employees-table')).toBeInTheDocument();
    expect(screen.getByText('Сотрудник Архивный')).toBeInTheDocument();
  });
});
