// Кривая остатка — общая для «Планирования» и «Транзакций» (30.09.2026).
//
// Отвечает на вопрос «когда и насколько кончатся деньги»: сетка под ней —
// «что именно в этот день» (вариант В: кривая над тихой сеткой).
//   plan — «Планирование»: факт по сегодня и план до конца месяца.
//   fact — «Транзакции»: только проведённые операции, по сегодня.
//
// Наведите на кривую — всплывает остаток дня и его приход/расход, а день
// подсвечивается в сетке (onHoverDay). На телефоне то же самое по нажатию,
// только строкой под кривой: плавающая подсказка в 332 px не помещается.
import { useMemo, useState } from 'react';
import { moneyBare, pluralRu, todayISO } from './finlib';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Сумма со знаком и типографским минусом, без «с.». */
const signed = (v: number): string => (v < 0 ? '−' : '') + moneyBare(Math.abs(v));

export type DayTotals = ReadonlyMap<string, { inc: number; exp: number }>;

type Point = { i: number; v: number };

export default function BalanceCurve({ ym, balances, mode, narrow = false, dayTotals, onHoverDay, emptyNote }: {
  ym: string;
  /** Остаток на конец дня 'YYYY-MM-DD' → сумма. Нет дня или null — нет точки. */
  balances?: ReadonlyMap<string, number | null>;
  mode: 'plan' | 'fact';
  narrow?: boolean;
  /** Приход и расход дня — для подсказки при наведении. */
  dayTotals?: DayTotals;
  /** День под курсором ('YYYY-MM-DD') или null — подсветить его в сетке. */
  onHoverDay?: (iso: string | null) => void;
  /** Что сказать, если точек меньше двух и рисовать нечего. */
  emptyNote?: string;
}) {
  const [hover, setHoverState] = useState<number | null>(null);
  const [year, monthNo] = ym.split('-').map(Number);
  const daysIn = new Date(year, monthNo, 0).getDate();
  const isoOf = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;
  const today = todayISO();
  const monGen = MON_GEN[monthNo - 1] || '';
  const monShort = MON_SHORT[monthNo - 1] || '';

  // Точки: i — индекс дня (0 = 1-е число). Дни без данных пропускаем, но
  // ось X всегда весь месяц: неполная кривая стоит на своих датах.
  const points = useMemo(() => {
    const out: Point[] = [];
    if (!balances) return out;
    for (let d = 1; d <= daysIn; d++) {
      const v = balances.get(`${ym}-${String(d).padStart(2, '0')}`);
      if (typeof v === 'number' && Number.isFinite(v)) out.push({ i: d - 1, v });
    }
    return out;
  }, [balances, ym, daysIn]);

  const facts = useMemo(() => {
    if (points.length < 2) return null;
    let firstNeg = -1, lastNeg = -1, negDays = 0;
    let low = points[0];
    for (const p of points) {
      if (p.v < 0) { if (firstNeg < 0) firstNeg = p.i; lastNeg = p.i; negDays++; }
      if (p.v < low.v) low = p;
    }
    const todayIdx = today.slice(0, 7) === ym ? Number(today.slice(8)) - 1 : -1;
    return {
      firstNeg, lastNeg, negDays, low,
      last: points[points.length - 1],
      todayIdx,
      todayPoint: points.find((p) => p.i === todayIdx) ?? null,
    };
  }, [points, ym, today]);

  const chart = useMemo(() => {
    if (!facts) return null;
    const W = narrow ? 332 : 1164;
    const VBH = narrow ? 118 : 206;
    const H = narrow ? 84 : 140;
    const PAD = narrow ? 6 : 12;
    const inset = narrow ? 6 : 16;
    const vals = points.map((p) => p.v);
    const top = Math.max(...vals, 0);
    const bot = Math.min(...vals, 0);
    const span = top - bot || 1;
    const step = daysIn > 1 ? (W - inset * 2) / (daysIn - 1) : 0;
    const X = (i: number) => inset + i * step;
    const Y = (v: number) => PAD + ((top - v) * H) / span;
    const f = (n: number) => n.toFixed(1);
    const zeroY = Y(0);
    const pts = points.map((p) => [X(p.i), Y(p.v)] as [number, number]);
    const x0 = X(points[0].i);
    const x1 = X(points[points.length - 1].i);
    const band = (clamp: (y: number) => number) => [`${f(x0)},${f(zeroY)}`]
      .concat(pts.map(([x, y]) => `${f(x)},${f(clamp(y))}`))
      .concat([`${f(x1)},${f(zeroY)}`]).join(' ');

    const marks: any[] = [];
    const push = (p: Point | null, label: string, tone: string, anchor: 'start' | 'end') => {
      if (!p || marks.some((m) => m.i === p.i)) return;
      // У правого края подпись разворачиваем влево — иначе вылезет за рамку.
      const side = anchor === 'start' && X(p.i) > W - 150 ? 'end' : anchor;
      marks.push({
        i: p.i, label, tone, anchor: side,
        x: f(X(p.i)), y: f(Y(p.v)),
        tx: f(X(p.i) + (side === 'end' ? -9 : 9)),
        ty: f(Y(p.v) - 17), ty2: f(Y(p.v) - 4),
        value: signed(p.v) + ' с.',
      });
    };
    const firstNegPoint = facts.firstNeg >= 0 ? points.find((p) => p.i === facts.firstNeg) ?? null : null;
    const gapLabel = mode === 'fact' ? 'ушли в минус'
      : facts.todayIdx >= 0 && facts.firstNeg > facts.todayIdx ? 'деньги кончатся' : 'деньги кончились';
    push(firstNegPoint, gapLabel, 'amber', 'start');
    push(facts.low, facts.low.v < 0 ? 'дно месяца' : 'минимум', facts.low.v < 0 ? 'red' : 'muted', 'start');
    push(facts.todayPoint, mode === 'fact' ? 'сейчас' : 'сегодня', 'accent', 'end');

    // Справа от «сегодня» — не факт, а план: помечаем, чтобы плановую часть
    // кривой не читали как уже случившуюся.
    const planFrom = mode === 'plan' && facts.todayIdx >= 0 && facts.todayIdx < daysIn - 1 ? facts.todayIdx : -1;

    const weekBands: any[] = [];
    if (!narrow) {
      const firstIdx = (new Date(year, monthNo - 1, 1).getDay() + 6) % 7;   // Пн = 0
      for (let d = 1, k = 1; d <= daysIn; k++) {
        const end = Math.min(daysIn, d + 6 - ((firstIdx + d - 1) % 7));
        weekBands.push({ key: k, x: f((X(d - 1) + X(end - 1)) / 2), label: `${k} нед` });
        d = end + 1;
      }
    }

    const tickDays = narrow ? [1, 10, 20, daysIn] : [1, 5, 10, 15, 20, 25, daysIn];
    return {
      W, VBH, H, PAD, X, Y, step,
      zeroY: f(zeroY), zeroLabelY: f(zeroY - 5),
      line: pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' '),
      pos: band((y) => Math.min(y, zeroY)),
      neg: band((y) => Math.max(y, zeroY)),
      planX: planFrom >= 0 ? f(X(planFrom)) : null,
      planW: planFrom >= 0 ? f(X(daysIn - 1) - X(planFrom)) : '0',
      planLabelX: planFrom >= 0 ? f(X(planFrom) + 10) : '0',
      ticks: Array.from(new Set(tickDays)).filter((d) => d >= 1 && d <= daysIn)
        .map((d) => ({ d, x: f(X(d - 1)) })),
      marks, weekBands,
    };
  }, [points, facts, narrow, daysIn, ym, mode, year, monthNo]);

  const setHover = (i: number | null) => {
    setHoverState(i);
    onHoverDay?.(i == null ? null : isoOf(i + 1));
  };
  const hovered = hover == null ? null : points.find((p) => p.i === hover) ?? null;
  const hoverTot = hovered ? dayTotals?.get(isoOf(hovered.i + 1)) : undefined;
  const hoverMoves = hoverTot && (hoverTot.inc > 0 || hoverTot.exp > 0)
    ? `+${moneyBare(hoverTot.inc)} / −${moneyBare(hoverTot.exp)}` : '';

  const title = mode === 'fact' ? 'Остаток на счетах' : 'Остаток по дням';

  // Итог одной строкой: где минус, где дно и чем кончается.
  const summary = (() => {
    if (!facts) return '';
    const parts: string[] = [];
    if (facts.firstNeg < 0) parts.push('весь месяц выше нуля');
    else if (facts.firstNeg === facts.lastNeg) parts.push(`ниже нуля ${facts.firstNeg + 1} ${monGen}`);
    else if (facts.negDays === facts.lastNeg - facts.firstNeg + 1) {
      parts.push(`ниже нуля с ${facts.firstNeg + 1} по ${facts.lastNeg + 1} ${monGen}`);
    } else {
      parts.push(`ниже нуля ${facts.negDays} ${pluralRu(facts.negDays, 'день', 'дня', 'дней')}, первый — ${facts.firstNeg + 1} ${monGen}`);
    }
    if (facts.low.v < 0) parts.push(`дно ${signed(facts.low.v)} с.`);
    const now = mode === 'fact' && facts.todayPoint && facts.last.i === facts.todayPoint.i;
    parts.push(`${now ? 'сейчас' : 'на конец месяца'} ${signed(facts.last.v)} с.`);
    return parts.join(' · ');
  })();

  if (!facts || !chart) {
    return (
      <div className="bal-curve bal-curve-empty">
        <div className="bal-curve-head"><b>{title}</b></div>
        <p className="muted mini">{emptyNote || 'Для кривой пока мало данных — нужна хотя бы пара дней.'}</p>
      </div>
    );
  }

  const aria = facts.firstNeg >= 0
    ? `${title} на конец каждого дня. Ниже нуля ${facts.negDays} ${pluralRu(facts.negDays, 'день', 'дня', 'дней')}, дно ${signed(facts.low.v)} сомони.`
    : `${title} на конец каждого дня: весь месяц выше нуля.`;
  const hx = hovered ? chart.X(hovered.i) : 0;

  return (
    <div className="bal-curve">
      <div className="bal-curve-head">
        <b>{title}</b>
        <span className="muted mini">
          {narrow ? (mode === 'fact' ? 'по факту, на конец каждого дня' : 'сколько денег на счетах на конец каждого дня') : summary}
        </span>
        <span className="bal-curve-legend mini">
          <span><i className="sw pos" />выше нуля</span>
          <span><i className="sw neg" />ниже нуля</span>
        </span>
      </div>
      <div className="bal-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${chart.W} ${chart.VBH}`} className="bal-svg" role="img" aria-label={aria}>
          {chart.planX && <rect x={chart.planX} y={chart.PAD} width={chart.planW} height={chart.H} className="bal-plan" />}
          {chart.planX && !narrow && <text x={chart.planLabelX} y={chart.PAD + 12} className="bal-plan-label">ПЛАН</text>}
          <polygon points={chart.pos} className="bal-area pos" />
          <polygon points={chart.neg} className="bal-area neg" />
          <line x1="4" y1={chart.zeroY} x2={chart.W - 4} y2={chart.zeroY} className="bal-zero" />
          {!narrow && <text x="10" y={chart.zeroLabelY} className="bal-tick">0</text>}
          <polyline points={chart.line} className="bal-line" />
          {chart.marks.map((m: any) => (
            <g key={m.i} className={'bal-mark ' + m.tone}>
              {!narrow && <line x1={m.x} y1={m.y} x2={m.x} y2={chart.PAD + chart.H + 6} />}
              <circle cx={m.x} cy={m.y} r={narrow ? 3.6 : 4.5} />
              {!narrow && <text x={m.tx} y={m.ty} textAnchor={m.anchor} className="lbl">{m.label}</text>}
              {!narrow && <text x={m.tx} y={m.ty2} textAnchor={m.anchor} className="val">{m.value}</text>}
            </g>
          ))}
          {hovered && (
            <g className="bal-hover">
              <line x1={hx} y1={chart.PAD} x2={hx} y2={chart.PAD + chart.H} />
              <circle cx={hx} cy={chart.Y(hovered.v)} r={narrow ? 4 : 5} />
            </g>
          )}
          {chart.ticks.map((t: any) => (
            <text key={t.d} x={t.x} y={narrow ? 110 : 180} textAnchor="middle" className="bal-tick">{t.d}</text>
          ))}
          {chart.weekBands.map((b: any) => (
            <text key={b.key} x={b.x} y="200" textAnchor="middle" className="bal-wband">{b.label}</text>
          ))}
          {points.map((p) => (
            <rect key={p.i} className="bal-hit" x={chart.X(p.i) - Math.max(chart.step, 4) / 2} y={0}
              width={Math.max(chart.step, 4)} height={chart.VBH}
              onMouseEnter={() => setHover(p.i)} onClick={() => setHover(p.i)} />
          ))}
        </svg>
        {!narrow && hovered && (
          <div className={'bal-tip' + (hx > chart.W * 0.55 ? ' flip' : '')}
            style={{ left: `${(hx / chart.W) * 100}%` }}>
            <b>{WD[(new Date(year, monthNo - 1, hovered.i + 1).getDay() + 6) % 7]}, {hovered.i + 1} {monGen}</b>
            <span className={'v' + (hovered.v < 0 ? ' neg' : '')}>остаток {signed(hovered.v)} с.</span>
            <span className="muted">{hoverMoves ? `за день ${hoverMoves}` : 'движения нет'}</span>
          </div>
        )}
      </div>
      {narrow && hovered && (
        <p className="bal-curve-read mini">
          <b>{hovered.i + 1} {monShort}</b>: остаток <b className={hovered.v < 0 ? 'neg' : ''}>{signed(hovered.v)}</b>
          {hoverMoves ? ` · ${hoverMoves}` : ''}
        </p>
      )}
      {narrow && !hovered && (
        <div className="bal-curve-keys mini">
          {facts.low.v < 0 && <span><i className="dot red" />дно {signed(facts.low.v)} · {facts.low.i + 1} {monShort}</span>}
          {facts.todayPoint && <span><i className="dot accent" />{mode === 'fact' ? 'сейчас' : 'сегодня'}</span>}
        </div>
      )}
    </div>
  );
}
