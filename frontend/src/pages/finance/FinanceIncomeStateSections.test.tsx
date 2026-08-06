import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceIncomeGroupPage from './FinanceIncomeGroupPage';

const mocks = vi.hoisted(() => ({
  incomeDirectionDetail: vi.fn(),
  projects: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    incomeDirectionDetail: mocks.incomeDirectionDetail,
    projects: mocks.projects,
  },
}));

describe('finance income project state sections', () => {
  beforeEach(() => {
    mocks.incomeDirectionDetail.mockReset();
    mocks.projects.mockReset();
    mocks.incomeDirectionDetail.mockResolvedValue({
      kind: 'matrix',
      rows: [],
      months: [],
      stats: { expected: 0, received: 0 },
      totals: { tariff: 0, perMonth: [] },
    });
    mocks.projects.mockResolvedValue([{
      id: 'project-paused',
      name: 'Проект на паузе',
      direction: 'development',
      status: 'paused',
      archived: false,
      tariff: 8_000,
      pausedAt: '2026-07-01',
    }]);
  });

  it('shows paused projects even when there are no active or archived projects', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/income/development?ym=2026-08']}>
          <Routes>
            <Route path="/finance/income/:direction" element={<FinanceIncomeGroupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Нет активных проектов')).toBeInTheDocument();
    const toggle = await screen.findByRole('button', { name: /На паузе \(1/ });
    expect(toggle).toHaveClass('fin-secondary-table-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.closest('.fin-secondary-table-stack')).toBeInTheDocument();

    await act(async () => { await user.click(toggle); });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Проект на паузе')).toBeInTheDocument();
    expect(document.getElementById('paused-projects-development')).toBeInTheDocument();
  });
});
