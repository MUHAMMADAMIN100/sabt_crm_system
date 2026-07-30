import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceExpenseGroupPage from './FinanceExpenseGroupPage';

const mocks = vi.hoisted(() => ({
  expenseDetail: vi.fn(),
  employees: vi.fn(),
  employeePayouts: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    expenseDetail: mocks.expenseDetail,
    employees: mocks.employees,
    employeePayouts: mocks.employeePayouts,
  },
}));

describe('salary employee inline expansion', () => {
  beforeEach(() => {
    mocks.expenseDetail.mockReset();
    mocks.employees.mockReset();
    mocks.employeePayouts.mockReset();
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

  it('opens and closes history under the employee row without a dialog', async () => {
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

    const trigger = await screen.findByRole('button', { name: 'Бехруз Миров' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await act(async () => { await user.click(trigger); });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Повышение оклада')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'История зарплаты — Бехруз Миров' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => { await user.click(screen.getByRole('button', { name: 'Свернуть' })); });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'История зарплаты — Бехруз Миров' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
