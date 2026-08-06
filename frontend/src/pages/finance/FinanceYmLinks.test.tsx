import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import FinanceExpenseGroupPage from './FinanceExpenseGroupPage';
import FinanceIncomeGroupPage from './FinanceIncomeGroupPage';
import FinanceExpensePage from './FinanceExpensePage';

const mocks = vi.hoisted(() => ({
  expenseDetail: vi.fn(() => new Promise(() => undefined)),
  incomeDirectionDetail: vi.fn(() => new Promise(() => undefined)),
  expenseSummary: vi.fn(async () => ({
    salary: { toPay: 1200, count: 2, paidCount: 0 },
    subscriptions: { toPay: 300, count: 1, paidCount: 0 },
    debts: { monthly: 400, remaining: 800 }, other: { spent: 100 },
  })),
  breakdown: vi.fn(async () => ({ items: [], total: 0 })),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    expenseDetail: mocks.expenseDetail,
    incomeDirectionDetail: mocks.incomeDirectionDetail,
    expenseSummary: mocks.expenseSummary,
    breakdown: mocks.breakdown,
  },
}));

function renderRoute(initialEntry: string, path: string, element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('finance detail back links', () => {
  it('keeps the selected income month', () => {
    renderRoute('/finance/income/smm?ym=2026-06', '/finance/income/:direction', <FinanceIncomeGroupPage />);

    expect(screen.getByRole('link', { name: /Доход/ }))
      .toHaveAttribute('href', '/finance/income?ym=2026-06');
  });

  it('keeps the selected expense month', () => {
    renderRoute('/finance/expense/other?ym=2026-05', '/finance/expense/:kind', <FinanceExpenseGroupPage />);

    expect(screen.getByRole('link', { name: /Расход/ }))
      .toHaveAttribute('href', '/finance/expense?ym=2026-05');
  });

  it('keeps August when opening salary from expense overview', async () => {
    renderRoute('/finance/expense?ym=2026-08', '/finance/expense', <FinanceExpensePage />);

    const salary = await screen.findByRole('button', { name: 'Открыть «Зарплата»' });
    fireEvent.click(salary);

    expect(screen.getByTestId('location')).toHaveTextContent('/finance/expense/salary?ym=2026-08');
  });
});
