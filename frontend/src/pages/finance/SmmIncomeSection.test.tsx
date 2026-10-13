import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceIncomeGroupPage from './FinanceIncomeGroupPage';
import { dayMon, dayMonth, dueTone, splitSmmRows } from './smmIncome';

// «Доход → SMM» — таблица «менеджер · срок · оплата» (макет владельца
// 13.10.2026): строки по срочности двумя группами, одна колонка «Оплата»
// вместо двух частей, колонка «Менеджер» и итоги, которые сходятся.

const mocks = vi.hoisted(() => ({
  incomeDirectionDetail: vi.fn(),
  projects: vi.fn(),
  accounts: vi.fn(),
  financeManagers: vi.fn(),
  linkClient: vi.fn(),
  setSmmManager: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: { incomeDirectionDetail: mocks.incomeDirectionDetail, projects: mocks.projects, accounts: mocks.accounts },
  smmPaymentsApi: { financeManagers: mocks.financeManagers, linkClient: mocks.linkClient },
  projectsApi: { setSmmManager: mocks.setSmmManager },
}));
vi.mock('@/store/auth.store', () => ({
  useAuthStore: (sel: any) => sel({ user: { id: 'u1', role: 'founder' } }),
}));

const row = (id: string, name: string, tariff: number, over: Record<string, unknown> = {}) => ({
  project: { id, name, tariff, contractDate: null, archived: false, note: null },
  cycleDate: '2026-10-29', part1: null, part2: null, paidLife: 0, monthPaid: 0, nextDue: null,
  fullyPaid: false, alert: null, due: null, remaining: 0, overdue: 0, receivedParts: [], paidAt: null,
  ...over,
});
const expected = (plannedId: string, amount: number, dueDate: string) => ({
  part1: { plannedId, amount, status: 'expected', txId: null, dueDate },
  nextDue: { plannedId, ym: dueDate.slice(0, 7), amount, dueDate },
  due: { date: dueDate, state: 'wait', planned: true },
  remaining: amount,
});

// Порядок — как отдаёт сервер: по дате цикла, свежая сверху.
const ROWS = [
  row('A', 'Остиум Умрона', 5500, expected('pl1', 5500, '2026-10-29')),
  row('B', 'Комерцбанк', 5500, { alert: 'pay', due: { date: '2026-09-23', state: 'late', planned: false }, remaining: 5500, overdue: 5500 }),
  row('C', 'Американский Маркентплейс', 3500, expected('pl3', 3500, '2026-10-16')),
  row('D', 'Афсона', 3500, {
    fullyPaid: true, monthPaid: 3500, paidLife: 3500, paidAt: '2026-10-06',
    part1: { plannedId: 'pl9', amount: 3500, status: 'received', txId: 't9', dueDate: null },
    receivedParts: [{ plannedId: 'pl9', amount: 3500, partNo: 1, txId: 't9' }],
    nextDue: { plannedId: 'pl10', ym: '2026-11', amount: 3500, dueDate: '2026-11-06' },
    due: { date: '2026-11-06', state: 'wait', planned: true },
  }),
];
const DATA = {
  kind: 'smm', rows: ROWS,
  summary: { expected: 14500, overdue: 5500, receivedCash: 7000, receivedInactive: 3500, receivedTable: 3500, total: 21500 },
  stats: { expected: 9000, receivedCash: 7000, spentOffAccount: 0, total: 16000 },
  totals: { tariff: 18000, part1: 12500, part2: 0, full: 12500 },
  needPay: 1, needRest: 0, archived: [],
};
const MANAGERS = {
  canAssign: true, canLink: true,
  clients: [
    { financeProjectId: 'A', project: { id: 'pA', name: 'Остиум' }, by: 'manual', manager: { id: 'm1', name: 'Зарина', avatar: null } },
    { financeProjectId: 'B', project: { id: 'pB', name: 'Комерцбанк' }, by: 'name', manager: null },
    { financeProjectId: 'C', project: null, by: null, manager: null },
    { financeProjectId: 'D', project: { id: 'pD', name: 'Афсона' }, by: 'name', manager: { id: 'm2', name: 'Фаррух', avatar: null } },
  ],
  managers: [{ id: 'm1', name: 'Зарина', avatar: null }, { id: 'm2', name: 'Фаррух', avatar: null }],
  projects: [{ id: 'pX', name: 'US2TJK', taken: false }, { id: 'pA', name: 'Остиум', taken: true }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance/income/smm?ym=2026-10']}>
        <Routes><Route path="/finance/income/:direction" element={<FinanceIncomeGroupPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const phone = (on: boolean) => {
  (window as any).matchMedia = on
    ? () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })
    : undefined;
};

describe('«Доход → SMM»: менеджер, срок и оплата', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T09:00:00'));
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.incomeDirectionDetail.mockResolvedValue(DATA);
    mocks.projects.mockResolvedValue([]);
    mocks.accounts.mockResolvedValue([]);
    mocks.financeManagers.mockResolvedValue(MANAGERS);
    mocks.setSmmManager.mockResolvedValue({ ok: true });
    mocks.linkClient.mockResolvedValue(MANAGERS);
    phone(false);
  });
  afterEach(() => { vi.useRealTimers(); phone(false); });

  it('строки идут по срочности двумя группами, лишних колонок нет', async () => {
    renderPage();
    expect(await screen.findByText('Ждём оплату · 3')).toBeInTheDocument();
    expect(screen.getByText('Оплачено · 1')).toBeInTheDocument();

    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Проект', 'Менеджер', 'Тариф', 'Срок', 'Оплата', '']);

    const names = screen.getAllByRole('row').map((r) => r.querySelector('td b')?.textContent).filter(Boolean);
    // просроченный, затем ближайший срок, затем дальний; оплаченные — в конце
    expect(names.slice(0, 4)).toEqual(['Комерцбанк', 'Американский Маркентплейс', 'Остиум Умрона', 'Афсона']);
  });

  it('просрочка названа в строке и в сводке; кнопка — действие, а не статус', async () => {
    renderPage();
    expect(await screen.findByText('Просрочена оплата: Комерцбанк')).toBeInTheDocument();
    expect(screen.getByText(/20 дней · 5 500 с\./)).toBeInTheDocument();
    expect(screen.getByText('23 сентября')).toBeInTheDocument();
    expect(screen.getByText('просрочено 20 дн.')).toBeInTheDocument();
    expect(screen.getByText('через 3 дн.')).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: 'Отметить оплату' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Получено' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Экспорт CSV' })).toBeInTheDocument();
  });

  it('итоги сходятся с таблицей', async () => {
    renderPage();
    await screen.findByText('Ждём оплату · 3');
    expect(screen.getByText('14 500 с.')).toBeInTheDocument();          // «Ожидается» — с просроченным
    expect(screen.getByText('из них просрочено 5 500 с.')).toBeInTheDocument();
    expect(screen.getByText(/в таблице 3 500 с\. · ещё 3 500 с\. от проекта на паузе или в архиве/)).toBeInTheDocument();
    expect(screen.getByText('Итого · 4 проекта')).toBeInTheDocument();
    expect(screen.getByText('получено 3 500 с.')).toBeInTheDocument();
    expect(screen.getByText('осталось 14 500 с.')).toBeInTheDocument();
    // оплаченная строка: когда оплачено и когда следующий срок
    expect(screen.getByText('6 октября')).toBeInTheDocument();
    expect(screen.getByText('след. 6 ноября')).toBeInTheDocument();
  });

  it('менеджер виден в строке и назначается прямо из таблицы', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Зарина')).toBeInTheDocument();
    expect(screen.getByText('Фаррух')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Назначить' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Менеджеры по продажам')).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /Фаррух/ }));
    await waitFor(() => expect(mocks.setSmmManager).toHaveBeenCalledWith('pB', 'm2'));
  });

  it('клиента, которого нет в CRM, связывают с проектом здесь же', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'нет в CRM — связать' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('SMM-проекты в CRM')).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'US2TJK' }));
    await waitFor(() => expect(mocks.linkClient).toHaveBeenCalledWith('C', 'pX'));
  });

  it('на телефоне — карточки вместо таблицы', async () => {
    phone(true);
    renderPage();
    expect(await screen.findByText('Ждём оплату · 3')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Отметить оплату' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Экспорт CSV' })).toHaveTextContent('CSV');
    expect(screen.getByText('6 окт')).toBeInTheDocument();
    expect(screen.getByText('след. 6 ноя')).toBeInTheDocument();
    expect(screen.getByText('Итого · 4 проекта')).toBeInTheDocument();
  });
});

describe('smmIncome — порядок, тон срока и даты', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T09:00:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('без срока — в конце «Ждём оплату», одинаковый срок — по названию', () => {
    const r = (name: string, due: any, fullyPaid = false) => ({ project: { name }, due, fullyPaid });
    const { unpaid, paid } = splitSmmRows([
      r('Paradise Hall', { date: '2026-10-25', state: 'wait', planned: true }),
      r('Без срока', null),
      r('Chrono', { date: '2026-10-25', state: 'wait', planned: true }),
      r('Сегодня', { date: '2026-10-13', state: 'today', planned: true }),
      r('Давно', { date: '2026-08-01', state: 'late', planned: false }),
      r('Недавно', { date: '2026-10-10', state: 'late', planned: true }),
      r('Оплачен', { date: '2026-11-02', state: 'wait', planned: true }, true),
    ]);
    expect(unpaid.map((x) => x.project.name)).toEqual(['Давно', 'Недавно', 'Сегодня', 'Chrono', 'Paradise Hall', 'Без срока']);
    expect(paid.map((x) => x.project.name)).toEqual(['Оплачен']);
  });

  it('тон срока: просрочено, скоро (до трёх дней) и спокойно', () => {
    expect(dueTone({ date: '2026-09-23', state: 'late', planned: false })).toBe('late');
    expect(dueTone({ date: '2026-10-13', state: 'today', planned: true })).toBe('soon');
    expect(dueTone({ date: '2026-10-16', state: 'wait', planned: true })).toBe('soon');
    expect(dueTone({ date: '2026-10-17', state: 'wait', planned: true })).toBe('wait');
    expect(dueTone(null)).toBeNull();
  });

  it('даты без года', () => {
    expect(dayMonth('2026-09-23')).toBe('23 сентября');
    expect(dayMon('2026-11-06')).toBe('6 ноя');
    expect(dayMon('2026-05-01')).toBe('1 мая');
    expect(dayMonth(null)).toBe('—');
  });
});
