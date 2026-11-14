import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinancePlanningPage from './FinancePlanningPage';

const api = vi.hoisted(() => ({
  plannedPayments: vi.fn(), projects: vi.fn(), installmentsCalendar: vi.fn(), debts: vi.fn(),
  incomeDirectionDetail: vi.fn(), subscriptions: vi.fn(), expenseDetail: vi.fn(), transactions: vi.fn(),
  accounts: vi.fn(), receivePlanned: vi.fn(), unreceivePlanned: vi.fn(), markSubPaid: vi.fn(),
  unmarkSubPaid: vi.fn(), updatePlanned: vi.fn(), updateSubscription: vi.fn(), updateTransaction: vi.fn(),
  setInstallmentDue: vi.fn(), categories: vi.fn(), employees: vi.fn(),
}));
vi.mock('@/services/api.service', () => ({ financeApi: api }));

const NOW = new Date('2026-11-14T09:00:00');

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance/planning?ym=2026-11']}><FinancePlanningPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const cellOf = (day: number) => {
  const cell = [...document.querySelectorAll('.pln-cell')].find((c) => c.querySelector('.pln-dayhead .n')?.textContent === String(day));
  if (!cell) throw new Error(`нет клетки ${day}`);
  return cell as HTMLElement;
};
const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ');

describe('FinancePlanningPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) as any;
    Object.values(api).forEach((f) => f.mockReset());
    api.projects.mockResolvedValue([
      { id: 'p-dev', name: 'Сайт', direction: 'development', tariff: 30000, status: 'active', contractDate: '2026-10-01' },
      { id: 'p-smm', name: 'Chrono', direction: 'smm', tariff: 5000, status: 'active', contractDate: '2026-06-18' },
    ]);
    api.plannedPayments.mockResolvedValue([
      { id: 'late', projectId: 'p-dev', ym: '2026-11', dueDate: '2026-11-03', status: 'expected', amount: 10000 },
      { id: 'got', projectId: 'p-dev', ym: '2026-11', dueDate: '2026-11-02', status: 'received', amount: 4000, receivedTxId: 't-got' },
    ]);
    api.transactions.mockResolvedValue({ items: [
      { id: 't-got', type: 'income', projectId: 'p-dev', date: '2026-11-06', amount: 4000, status: 'completed' },
    ], total: 1 });
    api.subscriptions.mockResolvedValue([{ id: 's1', name: 'Аренда офиса', kind: 'rent', amount: 6000, active: true, dueDay: 25 }]);
    api.expenseDetail.mockResolvedValue({ cards: { toPay: 12000, fund: 30000, paid: 18000 }, rows: [{}, {}] });
    api.installmentsCalendar.mockResolvedValue([]);
    api.debts.mockResolvedValue([]);
    api.incomeDirectionDetail.mockResolvedValue({ rows: [] });
    api.accounts.mockResolvedValue([{ id: 'acc-alif', name: 'Алиф', archived: false }, { id: 'acc-old', name: 'Старый', archived: true }]);
    api.receivePlanned.mockResolvedValue({});
    api.unreceivePlanned.mockResolvedValue({});
    api.markSubPaid.mockResolvedValue({});
    api.updatePlanned.mockResolvedValue({});
  });
  afterEach(() => { vi.useRealTimers(); });

  it('собирает месяц: оплаты, прогноз SMM, аренду и остаток зарплаты за октябрь', async () => {
    renderPage();
    const inc = await screen.findByRole('region', { name: 'Придёт' });
    // 10 000 (просрочено) + 4 000 (пришло 6-го) + 5 000 (прогноз Chrono на 18-е).
    expect(norm(inc.textContent)).toContain('+19 000 с.');
    expect(norm(inc.textContent)).toContain('уже пришло 4 000');
    // Аренда 6 000 + зарплата 12 000.
    expect(norm(screen.getByRole('region', { name: 'Уйдёт' }).textContent)).toContain('−18 000 с.');
    expect(within(cellOf(6)).getByText('Сайт')).toBeInTheDocument();
    expect(within(cellOf(18)).getByText('Chrono')).toBeInTheDocument();
    expect(within(cellOf(14)).getByText(/Зарплаты за окт/)).toBeInTheDocument();
    // Зарплата за прошлый месяц — ведомость октября.
    expect(api.expenseDetail).toHaveBeenCalledWith('salary', '2026-10');
    expect(api.transactions).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-30', status: 'all', pageSize: 1000 });
  });

  it('«Отметить полученной»: активный счёт и сегодняшняя дата для просроченного', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Придёт' });
    fireEvent.click(within(cellOf(3)).getByText('Сайт'));
    const dialog = screen.getByRole('dialog', { name: 'Операция' });
    await waitFor(() => expect((within(dialog).getByLabelText('На счёт') as HTMLSelectElement).value).toBe('acc-alif'));
    expect(within(dialog).queryByRole('option', { name: 'Старый' })).not.toBeInTheDocument();
    expect((within(dialog).getByLabelText('Когда пришли деньги') as HTMLInputElement).value).toBe('2026-11-14');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Отметить полученной' })); });
    expect(api.receivePlanned).toHaveBeenCalledWith('late', { accountId: 'acc-alif', date: '2026-11-14' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Операция' })).not.toBeInTheDocument());
  });

  it('«Вернуть в план» у полученной оплаты', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Придёт' });
    fireEvent.click(within(cellOf(6)).getByText('Сайт'));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Операция' })).getByRole('button', { name: 'Вернуть в план' })); });
    expect(api.unreceivePlanned).toHaveBeenCalledWith('got');
  });

  it('аренда: «Отметить оплаченной» за месяц календаря', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Придёт' });
    fireEvent.click(within(cellOf(25)).getByText('Аренда офиса'));
    const dialog = screen.getByRole('dialog', { name: 'Операция' });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Отметить оплаченной' })); });
    expect(api.markSubPaid).toHaveBeenCalledWith('s1', { ym: '2026-11', date: '2026-11-25' });
  });

  it('прогноз SMM и зарплата ведут туда, где их отмечают', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Придёт' });
    fireEvent.click(within(cellOf(18)).getByText('Chrono'));
    expect(within(screen.getByRole('dialog', { name: 'Операция' })).getByRole('link', { name: 'Открыть SMM' }))
      .toHaveAttribute('href', '/finance/income/smm?ym=2026-11');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Операция' })).getAllByRole('button', { name: 'Закрыть' })[0]);

    fireEvent.click(within(cellOf(14)).getByText(/Зарплаты за окт/));
    expect(within(screen.getByRole('dialog', { name: 'Операция' })).getByRole('link', { name: 'Открыть зарплату' }))
      .toHaveAttribute('href', '/finance/expense/salary?ym=2026-10');
  });

  it('перенос плановой оплаты сохраняет новый срок', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Придёт' });
    const row = within(cellOf(3)).getByText('Сайт').closest('.pln-row') as HTMLElement;
    const dt = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireEvent.dragOver(cellOf(21), { dataTransfer: dt });
    await act(async () => { fireEvent.drop(cellOf(21), { dataTransfer: dt }); });
    expect(api.updatePlanned).toHaveBeenCalledWith('late', { dueDate: '2026-11-21' });
    // Полученную и прогноз двигать нельзя.
    expect(within(cellOf(6)).getByText('Сайт').closest('.pln-row')).toHaveAttribute('draggable', 'false');
    expect(within(cellOf(18)).getByText('Chrono').closest('.pln-row')).toHaveAttribute('draggable', 'false');
  });

  it('ошибка загрузки — «Повторить»', async () => {
    api.subscriptions.mockRejectedValue(new Error('сбой'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
