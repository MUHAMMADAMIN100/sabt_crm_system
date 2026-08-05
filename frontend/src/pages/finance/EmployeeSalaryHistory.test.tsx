import { render, screen, waitFor, within } from '@testing-library/react';
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
      }, {
        id: 'salary-1',
        kind: 'salary',
        kindLabel: 'Зарплата',
        amount: 3_500,
        date: '2026-07-10',
        salaryYm: '2026-06',
        accountName: 'Наличные',
        note: null,
      }],
      periods: [
        { ym: '2026-07', salary: 5_000, advance: 700, bonus: 0, fine: 0, accrued: 5_000, paidByOperations: 700, recordedPaid: 700, frozen: false },
        { ym: '2026-06', salary: 4_000, advance: 500, bonus: 0, fine: 0, accrued: 4_000, paidByOperations: 3_500, recordedPaid: 4_000, frozen: true },
      ],
    });
  });

  it('renders salary changes and one unified monthly payment history', async () => {
    renderHistory();

    await waitFor(() => expect(mocks.employeePayouts).toHaveBeenCalledWith('emp-1', 'all'));
    expect(await screen.findByText('Повышение оклада')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'История зарплаты — Бехруз Миров' })).toBeInTheDocument();
    expect(screen.getAllByText('Наличные', { exact: false })).toHaveLength(2);
    expect(screen.getByText('На дорогу')).toBeInTheDocument();
    expect(screen.getByText('Дата и счёт старой выдачи не сохранились')).toBeInTheDocument();
    expect(screen.getByText('Выплаты по месяцам')).toBeInTheDocument();
    expect(screen.queryByText('История выдачи авансов')).not.toBeInTheDocument();
    expect(screen.queryByText('Начисления по месяцам')).not.toBeInTheDocument();
    expect(screen.queryByText('Зарплата и бонусы по счетам')).not.toBeInTheDocument();
    expect(screen.queryByText('Выплачено по счетам')).not.toBeInTheDocument();
    expect(screen.queryByText('Всего авансов')).not.toBeInTheDocument();
    expect(screen.queryByText(/Последняя ставка/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const monthHistory = screen.getByText('Выплаты по месяцам').closest('section')!;
    const juneLabel = within(monthHistory).getByText(/июнь 2026/i);
    expect(within(monthHistory).getAllByText(/июнь 2026/i)).toHaveLength(1);
    const june = juneLabel.closest('article')!;
    expect(within(june).getByText('Всего выплат зафиксировано')).toBeInTheDocument();
    expect(within(june).getAllByText('4 000 с.')).toHaveLength(2);
  });

  it('shows advance and final payment as parts of one month without a false raise', async () => {
    mocks.employeePayouts.mockResolvedValueOnce({
      currentSalary: 5_000,
      salaryChanges: [
        { effectiveYm: '2026-03', salary: 5_000, previousSalary: null, delta: null, isCurrent: true },
      ],
      rows: [{
        id: 'advance', kind: 'advance', kindLabel: 'Аванс', amount: 1_500,
        date: '2026-07-25', salaryYm: '2026-07', accountName: 'Наличные', note: null,
      }, {
        id: 'final', kind: 'salary', kindLabel: 'Зарплата', amount: 3_500,
        date: '2026-08-05', salaryYm: '2026-07', accountName: 'Alif', note: null,
      }],
      periods: [{
        ym: '2026-07', salary: 5_000, previousSalary: 5_000, salaryDelta: 0,
        advance: 1_500, finalPayment: 3_500, bonus: 0, bonusPaid: 0, fine: 0,
        accrued: 5_000, paidByOperations: 5_000, totalPaid: 5_000,
        remaining: 0, recordedPaid: 5_000, frozen: true,
      }],
    });

    renderHistory();

    const july = (await screen.findByText('июль 2026', { selector: 'strong' })).closest('article')!;
    expect(within(july).getByText('Установленный оклад')).toBeInTheDocument();
    expect(within(july).getByText('Аванс', { selector: 'small' })).toBeInTheDocument();
    expect(within(july).getByText('Окончательная выплата')).toBeInTheDocument();
    expect(within(july).getByText('Всего выплат зафиксировано')).toBeInTheDocument();
    expect(within(july).getByText('Задолженности нет')).toBeInTheDocument();
    expect(within(july).getAllByText('5 000 с.')).toHaveLength(2);
    expect(within(july).getAllByText('1 500 с.')).toHaveLength(2);
    expect(within(july).getAllByText('3 500 с.')).toHaveLength(2);
    expect(screen.queryByText('Повышение оклада')).not.toBeInTheDocument();
    expect(screen.queryByText(/Оклад изменён/)).not.toBeInTheDocument();
  });

  it('keeps a future fixed-rate change visible but does not call it current', async () => {
    mocks.employeePayouts.mockResolvedValueOnce({
      currentSalary: 5_000,
      salaryChanges: [
        { effectiveYm: '2999-01', salary: 6_000, previousSalary: 5_000, delta: 1_000, isFuture: true },
        { effectiveYm: '2026-07', salary: 5_000, previousSalary: null, delta: null, isCurrent: true },
      ],
      rows: [],
      periods: [],
    });

    renderHistory();

    expect(await screen.findByText('Запланированное изменение')).toBeInTheDocument();
    expect(screen.getByText('запланирована')).toBeInTheDocument();
    expect(screen.getByText('текущая')).toBeInTheDocument();
    expect(screen.queryByText(/Последняя ставка/)).not.toBeInTheDocument();
  });

  it('labels a Notion monthly total as history instead of an unpaid salary', async () => {
    mocks.employeePayouts.mockResolvedValueOnce({
      currentSalary: 3_000,
      salaryChanges: [
        { effectiveYm: '2026-05', salary: 3_000, previousSalary: null, delta: null, isCurrent: true },
      ],
      rows: [{
        id: 'legacy-month-advance',
        kind: 'advance',
        kindLabel: 'Аванс',
        amount: 500,
        date: '2026-05-20',
        salaryYm: '2026-05',
        accountName: 'Наличные',
        note: null,
      }],
      periods: [{
        ym: '2026-05',
        salary: null,
        advance: 0,
        bonus: 0,
        fine: 0,
        accrued: null,
        paidByOperations: 500,
        recordedPaid: 2_350,
        legacyCrmPaid: 500,
        frozen: false,
        legacySource: 'notion',
      }],
    });

    renderHistory();

    expect(await screen.findByText('история Notion')).toBeInTheDocument();
    const notionMonth = screen.getByText('история Notion').closest('article')!;
    expect(within(notionMonth).getByText('Сумма в старой таблице')).toBeInTheDocument();
    expect(within(notionMonth).getByText('2 350 с.')).toBeInTheDocument();
    expect(within(notionMonth).getByText('Дата, счёт и разбивка на аванс и зарплату не сохранились.')).toBeInTheDocument();
    expect(within(notionMonth).getByText(/В CRM отдельно записано 500 с\./)).toBeInTheDocument();
    expect(within(notionMonth).getByText('Аванс')).toBeInTheDocument();
    expect(within(notionMonth).getByText('Наличные')).toBeInTheDocument();
    expect(within(notionMonth).queryByText('Фиксированная ставка')).not.toBeInTheDocument();
    expect(within(notionMonth).queryByText('Остаток')).not.toBeInTheDocument();
    expect(within(notionMonth).queryByText('Операции по счетам не зафиксированы')).not.toBeInTheDocument();
  });

  it('collapses through the inline panel control', async () => {
    const user = userEvent.setup();
    const onClose = renderHistory();
    await screen.findByText('Изменения фиксированной ставки');

    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
