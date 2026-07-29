import { render, screen } from '@testing-library/react';
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
});
