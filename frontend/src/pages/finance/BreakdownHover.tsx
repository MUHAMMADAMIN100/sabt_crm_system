// Мини-окно при наведении на категорию/статью/направление: через короткую
// задержку показывает разбивку по под-типам (для ЗП — аванс/бонус/зарплата,
// для остальных — по описанию). Данные тянутся лениво (только при наведении).
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money } from './finlib';
import { CatIcon } from './FinIcon';

const HOVER_DELAY = 450; // мс — «через несколько секунд», но не раздражающе долго

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
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fin-breakdown', ym, kind, id ?? 'none', txType ?? ''],
    queryFn: () => financeApi.breakdown({ ym, kind, id: id ?? 'none', txType }),
    enabled: open,
    staleTime: 60_000,
  });

  const enter = () => {
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) {
        const above = r.bottom > window.innerHeight * 0.6;
        const left = Math.min(r.left, window.innerWidth - 300);
        setPos({ top: above ? r.top - 8 : r.bottom + 8, left: Math.max(8, left), above });
      }
      setOpen(true);
    }, HOVER_DELAY);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  const items: Array<{ label: string; amount: number }> = data?.items ?? [];

  return (
    <div ref={ref} className={className} onMouseEnter={enter} onMouseLeave={leave}
      onClick={() => { leave(); onClick?.(); }}>
      {children}
      {open && pos && createPortal(
        <div
          className="fin-brk-pop"
          style={{ top: pos.top, left: pos.left, transform: pos.above ? 'translateY(-100%)' : undefined }}
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
    </div>
  );
}
