import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import FinanceExpenseGroupPage from './FinanceExpenseGroupPage';
import FinanceIncomeGroupPage from './FinanceIncomeGroupPage';

const mocks = vi.hoisted(() => ({
  expenseDetail: vi.fn(() => new Promise(() => undefined)),
  incomeDirectionDetail: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    expenseDetail: mocks.expenseDetail,
    incomeDirectionDetail: mocks.incomeDirectionDetail,
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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
});
