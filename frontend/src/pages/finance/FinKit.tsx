// Общие UI-примитивы раздела «Финансы»: состояния загрузки/ошибки,
// модальная обвязка (Escape, возврат фокуса, aria), промисный finConfirm
// вместо системного confirm() и хелперы инвалидации react-query.
import { ReactNode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { QueryClient } from '@tanstack/react-query';

// Ключи запросов: ['finance', …] — журнал и расчёты (зависят от денег),
// ['finref', …] — справочники (счета/категории/проекты/сотрудники/подписки/активы).
// Денежные операции не трогают справочники — их рефетч был лишним при каждой
// инлайн-правке журнала.
/** После денежной операции: журнал, обзоры, детализации. */
export function invalidateFinance(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['finance'] });
}
/** После правки справочника: и справочники, и зависящие от них расчёты. */
export function invalidateFinanceAll(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['finance'] });
  qc.invalidateQueries({ queryKey: ['finref'] });
}

/** Скелетон: карточки-заглушки на время первой загрузки страницы. */
export function FinLoading({ cards = 3 }: { cards?: number }) {
  return (
    <div className="cards fin-skel-grid" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: cards }, (_, i) => (
        <div className="card" key={i}>
          <div className="fin-skel" style={{ width: '45%' }} />
          <div className="fin-skel lg" style={{ width: '70%' }} />
          <div className="fin-skel" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  );
}

/** Плашка ошибки загрузки с повтором — вместо молчаливых нулей. */
export function FinLoadError({ onRetry, text }: { onRetry: () => void; text?: string }) {
  return (
    <div className="card fin-load-error" role="alert">
      <div>
        <b>Не удалось загрузить данные</b>
        <div className="mini muted">{text || 'Проверьте соединение и попробуйте ещё раз.'}</div>
      </div>
      <button className="btn" onClick={onRetry}>Повторить</button>
    </div>
  );
}

// Блокировка прокрутки фона под модалкой. Счётчик — из-за вложенных модалок
// (конфирм поверх формы): фон разблокируется, только когда закрыта последняя.
// ВАЖНО: страница приложения скроллится НЕ через body, а внутри <main>
// лэйаута (h-screen overflow-hidden + main.overflow-y-auto) — лочим оба.
// Модалки календаря фиксируют фон, потому что рендерятся порталом в body;
// финансовые живут внутри main, поэтому без лока main фон продолжал ехать.
let scrollLocks = 0;
let mainPrevOverflow = '';
function lockBodyScroll() {
  if (++scrollLocks > 1) return;
  document.body.style.overflow = 'hidden';
  const main = document.querySelector('main');
  if (main) {
    mainPrevOverflow = (main as HTMLElement).style.overflow;
    (main as HTMLElement).style.overflow = 'hidden';
  }
}
function unlockBodyScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks > 0) return;
  document.body.style.overflow = '';
  const main = document.querySelector('main');
  if (main) (main as HTMLElement).style.overflow = mainPrevOverflow;
}

/** Escape закрывает модалку; фокус возвращается туда, откуда её открыли;
 *  фон под модалкой не прокручивается. */
export function useModalKeys(onClose?: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockBodyScroll();
      opener?.focus?.();
    };
  }, []);
}

/** Стандартная модалка раздела: overlay + head/body/foot, Escape, aria. */
export function FinModal({ title, onClose, children, footer, width }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useModalKeys(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}
        role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Промисный конфирм в стиле раздела: `if (!(await finConfirm('…'))) return;`
 *  danger красит кнопку в красный (удаления/отмены). */
export function finConfirm(message: string, opts?: {
  title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const opener = document.activeElement as HTMLElement | null;
    const done = (ok: boolean) => {
      root.unmount();
      host.remove();
      opener?.focus?.();
      resolve(ok);
    };
    root.render(<ConfirmDialog message={message} opts={opts} onDone={done} />);
  });
}

function ConfirmDialog({ message, opts, onDone }: {
  message: string;
  opts?: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
  onDone: (ok: boolean) => void;
}) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { okRef.current?.focus(); }, []);
  useEffect(() => {
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onDone(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockBodyScroll();
    };
  }, [onDone]);
  return (
    <div className="fin-overlay" onClick={() => onDone(false)}>
      <div className="fin-root" style={{ width: '100%', maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal" role="alertdialog" aria-modal="true" aria-label={opts?.title || 'Подтверждение'}>
          <div className="modal-head"><h3>{opts?.title || 'Подтверждение'}</h3></div>
          <div className="modal-body"><p style={{ margin: 0 }}>{message}</p></div>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => onDone(false)}>{opts?.cancelLabel || 'Отмена'}</button>
            <button ref={okRef} className={'btn ' + (opts?.danger ? 'danger' : 'primary')} onClick={() => onDone(true)}>
              {opts?.confirmLabel || 'Подтвердить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
