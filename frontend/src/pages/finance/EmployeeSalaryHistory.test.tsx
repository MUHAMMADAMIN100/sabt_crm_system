import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeSalaryHistory from './EmployeeSalaryHistory';

const mocks = vi.hoisted(() => ({
  employeePayouts: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    employeePayouts: mocks.employeePayouts,
  },
}));

function renderHistory(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeSalaryHistory employeeId="emp-1" name="Бехруз Миров" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('EmployeeSalaryHistory', () => {
  beforeEach(() => {
    mocks.employeePayouts.mockReset();
    mocks.employeePayouts.mockResolvedValue({
      currentSalary: 5_000,
      salaryChanges: [
        { effectiveYm: '2026-07', salary: 5_000, previousSalary: 4_000, delta: 1_000 },
        { effectiveYm: '2026-03', salary: 4_000, previousSalary: null, delta: null },
      ],
      rows: [{
        id: 'advance-1',
        kind: 'advance',
        kindLabel: 'Аванс',
        amount: 700,
        date: '2026-07-20',
        salaryYm: '2026-07',
        accountName: 'Наличные',
        note: 'На дорогу',
      }],
      periods: [
        { ym: '2026-07', salary: 5_000, advance: 700, bonus: 0, fine: 0, accrued: 5_000, paidByOperations: 700, frozen: false },
        { ym: '2026-06', salary: 4_000, advance: 500, bonus: 0, fine: 0, accrued: 4_000, paidByOperations: 4_000, frozen: true },
      ],
      totals: { advance: 1_200, paidByOperations: 4_700 },
    });
  });

  it('renders all-time salary changes and advance details inline', async () => {
    renderHistory();

    await waitFor(() => expect(mocks.employeePayouts).toHaveBeenCalledWith('emp-1', 'all'));
    expect(await screen.findByText('Повышение оклада')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'История зарплаты — Бехруз Миров' })).toBeInTheDocument();
    expect(screen.getByText('Наличные', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('На дорогу')).toBeInTheDocument();
    expect(screen.getByText('Детали старой выдачи не сохранились')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('collapses through the inline panel control', async () => {
    const user = userEvent.setup();
    const onClose = renderHistory();
    await screen.findByText('Изменения оклада');

    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
