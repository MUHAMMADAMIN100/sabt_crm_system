// История выплат сотруднику при наведении на его имя в зарплатной ведомости:
// что выдали (аванс / бонус / зарплата), когда, сколько и с какого счёта.
// Данные тянутся лениво — только когда курсор задержался на имени.
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, formatDate, monthLabel } from './finlib';

const HOVER_DELAY = 400; // мс — чтобы карточка не мелькала при проходе мышью
const POP_WIDTH = 380;

/** Цвет метки по типу выплаты. Красный не используем — это не ошибка. */
const KIND_CLASS: Record<string, string> = {
  advance: 'adv',
  bonus: 'bon',
  salary: 'sal',
};

export default function PayoutHistoryHover({
  employeeId, name, children, className,
}: {
  employeeId: string;
  name: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fin-payouts', employeeId],
    queryFn: () => financeApi.employeePayouts(employeeId, 12),
    enabled: open,
    staleTime: 30_000,
  });

  const enter = () => {
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) {
        const above = r.bottom > window.innerHeight * 0.55;
        const left = Math.min(r.left, window.innerWidth - POP_WIDTH - 8);
        setPos({ top: above ? r.top - 8 : r.bottom + 8, left: Math.max(8, left), above });
      }
      setOpen(true);
    }, HOVER_DELAY);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  const rows: any[] = data?.rows ?? [];
  const totals = data?.totals;

  return (
    <span ref={ref} className={className} onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {open && pos && createPortal(
        <div
          className="fin-brk-pop fin-payout-pop"
          style={{ top: pos.top, left: pos.left, width: POP_WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <div className="fin-brk-pop-head">
            <span className="ttl">{name} — история выплат</span>
            {totals && <span className="sum">{money(totals.all)}</span>}
          </div>
          {totals && (
            <div className="fin-payout-totals">
              <span>Авансы: <b>{money(totals.advance)}</b></span>
              <span>Бонусы: <b>{money(totals.bonus)}</b></span>
              <span>Зарплата: <b>{money(totals.salary)}</b></span>
            </div>
          )}
          <div className="fin-brk-pop-body">
            {isLoading && <div className="fin-brk-empty">Загрузка…</div>}
            {!isLoading && rows.length === 0 && (
              <div className="fin-brk-empty">Выплат за последний год не было</div>
            )}
            {rows.map(r => (
              <div className="fin-payout-row" key={r.id}>
                <span className={`kind ${KIND_CLASS[r.kind] || ''}`}>{r.kindLabel}</span>
                <span className="date">{formatDate(r.date)}</span>
                <span className="amt">{money(r.amount)}</span>
                <span className="acc">{r.accountName || '—'}</span>
                <span className="ym">за {monthLabel(r.salaryYm)}</span>
                {r.note && <span className="note" title={r.note}>{r.note}</span>}
              </div>
            ))}
          </div>
          <div className="fin-payout-foot">За последние 12 месяцев начисления</div>
        </div>,
        document.body,
      )}
    </span>
  );
}
