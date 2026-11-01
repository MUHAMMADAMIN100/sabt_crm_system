// График «Расхода» (01.11.2026, по образцу владельца): линия на каждую статью,
// точки на каждом месяце, сетка по месяцам, подписи статей снизу. Месяц —
// прошлые месяцы факт, текущий — ушло + осталось, дальше — план (фон
// подкрашен). Период «3 / 6 месяцев / 1 год» — те же цифры, что в таблице.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, moneyBare, monthLabel } from './finlib';

type Key = 'salary' | 'rent' | 'debts' | 'installments' | 'other';
type Vals = Record<Key, number>;
type ChartRow = { ym: string; kind: 'fact' | 'current' | 'plan'; fact: Vals; left: Vals; otherSource: 'plan' | 'avg' | null };

// Цвета проверены на различимость (в т. ч. при дальтонизме) на светлом и
// тёмном фоне; «Прочее» сиреневое — серое сливалось с «Рассрочками».
export const SERIES: Array<{ key: Key; label: string; color: string }> = [
  { key: 'salary', label: 'Зарплата', color: '#c97c0a' },
  { key: 'rent', label: 'Аренда и подписки', color: '#7173ee' },
  { key: 'debts', label: 'Долги', color: '#de4b59' },
  { key: 'installments', label: 'Рассрочки банкам', color: '#0b978a' },
  { key: 'other', label: 'Прочее', color: '#b06fc8' },
];

const H = 300;
const PAD = { l: 66, r: 16, t: 18, b: 38 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Круглый шаг оси: 1 / 2 / 2,5 / 5 × 10ⁿ, около четырёх делений. */
function niceStep(max: number) {
  const raw = Math.max(1, max) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw;
}
const tickLabel = (v: number) => (v === 0 ? '0' : v >= 1000 ? `${moneyBare(v / 1000)} тыс.` : moneyBare(v));

export default function ExpenseLineChart({ ym, period }: { ym: string; period: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'expenseChart', period ? `p${period}` : ym],
    queryFn: () => financeApi.expenseChart(ym, period),
  });
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<Key>>(new Set());

  const rows: ChartRow[] = data?.rows ?? [];
  // Месяц: факт + осталось (текущий — целиком); период — только «осталось», как в таблице.
  const valueOf = (r: ChartRow, k: Key) => (period ? r.left[k] : r.fact[k] + r.left[k]) || 0;
  const shown = SERIES.filter((s) => !hidden.has(s.key));
  const n = rows.length;
  const curIdx = rows.findIndex((r) => r.kind === 'current');
  const max = Math.max(1, ...rows.flatMap((r) => shown.map((s) => valueOf(r, s.key))));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const W = Math.max(320, width);
  const band = n ? (W - PAD.l - PAD.r) / n : 0;
  const X = (i: number) => PAD.l + band * (i + 0.5);
  const Y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top);
  // Узко — подпись у каждого 2-го/3-го месяца, отсчёт от текущего (он подписан всегда).
  const labelStep = band < 32 ? 3 : band < 52 ? 2 : 1;
  const anchor = Math.max(0, curIdx);
  const showLabel = (i: number) => ((i - anchor) % labelStep + labelStep) % labelStep === 0;
  const hasData = rows.some((r) => SERIES.some((s) => valueOf(r, s.key) > 0));

  const toggle = (k: Key) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k);
    else if (SERIES.length - next.size > 1) next.add(k);
    return next;
  });

  const tipRow = hover != null ? rows[hover] : null;
  // Справа от точки, у правого края — слева; не вылезает за график.
  const tipLeft = hover != null ? Math.max(0, Math.min(W - 240, X(hover) + 260 > W ? X(hover) - 252 : X(hover) + 14)) : 0;

  return (
    <section className="card fin-exp-chart" aria-label="График расхода по месяцам">
      <div className="head">
        <h2>Расход по месяцам</h2>
        <p>{period
          ? 'Сколько осталось отдать в каждом месяце — те же цифры, что в таблице.'
          : 'Прошлые месяцы — сколько ушло, текущий — ушло и осталось, дальше — план.'}</p>
      </div>
      <div ref={ref} className="plot" tabIndex={0} role="group"
        aria-label="Линии по статьям расхода; стрелки влево и вправо — месяцы"
        onFocus={() => setHover((h) => h ?? Math.max(0, curIdx))}
        onBlur={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (!n) return;
          if (e.key === 'ArrowRight') { e.preventDefault(); setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((h) => Math.max(0, (h ?? n) - 1)); }
        }}>
        {isLoading || !width ? <div className="fin-exp-chart-empty" style={{ height: H }}>Загружаю…</div>
          : !hasData ? <div className="fin-exp-chart-empty" style={{ height: H }}>Расходов за эти месяцы нет</div> : (
          <>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
              aria-label={`Расход по статьям: ${rows.map((r) => `${monthLabel(r.ym)} — ${moneyBare(SERIES.reduce((s, x) => s + valueOf(r, x.key), 0))}`).join(', ')}`}>
              {!period && curIdx >= 0 && (
                <g aria-hidden="true">
                  <rect className="plan-bg" x={X(curIdx) - band / 2} y={PAD.t} width={W - PAD.r - (X(curIdx) - band / 2)} height={H - PAD.t - PAD.b} rx={8} />
                  {curIdx < n - 1 && <text className="plan-tx" x={X(curIdx + 1) - band / 2 + 8} y={PAD.t + 14}>план</text>}
                </g>
              )}
              {ticks.map((v) => (
                <g key={v} aria-hidden="true">
                  <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} />
                  <text className="ax" x={PAD.l - 10} y={Y(v) + 4} textAnchor="end">{tickLabel(v)}</text>
                </g>
              ))}
              {rows.map((r, i) => (
                <g key={r.ym} aria-hidden="true">
                  <line className="grid" x1={X(i)} x2={X(i)} y1={PAD.t} y2={H - PAD.b} />
                  {showLabel(i) && (
                    <text className={`ax${i === curIdx ? ' cur' : ''}`} x={X(i)} y={H - PAD.b + 20} textAnchor="middle">{monthLabel(r.ym)}</text>
                  )}
                </g>
              ))}
              {hover != null && <line className="cross" x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={H - PAD.b} aria-hidden="true" />}
              {shown.map((s) => (
                <g key={s.key} aria-hidden="true">
                  <path d={rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(valueOf(r, s.key)).toFixed(1)}`).join(' ')}
                    fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {rows.map((r, i) => (
                    <circle key={r.ym} className="dot" cx={X(i)} cy={Y(valueOf(r, s.key))} r={hover === i ? 5 : 4} fill={s.color} />
                  ))}
                </g>
              ))}
              {rows.map((r, i) => (
                <rect key={r.ym} x={X(i) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent"
                  onMouseEnter={() => setHover(i)} aria-hidden="true" />
              ))}
            </svg>
            {tipRow && (
              <div className="tip" style={{ left: tipLeft, top: PAD.t }} role="status">
                <b>{monthLabel(tipRow.ym, true)} · {tipRow.kind === 'fact' ? 'ушло' : tipRow.kind === 'current' ? (period ? 'осталось' : 'ушло и осталось') : 'план'}</b>
                {shown.map((s) => (
                  <div key={s.key} className="r">
                    <span><i style={{ background: s.color }} />{s.label}{s.key === 'other' && tipRow.kind !== 'fact' && tipRow.otherSource === 'avg' ? ' ≈' : ''}</span>
                    <b>{moneyBare(valueOf(tipRow, s.key))}</b>
                  </div>
                ))}
                <div className="r sum"><span>Всего</span><b>{money(shown.reduce((sum, s) => sum + valueOf(tipRow, s.key), 0))}</b></div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="legend" role="group" aria-label="Статьи на графике">
        {SERIES.map((s) => (
          <button key={s.key} type="button" aria-pressed={!hidden.has(s.key)} className={hidden.has(s.key) ? 'off' : ''} onClick={() => toggle(s.key)}
            title={hidden.has(s.key) ? 'Показать на графике' : 'Скрыть с графика'}>
            <i style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
