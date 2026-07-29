// История выплат сотруднику: при наведении — последние 3 месяца,
// по ненавязчивой ссылке — полная история в модальном окне.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, formatDate, monthLabel } from './finlib';
import FinIcon from './FinIcon';
import { floatingPosition, type FloatingPosition } from './floatingPosition';
import { useModalKeys } from './FinKit';

const HOVER_DELAY = 400;
const CLOSE_DELAY = 120;
const PIN_DELAY = 5_500;
const DATA_WAIT_LIMIT = 1_100;
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

function FullPayoutHistoryModal({ name, rows, periods, totals, isLoading, onClose }: {
  name: string; rows: any[]; periods: any[]; totals: any; isLoading: boolean; onClose: () => void;
}) {
  useModalKeys(onClose);
  return (
    <div className="fin-overlay" onClick={onClose}>
      <div className="modal fin-payout-modal" role="dialog" aria-modal="true"
        aria-label={`История выплат — ${name}`} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>История выплат — {name}</h3>
          <button className="btn ghost sm" aria-label="Закрыть" onClick={onClose}>
            <FinIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <Totals totals={totals} />
          <PayrollPeriods periods={periods} />
          <div className="fin-payout-full-list">
            {rows.length > 0 && <div className="fin-payout-section-label">Операции по счетам</div>}
            <HistoryRows rows={rows} isLoading={isLoading} emptyText="История выплат пока пуста" />
          </div>
        </div>
      </div>
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
  const qc = useQueryClient();
  const ref = useRef<HTMLSpanElement>(null);
  const hoverSeq = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [pos, setPos] = useState<FloatingPosition | null>(null);
  const previewKey = ['fin-payouts', employeeId, 3] as const;
  const previewFn = () => financeApi.employeePayouts(employeeId, 3);

  const previewQ = useQuery({
    queryKey: previewKey,
    queryFn: previewFn,
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
  const updatePosition = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos(floatingPosition(rect, POP_WIDTH, 620));
  }, []);

  useEffect(() => {
    if (!open) return;
    const main = document.querySelector('main');
    window.addEventListener('resize', updatePosition);
    main?.addEventListener('scroll', updatePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePosition);
      main?.removeEventListener('scroll', updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || pinned) return;
    pinTimer.current = setTimeout(() => setPinned(true), PIN_DELAY);
    return () => {
      if (pinTimer.current) clearTimeout(pinTimer.current);
    };
  }, [open, pinned]);

  const enter = () => {
    cancelClose();
    if (open) return;
    const seq = ++hoverSeq.current;
    // Предзагрузка начинается в момент наведения. Окно появляется уже с
    // данными (или максимум через DATA_WAIT_LIMIT), поэтому не меняет резко
    // высоту сразу после открытия.
    void Promise.all([
      new Promise(resolve => setTimeout(resolve, HOVER_DELAY)),
      Promise.race([
        qc.fetchQuery({ queryKey: previewKey, queryFn: previewFn, staleTime: 30_000 }).catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, DATA_WAIT_LIMIT)),
      ]),
    ]).then(() => {
      if (hoverSeq.current !== seq) return;
      updatePosition();
      setOpen(true);
    });
  };
  const leave = () => {
    hoverSeq.current++;
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  const closePreview = () => {
    hoverSeq.current++;
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
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: POP_WIDTH }}
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
        <FullPayoutHistoryModal name={name} rows={fullRows} periods={fullPeriods}
          totals={fullTotals} isLoading={fullQ.isLoading} onClose={() => setFullOpen(false)} />,
        document.body,
      )}
    </span>
  );
}
