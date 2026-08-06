import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceActivityPage, { activityChanges } from './FinanceActivityPage';

const mocks = vi.hoisted(() => ({
  activity: vi.fn(), accounts: vi.fn(), categories: vi.fn(), projects: vi.fn(),
  employees: vi.fn(), debts: vi.fn(), subscriptions: vi.fn(), assets: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({ financeApi: mocks }));

describe('FinanceActivityPage', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.activity.mockResolvedValue({
      total: 1,
      rows: [{
        id: 'event-12345678', userName: 'Мухаммад', action: 'Изменил проект (финансы)',
        route: 'PATCH /finance/projects/project-1', createdAt: '2026-08-06T10:44:00.000Z',
        details: {
          input: { id: 'project-1', tariff: 8000, status: 'active' },
          before: { id: 'project-1', name: 'Мукофот', tariff: 7000, status: 'paused' },
          after: { id: 'project-1', name: 'Мукофот', tariff: 8000, status: 'active' },
        },
      }],
    });
    mocks.accounts.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
    mocks.projects.mockResolvedValue([{ id: 'project-1', name: 'Мукофот' }]);
    mocks.employees.mockResolvedValue([]);
    mocks.debts.mockResolvedValue([]);
    mocks.subscriptions.mockResolvedValue([]);
    mocks.assets.mockResolvedValue([]);
  });

  it('opens activity details inline and shows before → after values', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FinanceActivityPage /></QueryClientProvider>);

    const action = await screen.findByText('Изменил проект (финансы)');
    const row = action.closest('tr')!;
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await act(async () => { await userEvent.click(row); });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /Подробности активности/ })).toBeInTheDocument();
    expect(screen.getByText('Что изменилось')).toBeInTheDocument();
    expect(screen.getByText('7 000 с.')).toBeInTheDocument();
    expect(screen.getAllByText('8 000 с.').length).toBeGreaterThan(0);
    expect(screen.getByText('На паузе')).toBeInTheDocument();
    expect(screen.getAllByText('Активный').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps legacy flat details readable', () => {
    expect(activityChanges({ amount: 500, employeeId: 'emp-1' })).toEqual({
      hasSnapshots: false,
      rows: [
        { key: 'amount', value: 500, compared: false },
        { key: 'employeeId', value: 'emp-1', compared: false },
      ],
    });
  });
});
