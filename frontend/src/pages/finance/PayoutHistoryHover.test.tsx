import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PayoutHistoryHover from './PayoutHistoryHover';

const mocks = vi.hoisted(() => ({
  employeePayouts: vi.fn(),
}));

vi.mock('@/services/api.service', () => ({
  financeApi: {
    employeePayouts: mocks.employeePayouts,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function renderHover() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PayoutHistoryHover employeeId="emp-1" name="Бехруз Миров">
        <b>Бехруз Миров</b>
      </PayoutHistoryHover>
    </QueryClientProvider>,
  );
}

describe('PayoutHistoryHover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.employeePayouts.mockReset();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 700, right: 600, bottom: 740, left: 220, width: 380, height: 40,
      x: 220, y: 700, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prefetches data before showing and keeps upper edge anchored without transform jump', async () => {
    const request = deferred<any>();
    mocks.employeePayouts.mockReturnValue(request.promise);
    renderHover();

    fireEvent.mouseEnter(screen.getByText('Бехруз Миров'));
    expect(mocks.employeePayouts).toHaveBeenCalledWith('emp-1', 3);

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.querySelector('.fin-payout-pop')).not.toBeInTheDocument();

    request.resolve({
      rows: [],
      periods: [{ ym: '2026-06', salary: 5000, advance: 1000, bonus: 0, fine: 0, accrued: 5000, frozen: true }],
      totals: { salary: 5000, advance: 1000, bonus: 0, fine: 0, accrued: 5000 },
    });
    await act(async () => { await Promise.resolve(); });

    const popover = document.querySelector('.fin-payout-pop') as HTMLElement;
    expect(popover).toBeInTheDocument();
    expect(popover.style.bottom).toBe('208px');
    expect(popover.style.top).toBe('');
    expect(popover.style.transform).toBe('');
    expect(screen.getByText('июнь 2026')).toBeInTheDocument();
  });

  it('does not open after the pointer leaves during prefetch', async () => {
    const request = deferred<any>();
    mocks.employeePayouts.mockReturnValue(request.promise);
    renderHover();

    const anchor = screen.getByText('Бехруз Миров');
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseLeave(anchor);
    request.resolve({ rows: [], periods: [], totals: { salary: 0, advance: 0, bonus: 0, accrued: 0 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
      await Promise.resolve();
    });

    expect(document.querySelector('.fin-payout-pop')).not.toBeInTheDocument();
  });
});
