// Мини-окно при наведении на категорию/статью/направление: через короткую
// задержку показывает разбивку по под-типам (для ЗП — аванс/бонус/зарплата,
// для остальных — по описанию). Данные тянутся лениво (только при наведении).
import {
  useCallback, useEffect, useId, useRef, useState,
  type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money } from './finlib';
import { CatIcon } from './FinIcon';
import { floatingPosition, scrollableAncestors, type FloatingPosition } from './floatingPosition';

const HOVER_DELAY = 450; // мс — «через несколько секунд», но не раздражающе долго
const DATA_WAIT_LIMIT = 900;

export default function BreakdownHover({
  ym, kind, id, txType, title, color, icon, className, onClick, children,
}: {
  ym: string;
  kind: 'category' | 'group' | 'direction';
  id?: string | null;
  txType?: 'income' | 'expense';
  title: string;
  color?: string | null;
  icon?: string | null;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const ref = useRef<HTMLButtonElement>(null);
  const hoverSeq = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FloatingPosition | null>(null);
  const queryKey = ['fin-breakdown', ym, kind, id ?? 'none', txType ?? ''] as const;
  const queryFn = () => financeApi.breakdown({ ym, kind, id: id ?? 'none', txType });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn,
    enabled: open,
    staleTime: 60_000,
  });

  const updatePosition = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos(floatingPosition(rect, 264, 280));
  }, []);

  useEffect(() => {
    if (!open) return;
    const ancestors = scrollableAncestors(ref.current);
    window.addEventListener('resize', updatePosition);
    ancestors.forEach((el) => el.addEventListener('scroll', updatePosition, { passive: true }));
    return () => {
      window.removeEventListener('resize', updatePosition);
      ancestors.forEach((el) => el.removeEventListener('scroll', updatePosition));
    };
  }, [open, updatePosition]);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const closeNow = () => {
    cancelClose();
    hoverSeq.current++;
    setOpen(false);
  };
  const enter = () => {
    cancelClose();
    if (open) return;
    const seq = ++hoverSeq.current;
    // Начинаем запрос сразу, но показываем окно только после короткой задержки
    // и готовности данных (либо лимита ожидания). Высота не меняется рывком
    // сразу после появления.
    void Promise.all([
      new Promise(resolve => setTimeout(resolve, HOVER_DELAY)),
      Promise.race([
        qc.fetchQuery({ queryKey, queryFn, staleTime: 60_000 }).catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, DATA_WAIT_LIMIT)),
      ]),
    ]).then(() => {
      if (hoverSeq.current !== seq) return;
      updatePosition();
      setOpen(true);
    });
  };
  const leave = () => {
    if (!open) {
      hoverSeq.current++;
      return;
    }
    closeTimer.current = setTimeout(closeNow, 140);
  };
  useEffect(() => () => cancelClose(), []);

  const activate = (e: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (onClick) {
      closeNow();
      onClick();
    } else if (open) {
      closeNow();
    } else {
      enter();
    }
  };
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    const touchLike = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
    if (onClick || touchLike) activate(e);
  };
  const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeNow();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(e);
    }
  };

  const items: Array<{ label: string; amount: number }> = data?.items ?? [];

  return (
    <button ref={ref} type="button" className={`fin-breakdown-trigger ${className || ''}`}
      aria-label={onClick ? `Открыть «${title}»` : `Показать разбивку «${title}»`}
      aria-expanded={open} aria-describedby={open ? tooltipId : undefined}
      onFocus={enter} onBlur={leave} onKeyDown={keyDown}
      onMouseEnter={enter} onMouseLeave={leave} onClick={click}>
      {children}
      {open && pos && createPortal(
        <div
          id={tooltipId}
          className="fin-brk-pop"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={leave}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fin-brk-pop-head">
            <CatIcon icon={icon} color={color} size={20} />
            <span className="ttl">{title}</span>
            {data && <span className="sum">{money(data.total)}</span>}
          </div>
          <div className="fin-brk-pop-body">
            {isLoading && <div className="fin-brk-empty">Загрузка…</div>}
            {!isLoading && items.length === 0 && <div className="fin-brk-empty">Нет операций за месяц</div>}
            {items.map((it, i) => (
              <div className="fin-brk-pop-row" key={i}>
                <span className="l">{it.label}</span>
                <span className="a">{money(it.amount)}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </button>
  );
}
