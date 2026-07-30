// Общие UI-примитивы раздела «Финансы»: состояния загрузки/ошибки,
// модальная обвязка (Escape, возврат фокуса, aria), промисный finConfirm
// вместо системного confirm() и хелперы инвалидации react-query.
import { ReactNode, useEffect, useId, useRef, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import type { QueryClient } from '@tanstack/react-query';

// Ключи запросов: ['finance', …] — журнал и расчёты (зависят от денег),
// ['finref', …] — справочники (счета/категории/проекты/сотрудники/подписки/активы).
// Денежные операции не трогают справочники — их рефетч был лишним при каждой
// инлайн-правке журнала.
/** После денежной операции: журнал, обзоры, детализации. */
export function invalidateFinance(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['finance'] });
  qc.invalidateQueries({ queryKey: ['fin-payouts'] });
}
/** После правки справочника: и справочники, и зависящие от них расчёты. */
export function invalidateFinanceAll(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['finance'] });
  qc.invalidateQueries({ queryKey: ['finref'] });
  qc.invalidateQueries({ queryKey: ['fin-payouts'] });
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
let bodyPrevOverflow = '';
let mainPrevOverflow = '';
let mainPrevPaddingRight = '';
const modalStack: symbol[] = [];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableInside(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}
function lockBodyScroll() {
  if (++scrollLocks > 1) return;
  bodyPrevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const main = document.querySelector('main');
  if (main) {
    const el = main as HTMLElement;
    mainPrevOverflow = el.style.overflow;
    mainPrevPaddingRight = el.style.paddingRight;
    // Компенсируем исчезнувший вертикальный scrollbar: иначе при открытии
    // обычной модалки вся страница смещается на его ширину.
    const scrollbarWidth = Math.max(0, el.offsetWidth - el.clientWidth);
    if (scrollbarWidth > 0) {
      const currentPadding = parseFloat(getComputedStyle(el).paddingRight) || 0;
      el.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    el.style.overflow = 'hidden';
  }
}
function unlockBodyScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks > 0) return;
  document.body.style.overflow = bodyPrevOverflow;
  const main = document.querySelector('main');
  if (main) {
    const el = main as HTMLElement;
    el.style.overflow = mainPrevOverflow;
    el.style.paddingRight = mainPrevPaddingRight;
  }
}

/** Escape закрывает только верхнюю модалку; фокус удерживается внутри неё и
 *  возвращается туда, откуда окно открыли. Фон под модалкой не прокручивается. */
export function useModalKeys(onClose?: () => void, dialogRef?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  const tokenRef = useRef(Symbol('finance-modal'));
  // React применяет autoFocus во время commit, до useEffect. Сохраняем
  // источник открытия уже при первом render, иначе запомним кнопку внутри
  // окна и после закрытия фокус уйдёт в body.
  const openerRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );
  closeRef.current = onClose;
  useEffect(() => {
    const opener = openerRef.current;
    const token = tokenRef.current;
    modalStack.push(token);
    lockBodyScroll();

    const dialog = dialogRef?.current;
    if (dialog) {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) {
        const body = dialog.querySelector<HTMLElement>('.modal-body');
        const preferred = dialog.querySelector<HTMLElement>('[autofocus]')
          || (body ? focusableInside(body)[0] : undefined)
          || focusableInside(dialog)[0]
          || dialog;
        preferred.focus();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef?.current) return;
      const focusable = focusableInside(dialogRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const stackIndex = modalStack.lastIndexOf(token);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      unlockBodyScroll();
      if (opener?.isConnected) opener.focus?.();
    };
  }, []);
}

/** Стандартная модалка раздела: overlay + head/body/foot, Escape, aria. */
export function FinModal({ title, onClose, children, footer, width }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalKeys(onClose, dialogRef);
  return (
    <div className="overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal" style={width ? { maxWidth: width } : undefined}
        role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => { okRef.current?.focus(); }, []);
  useModalKeys(() => onDone(false), dialogRef);
  return (
    <div className="fin-overlay" onClick={() => onDone(false)}>
      <div className="fin-root" style={{ width: '100%', maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div ref={dialogRef} className="modal" role="alertdialog" aria-modal="true"
          aria-labelledby={titleId} tabIndex={-1}>
          <div className="modal-head"><h3 id={titleId}>{opts?.title || 'Подтверждение'}</h3></div>
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
