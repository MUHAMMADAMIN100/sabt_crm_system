import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinModal } from './FinKit';

describe('FinModal stability', () => {
  afterEach(() => {
    document.querySelector('main')?.remove();
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('compensates the removed main scrollbar and restores layout on close', () => {
    const main = document.createElement('main');
    main.style.paddingRight = '10px';
    Object.defineProperty(main, 'offsetWidth', { configurable: true, value: 1000 });
    Object.defineProperty(main, 'clientWidth', { configurable: true, value: 985 });
    document.body.appendChild(main);

    const { unmount } = render(
      <FinModal title="Проверка" onClose={() => undefined}>
        <div>Содержимое</div>
      </FinModal>,
    );

    expect(screen.getByRole('dialog', { name: 'Проверка' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.paddingRight).toBe('25px');

    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(main.style.paddingRight).toBe('10px');
  });

  it('traps focus and restores it to the opener', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Открыть</button>
        {open && (
          <FinModal title="Форма" onClose={() => setOpen(false)}>
            <button autoFocus>Первый</button>
            <button>Последний</button>
          </FinModal>
        )}
      </>;
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByRole('button', { name: 'Первый' });
    const last = screen.getByRole('button', { name: 'Последний' });
    const close = screen.getByRole('button', { name: 'Закрыть' });
    expect(first).toHaveFocus();

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Форма' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Escape closes only the top modal in a stack', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    function Stack() {
      const [inner, setInner] = useState(false);
      return (
        <FinModal title="Внешняя" onClose={outerClose}>
          <button onClick={() => setInner(true)}>Открыть подтверждение</button>
          {inner && (
            <FinModal title="Внутренняя" onClose={() => {
              innerClose();
              setInner(false);
            }}>
              Подтверждение
            </FinModal>
          )}
        </FinModal>
      );
    }

    render(<Stack />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подтверждение' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
  });
});
