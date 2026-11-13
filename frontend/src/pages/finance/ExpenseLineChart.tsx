// График «Расхода» (01.11.2026, по образцу владельца): линия на каждую статью,
// точки на месяцах, сетка по месяцам, подписи статей снизу. Нагляднее:
// итог месяца над каждой колонкой, значение у конца каждой линии, вывод
// одной фразой; наведение на статью выделяет её линию. Месяц — прошлые
// месяцы факт, текущий — ушло + осталось, дальше — план (фон подкрашен).
// «3 / 6 месяцев / 1 год» — месяцы периода, те же цифры, что в таблице.
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, moneyBare, monthLabel } from './finlib';

// 13.11.2026: тот же график на «Доходе» — линия на каждое направление.
// Код один, у «Расхода» и «Дохода» свои ряды, запрос и подписи (ChartKind).
type Key = string;
type Vals = Record<Key, number>;
type ChartRow = { ym: string; kind: 'fact' | 'current' | 'plan'; fact: Vals; left: Vals; otherSource?: 'plan' | 'avg' | null };
type Series = { key: Key; label: string; color: string };

// Цвета проверены на различимость (в т. ч. при дальтонизме) на светлом и
// тёмном фоне; «Прочее» сиреневое — серое сливалось с «Рассрочками».
const EXPENSE_SERIES: Series[] = [
  { key: 'salary', label: 'Зарплата', color: '#c97c0a' },
  { key: 'rent', label: 'Аренда и подписки', color: '#7173ee' },
  { key: 'debts', label: 'Долги', color: '#de4b59' },
  { key: 'installments', label: 'Рассрочки банкам', color: '#0b978a' },
  { key: 'other', label: 'Прочее', color: '#b06fc8' },
];
/** Ряды «Расхода» — ими же раскрашена таблица периода на странице. */
export const SERIES = EXPENSE_SERIES;

// Направления дохода. Цвета карточек (#20b965, #5f7dff, #9b77d8, #47aaa4)
// линиями не различались: Development и Design сливались, бирюзовое
// «Обслуживание» — с зелёным SMM. Оттенки те же, кроме «Обслуживания»
// (янтарное); набор проверен валидатором на светлом и тёмном фоне.
const INCOME_SERIES: Series[] = [
  { key: 'smm', label: 'SMM', color: '#49a46e' },
  { key: 'development', label: 'Development', color: '#4f8afb' },
  { key: 'design', label: 'Design', color: '#be4daa' },
  { key: 'maintenance', label: 'Обслуживание', color: '#a35e16' },
];

const H = 380;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const prepOf = (ym: string) => MONTHS_PREP[Number(ym.slice(5, 7)) - 1] ?? 'этом месяце';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    // Без ResizeObserver (старый браузер, тесты) ширина берётся один раз —
    // иначе падала бы вся страница «Расхода»/«Дохода».
    if (typeof ResizeObserver === 'undefined') return;
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

/** Плавная линия без «перелётов» (монотонная кубическая, Фрич — Карлсон). */
function smoothPath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1);
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

type ChartKind = 'expense' | 'income';
const TEXT = {
  expense: {
    title: 'Расход по месяцам', aria: 'График расхода по месяцам', svgAria: 'Расход по месяцам',
    plotAria: 'Линии по статьям расхода; стрелки влево и вправо — месяцы',
    legendAria: 'Статьи на графике: нажмите, чтобы скрыть или показать',
    empty: 'Расходов за эти месяцы нет',
    hint: 'Сколько уходит в каждом месяце по статьям.', periodHint: 'Сколько осталось отдать в каждом месяце.',
    tip: { fact: 'ушло', current: 'ушло и осталось', currentPeriod: 'осталось', plan: 'план' },
  },
  income: {
    title: 'Доход по месяцам', aria: 'График дохода по месяцам', svgAria: 'Доход по месяцам',
    plotAria: 'Линии по направлениям дохода; стрелки влево и вправо — месяцы',
    legendAria: 'Направления на графике: нажмите, чтобы скрыть или показать',
    empty: 'Доходов за эти месяцы нет',
    hint: 'Сколько приходит в каждом месяце по направлениям.', periodHint: '',
    tip: { fact: 'пришло', current: 'пришло и ждём', currentPeriod: 'ждём', plan: 'план' },
  },
} as const;

export default function ExpenseLineChart({ ym, period }: { ym: string; period: number }) {
  return <MonthLinesChart kind="expense" ym={ym} period={period} />;
}

/** «Доход по месяцам» — под карточками направлений на «Доходе». */
export function IncomeLineChart({ ym }: { ym: string }) {
  return <MonthLinesChart kind="income" ym={ym} period={0} />;
}

function MonthLinesChart({ kind, ym, period }: { kind: ChartKind; ym: string; period: number }) {
  const SERIES = kind === 'income' ? INCOME_SERIES : EXPENSE_SERIES;
  const tx = TEXT[kind];
  const { data, isLoading } = useQuery({
    queryKey: kind === 'income'
      ? ['finance', 'incomeChart', ym]
      : ['finance', 'expenseChart', period ? `p${period}` : ym],
    queryFn: () => (kind === 'income' ? financeApi.incomeChart(ym) : financeApi.expenseChart(ym, period)),
    placeholderData: keepPreviousData,
  });
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<Key>>(new Set());
  const [focus, setFocus] = useState<Key | null>(null);

  const rows: ChartRow[] = data?.rows ?? [];
  // Месяц: факт + осталось (текущий — целиком); период — только «осталось», как в таблице.
  const valueOf = (r: ChartRow, k: Key) => (period ? r.left[k] : r.fact[k] + r.left[k]) || 0;
  const totalOf = (r: ChartRow) => SERIES.reduce((s, x) => s + valueOf(r, x.key), 0);
  const shown = SERIES.filter((s) => !hidden.has(s.key));
  const n = rows.length;
  const curIdx = rows.findIndex((r) => r.kind === 'current');
  const W = Math.max(320, width);
  const wide = W >= 640;
  const PAD = { l: wide ? 66 : 50, r: wide ? 104 : 14, t: 46, b: 40 };
  const max = Math.max(1, ...rows.flatMap((r) => shown.map((s) => valueOf(r, s.key))));
  const step = niceStep(max);
  const top = Math.ceil((max * 1.06) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const band = n ? (W - PAD.l - PAD.r) / n : 0;
  const X = (i: number) => PAD.l + band * (i + 0.5);
  const Y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top);
  const base = Y(0);
  // Узко — подпись у каждого 2-го/3-го месяца, отсчёт от текущего (он подписан всегда).
  const labelStep = band < 32 ? 3 : band < 52 ? 2 : 1;
  const anchor = Math.max(0, curIdx);
  const showLabel = (i: number) => ((i - anchor) % labelStep + labelStep) % labelStep === 0;
  const hasData = rows.some((r) => totalOf(r) > 0);

  // Вывод одной фразой — то, ради чего смотрят график.
  const sumAll = rows.reduce((s, r) => s + totalOf(r), 0);
  const focusRow = curIdx >= 0 ? rows[curIdx] : rows[rows.length - 1];
  const topCat = focusRow ? [...SERIES].sort((a, b) => valueOf(focusRow, b.key) - valueOf(focusRow, a.key))[0] : null;
  const peak = rows.reduce<ChartRow | null>((best, r) => (!best || totalOf(r) > totalOf(best) ? r : best), null);
  const share = (r: ChartRow, k: Key) => Math.round((100 * valueOf(r, k)) / Math.max(1, totalOf(r)));
  // Доход: прошлый месяц — «пришло», текущий — «придёт (уже пришло …)», дальше — «по плану».
  const incomeHead = (r: ChartRow) => {
    const got = SERIES.reduce((sum, x) => sum + (r.fact[x.key] || 0), 0);
    return r.kind === 'fact' ? `В ${prepOf(r.ym)} пришло ${money(totalOf(r))}`
      : r.kind === 'current' ? `В ${prepOf(r.ym)} придёт ${money(totalOf(r))}${got > 0 && got < totalOf(r) ? ` (уже пришло ${money(got)})` : ''}`
        : `В ${prepOf(r.ym)} по плану придёт ${money(totalOf(r))}`;
  };
  const summary = !hasData ? '' : kind === 'income'
    ? (focusRow && topCat ? `${incomeHead(focusRow)}, больше всего — ${topCat.label} (${share(focusRow, topCat.key)}%). Лучший месяц — ${peak ? monthLabel(peak.ym, true) : ''}: ${money(peak ? totalOf(peak) : 0)}` : '')
    : period
    ? `За ${n === 12 ? 'год' : `${n} мес.`} — ${money(sumAll)}, в среднем ${money(Math.round(sumAll / Math.max(1, n)))} в месяц. Больше всего уйдёт в ${peak ? prepOf(peak.ym) : ''}: ${money(peak ? totalOf(peak) : 0)}`
    : focusRow && topCat
      ? `В ${prepOf(focusRow.ym)} уходит ${money(totalOf(focusRow))}, больше всего — ${topCat.label.toLowerCase()} (${Math.round((100 * valueOf(focusRow, topCat.key)) / Math.max(1, totalOf(focusRow)))}%). Самый дорогой месяц — ${peak ? monthLabel(peak.ym, true) : ''}: ${money(peak ? totalOf(peak) : 0)}`
      : '';
  const range = n ? `${cap(monthLabel(rows[0].ym, true))} — ${monthLabel(rows[n - 1].ym, true)}` : '';

  // Значения у конца линий: не налезают — раздвигаем, к точке ведёт тонкая линия.
  const ends = wide && n ? shown
    .map((s) => ({ s, py: Y(valueOf(rows[n - 1], s.key)), v: valueOf(rows[n - 1], s.key) }))
    .sort((a, b) => a.py - b.py)
    .map((e) => ({ ...e, ly: e.py })) : [];
  for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 20) ends[i].ly = ends[i - 1].ly + 20;
  const overflow = ends.length ? ends[ends.length - 1].ly - (base - 4) : 0;
  if (overflow > 0) for (const e of ends) e.ly -= overflow;

  const toggle = (k: Key) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k);
    else if (SERIES.length - next.size > 1) next.add(k);
    return next;
  });

  const tipRow = hover != null ? rows[hover] : null;
  const tipLeft = hover != null ? Math.max(0, Math.min(W - 280, X(hover) + 300 > W ? X(hover) - 292 : X(hover) + 16)) : 0;
  const dim = (k: Key) => (focus && focus !== k ? 0.14 : 1);

  return (
    <section className="card fin-exp-chart" aria-label={tx.aria}>
      <div className="head">
        <div>
          <h2>{tx.title}</h2>
          <p>{summary || (period ? tx.periodHint : tx.hint)}</p>
        </div>
        {range && <span className="range">{range}{period ? ' · план' : ''}</span>}
      </div>
      <div ref={ref} className="plot" tabIndex={0} role="group"
        aria-label={tx.plotAria}
        onFocus={() => setHover((h) => h ?? Math.max(0, curIdx))}
        onBlur={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (!n) return;
          if (e.key === 'ArrowRight') { e.preventDefault(); setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((h) => Math.max(0, (h ?? n) - 1)); }
        }}>
        {isLoading || !width ? <div className="fin-exp-chart-empty" style={{ height: H }}>Загружаю…</div>
          : !hasData ? <div className="fin-exp-chart-empty" style={{ height: H }}>{tx.empty}</div> : (
          <>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
              aria-label={`${tx.svgAria}: ${rows.map((r) => `${monthLabel(r.ym)} — ${moneyBare(totalOf(r))}`).join(', ')}`}>
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`fin-${kind}-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {!period && curIdx >= 0 && curIdx < n - 1 && (
                <g aria-hidden="true">
                  <rect className="plan-bg" x={X(curIdx) + band / 2} y={PAD.t} width={W - PAD.r - (X(curIdx) + band / 2)} height={H - PAD.t - PAD.b} rx={10} />
                  <text className="plan-tx" x={W - PAD.r - 10} y={PAD.t + 16} textAnchor="end">план →</text>
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
                  <line className="grid" x1={X(i)} x2={X(i)} y1={PAD.t} y2={base} />
                  {showLabel(i) && (
                    <>
                      {/* Итог месяца — над колонкой. */}
                      <text className={`tot${i === curIdx || hover === i ? ' cur' : ''}`} x={X(i)} y={PAD.t - 14} textAnchor="middle">{moneyBare(totalOf(r))}</text>
                      <text className={`ax${i === curIdx ? ' cur' : ''}`} x={X(i)} y={base + 22} textAnchor="middle">{monthLabel(r.ym)}</text>
                    </>
                  )}
                </g>
              ))}
              <text className="tot-cap" x={PAD.l - 10} y={PAD.t - 14} textAnchor="end" aria-hidden="true">всего</text>
              {!period && curIdx >= 0 && (
                <g aria-hidden="true">
                  <line className="now" x1={X(curIdx)} x2={X(curIdx)} y1={PAD.t} y2={base} />
                </g>
              )}
              {hover != null && <line className="cross" x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={base} aria-hidden="true" />}
              {focus && !hidden.has(focus) && (
                <path aria-hidden="true" fill={`url(#fin-${kind}-grad-${focus})`}
                  d={`${smoothPath(rows.map((r, i) => [X(i), Y(valueOf(r, focus))]))} L${X(n - 1).toFixed(1)},${base} L${X(0).toFixed(1)},${base} Z`} />
              )}
              {shown.map((s) => (
                <g key={s.key} aria-hidden="true" style={{ opacity: dim(s.key), transition: 'opacity .15s' }}>
                  <path d={smoothPath(rows.map((r, i) => [X(i), Y(valueOf(r, s.key))]))}
                    fill="none" stroke={s.color} strokeWidth={focus === s.key ? 3.5 : 2.75} strokeLinejoin="round" strokeLinecap="round" />
                  {rows.map((r, i) => (
                    <circle key={r.ym} className="dot" cx={X(i)} cy={Y(valueOf(r, s.key))}
                      r={hover === i ? 6.5 : i === curIdx ? 5.5 : 4.5} fill={s.color} />
                  ))}
                </g>
              ))}
              {ends.map((e) => (
                <g key={e.s.key} aria-hidden="true" style={{ opacity: dim(e.s.key) }}>
                  {Math.abs(e.ly - e.py) > 1 && <line className="lead" x1={X(n - 1) + 8} y1={e.py} x2={W - PAD.r + 10} y2={e.ly} />}
                  <circle cx={W - PAD.r + 16} cy={e.ly} r={4} fill={e.s.color} />
                  <text className="end" x={W - PAD.r + 25} y={e.ly + 4}>{moneyBare(e.v)}</text>
                </g>
              ))}
              {rows.map((r, i) => (
                <rect key={r.ym} x={X(i) - band / 2} y={0} width={band} height={H} fill="transparent"
                  onMouseEnter={() => setHover(i)} aria-hidden="true" />
              ))}
            </svg>
            {tipRow && (
              <div className="tip" style={{ left: tipLeft, top: PAD.t }} role="status">
                <div className="tip-h">
                  <b>{cap(monthLabel(tipRow.ym, true))}</b>
                  <span>{tipRow.kind === 'fact' ? tx.tip.fact : tipRow.kind === 'current' ? (period ? tx.tip.currentPeriod : tx.tip.current) : tx.tip.plan}</span>
                </div>
                {[...shown].sort((a, b) => valueOf(tipRow, b.key) - valueOf(tipRow, a.key)).map((s) => {
                  const v = valueOf(tipRow, s.key);
                  const pct = Math.round((100 * v) / Math.max(1, totalOf(tipRow)));
                  return (
                    <div key={s.key} className="r">
                      <span><i style={{ background: s.color }} />{s.label}{s.key === 'other' && tipRow.kind !== 'fact' && tipRow.otherSource === 'avg' ? ' ≈' : ''}</span>
                      <b>{moneyBare(v)}<em>{pct}%</em></b>
                    </div>
                  );
                })}
                <div className="r sum"><span>Всего за месяц</span><b>{money(totalOf(tipRow))}</b></div>
              </div>
            )}
          </>
        )}
      </div>
      <div className={`legend n${SERIES.length}`} role="group" aria-label={tx.legendAria}>
        {SERIES.map((s) => {
          const sum = rows.reduce((acc, r) => acc + valueOf(r, s.key), 0);
          return (
            <button key={s.key} type="button" aria-pressed={!hidden.has(s.key)} className={hidden.has(s.key) ? 'off' : ''}
              onClick={() => toggle(s.key)}
              onMouseEnter={() => setFocus(s.key)} onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(s.key)} onBlur={() => setFocus(null)}
              title={hidden.has(s.key) ? 'Показать на графике' : 'Скрыть с графика'}>
              <i style={{ background: s.color }} />
              <span className="nm">{s.label}</span>
              <span className="sm">{money(sum)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
