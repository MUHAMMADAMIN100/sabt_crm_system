import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlanCalendar from './PlanCalendar';

// Сегодня — 14 ноября 2026 (подменяем только дату, таймеры настоящие).
const NOW = new Date('2026-11-14T09:00:00');

const items = [
  { id: 'tx-in', date: '2026-11-05', amount: 5000, type: 'income', status: 'completed', done: true, comment: 'Chrono' },
  { id: 'pp-wait', date: '2026-11-20', amount: 3000, type: 'income', status: 'completed', done: false, comment: 'Сайт' },
  { id: 'sub-rent', date: '2026-11-05', amount: 2000, type: 'expense', status: 'completed', done: false, comment: 'Аренда' },
  { id: 'inst-n', date: '2026-11-10', amount: 500, type: 'note', status: 'completed', done: false, comment: 'Рассрочка · Фарзона' },
];
const lateOther = [
  { id: 'pp-oct', date: '2026-10-15', amount: 1000, type: 'income', status: 'completed', done: false, comment: 'Комерцбанк' },
];

function setNarrow(narrow: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: narrow, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as any;
}
function renderCal(props: Partial<Parameters<typeof PlanCalendar>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PlanCalendar ym="2026-11" txns={items} lateOther={lateOther} {...props} />
    </MemoryRouter>,
  );
}
const cellOf = (day: number) => {
  const cell = [...document.querySelectorAll('.pln-cell')].find((c) => c.querySelector('.pln-dayhead .n')?.textContent === String(day));
  if (!cell) throw new Error(`нет клетки ${day}`);
  return cell as HTMLElement;
};
const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ');

describe('PlanCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setNarrow(false);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('итоги месяца: придёт и уйдёт, уже прошло, просрочено вместе с прошлыми месяцами', () => {
    renderCal();
    const inc = screen.getByRole('region', { name: 'Придёт' });
    expect(norm(inc.textContent)).toContain('+8 000 с.');
    expect(norm(inc.textContent)).toContain('уже пришло 5 000 · ждём 3 000');
    expect(norm(inc.textContent)).toContain('и ещё 1 000 с. просрочено с прошлых месяцев');

    const exp = screen.getByRole('region', { name: 'Уйдёт' });
    // Пометка «не влияет на деньги» в расход не входит.
    expect(norm(exp.textContent)).toContain('−2 000 с.');
    expect(norm(exp.textContent)).toContain('уже ушло 0 · осталось 2 000');

    const late = screen.getByRole('region', { name: 'Просрочено' });
    expect(norm(late.textContent)).toContain('2 платежа');
    expect(norm(late.textContent)).toContain('ждём 1 000');
    expect(norm(late.textContent)).toContain('должны 2 000');
    // Список — от самого старого.
    const rows = within(late).getAllByRole('button').map((b) => norm(b.textContent));
    expect(rows[0]).toContain('15 окт.: Комерцбанк');
    expect(rows[1]).toContain('5 нояб.: Аренда');
  });

  it('фильтр прячет операции в клетках, но не меняет итоги', () => {
    renderCal();
    expect(within(cellOf(5)).getByText('Аренда')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Приходы' }));
    expect(within(cellOf(5)).queryByText('Аренда')).not.toBeInTheDocument();
    expect(within(cellOf(5)).getByText('Chrono')).toBeInTheDocument();
    expect(norm(screen.getByRole('region', { name: 'Уйдёт' }).textContent)).toContain('−2 000 с.');

    fireEvent.click(screen.getByRole('button', { name: 'Только не сделанное' }));
    expect(within(cellOf(5)).queryByText('Chrono')).not.toBeInTheDocument();
    expect(within(cellOf(5)).getByText('Аренда')).toBeInTheDocument();
    expect(within(cellOf(20)).getByText('Сайт')).toBeInTheDocument();
  });

  it('перетаскивание переносит операцию сразу, при ошибке возвращает назад', async () => {
    let reject!: (e: unknown) => void;
    const onMoveItem = vi.fn(() => new Promise<void>((_, rej) => { reject = rej; }));
    renderCal({ onMoveItem, canMoveItem: (t: any) => t.id === 'pp-wait' });

    const row = within(cellOf(20)).getByText('Сайт').closest('.pln-row') as HTMLElement;
    expect(row).toHaveAttribute('draggable', 'true');
    expect(within(cellOf(5)).getByText('Chrono').closest('.pln-row')).toHaveAttribute('draggable', 'false');

    const dt = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireEvent.dragOver(cellOf(24), { dataTransfer: dt });
    fireEvent.drop(cellOf(24), { dataTransfer: dt });

    expect(onMoveItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'pp-wait' }), '2026-11-24');
    expect(within(cellOf(24)).getByText('Сайт')).toBeInTheDocument();
    expect(within(cellOf(20)).queryByText('Сайт')).not.toBeInTheDocument();

    await act(async () => { reject(new Error('нет сети')); });
    expect(within(cellOf(20)).getByText('Сайт')).toBeInTheDocument();
    expect(within(cellOf(24)).queryByText('Сайт')).not.toBeInTheDocument();
  });

  it('нажатие на операцию открывает карточку со статусом', () => {
    const renderStatusControl = vi.fn(() => <p>статус-контрол</p>);
    renderCal({ renderStatusControl });
    fireEvent.click(within(cellOf(20)).getByText('Сайт'));
    const dialog = screen.getByRole('dialog', { name: 'Операция' });
    expect(within(dialog).getByText('статус-контрол')).toBeInTheDocument();
    expect(renderStatusControl).toHaveBeenCalledWith(expect.objectContaining({ id: 'pp-wait' }), expect.any(Function));
  });

  it('больше трёх операций в дне — «ещё N», раскрывается', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `tx-${i}`, date: '2026-11-12', amount: 1000 + i, type: 'expense', status: 'completed', done: true, comment: `Расход ${i}`,
    }));
    renderCal({ txns: many, lateOther: [] });
    expect(within(cellOf(12)).getAllByRole('button').filter((b) => b.classList.contains('pln-row'))).toHaveLength(3);
    fireEvent.click(within(cellOf(12)).getByRole('button', { name: 'ещё 2' }));
    expect(within(cellOf(12)).getAllByRole('button').filter((b) => b.classList.contains('pln-row'))).toHaveLength(5);
  });

  it('телефон: шторка дня переносит только в пределах месяца', () => {
    setNarrow(true);
    const onMoveItem = vi.fn(() => Promise.resolve());
    renderCal({ onMoveItem, canMoveItem: (t: any) => t.id === 'pp-wait' });

    fireEvent.click(screen.getByRole('button', { name: /^20 ноября, 1 операция/ }));
    const sheet = screen.getByRole('dialog', { name: 'Пятница, 20 ноября' });
    const input = within(sheet).getByLabelText('Перенести на другой день') as HTMLInputElement;
    expect(input.min).toBe('2026-11-01');
    expect(input.max).toBe('2026-11-30');

    fireEvent.change(input, { target: { value: '2026-12-02' } });
    expect(onMoveItem).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '2026-11-27' } });
    expect(onMoveItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'pp-wait' }), '2026-11-27');
  });
});
