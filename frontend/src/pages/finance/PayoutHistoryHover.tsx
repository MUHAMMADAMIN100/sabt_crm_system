// История выплат сотруднику: при наведении — последние 3 месяца,
// по ненавязчивой ссылке — полная история в модальном окне.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, formatDate, monthLabel } from './finlib';
import FinIcon from './FinIcon';

const HOVER_DELAY = 400;
const CLOSE_DELAY = 120;
const PIN_DELAY = 5_500;
const POP_WIDTH = 380;

const KIND_CLASS: Record<string, string> = {
  advance: 'adv',
  bonus: 'bon',
  salary: 'sal',
};

function HistoryRows({ rows, isLoading, emptyText }: {
  rows: any[]; isLoading: boolean; emptyText: string;
}) {
  if (isLoading) return <div className="fin-brk-empty">Загрузка…</div>;
  if (rows.length === 0) return <div className="fin-brk-empty">{emptyText}</div>;
  return <>
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
  </>;
}

function Totals({ totals }: { totals?: any }) {
  if (!totals) return null;
  return (
    <div className="fin-payout-totals">
      <span>Оклад: <b>{money(totals.salary)}</b></span>
      <span>Авансы: <b>{money(totals.advance)}</b></span>
      <span>Бонусы: <b>{money(totals.bonus)}</b></span>
      {(Number(totals.fine) || 0) > 0 && <span>Штрафы: <b>{money(totals.fine)}</b></span>}
    </div>
  );
}

function PayrollPeriods({ periods }: { periods: any[] }) {
  if (!periods.length) return null;
  return (
    <div className="fin-payout-periods">
      {periods.map(period => (
        <div className="fin-payout-period" key={period.ym}>
          <div>
            <strong>{monthLabel(period.ym, true)}</strong>
            <span>{period.frozen ? 'месяц закрыт' : 'текущий расчёт'}</span>
          </div>
          <b>{money(period.accrued)}</b>
          <small>
            оклад {money(period.salary)}
            {(Number(period.advance) || 0) > 0 ? ` · аванс ${money(period.advance)}` : ''}
            {(Number(period.bonus) || 0) > 0 ? ` · бонус ${money(period.bonus)}` : ''}
            {(Number(period.fine) || 0) > 0 ? ` · штраф ${money(period.fine)}` : ''}
          </small>
        </div>
      ))}
    </div>
  );
}

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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const previewQ = useQuery({
    queryKey: ['fin-payouts', employeeId, 3],
    queryFn: () => financeApi.employeePayouts(employeeId, 3),
    enabled: open,
    staleTime: 30_000,
  });
  const fullQ = useQuery({
    queryKey: ['fin-payouts', employeeId, 'all'],
    queryFn: () => financeApi.employeePayouts(employeeId, 1200),
    enabled: fullOpen,
    staleTime: 30_000,
  });

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  useEffect(() => {
    if (!open || pinned) return;
    pinTimer.current = setTimeout(() => setPinned(true), PIN_DELAY);
    return () => {
      if (pinTimer.current) clearTimeout(pinTimer.current);
    };
  }, [open, pinned]);

  const enter = () => {
    cancelClose();
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
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  const closePreview = () => {
    setPinned(false);
    setOpen(false);
  };
  const showFull = () => {
    closePreview();
    setFullOpen(true);
  };

  const rows: any[] = previewQ.data?.rows ?? [];
  const periods: any[] = previewQ.data?.periods ?? [];
  const totals = previewQ.data?.totals;
  const fullRows: any[] = fullQ.data?.rows ?? [];
  const fullPeriods: any[] = fullQ.data?.periods ?? [];
  const fullTotals = fullQ.data?.totals;

  return (
    <span ref={ref} className={className} onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {open && pos && createPortal(
        <div
          className="fin-brk-pop fin-payout-pop"
          onMouseEnter={cancelClose}
          onMouseLeave={leave}
          style={{ top: pos.top, left: pos.left, width: POP_WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <div className="fin-brk-pop-head">
            <span className="ttl">{name} — последние 3 месяца</span>
            {totals && <span className="sum" title="Начислено за показанные месяцы">{money(totals.accrued ?? totals.all)}</span>}
            {pinned && (
              <button className="fin-payout-close" type="button" aria-label="Закрыть историю" onClick={closePreview}>
                <FinIcon name="close" size={14} />
              </button>
            )}
          </div>
          <Totals totals={totals} />
          <PayrollPeriods periods={periods} />
          <div className="fin-brk-pop-body">
            {rows.length > 0 && <div className="fin-payout-section-label">Операции по счетам</div>}
            <HistoryRows rows={rows} isLoading={previewQ.isLoading} emptyText="За последние 3 месяца выплат не было" />
          </div>
          <button className="fin-payout-more" type="button" onClick={showFull}>
            Показать всю историю
          </button>
          <div className={'fin-payout-pin-hint' + (pinned ? ' pinned' : '')}>
            {pinned ? 'Окно закреплено — можно прокручивать' : 'Задержите курсор, чтобы закрепить окно'}
          </div>
        </div>,
        document.body,
      )}
      {fullOpen && createPortal(
        <div className="overlay" onClick={() => setFullOpen(false)}>
          <div className="modal fin-payout-modal" role="dialog" aria-modal="true" aria-label={`История выплат — ${name}`} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>История выплат — {name}</h3>
              <button className="btn ghost sm" aria-label="Закрыть" onClick={() => setFullOpen(false)}>
                <FinIcon name="close" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <Totals totals={fullTotals} />
              <PayrollPeriods periods={fullPeriods} />
              <div className="fin-payout-full-list">
                {fullRows.length > 0 && <div className="fin-payout-section-label">Операции по счетам</div>}
                <HistoryRows rows={fullRows} isLoading={fullQ.isLoading} emptyText="История выплат пока пуста" />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
