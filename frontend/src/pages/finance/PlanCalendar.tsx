// Денежный календарь «Планирования» — вариант В: кривая остатка над тихой
// сеткой (выбран владельцем 30.09.2026, до этого был вариант А).
//
// Два слоя: кривая отвечает «когда и насколько кончатся деньги», сетка под
// ней — «что именно в этот день». В клетке только остаток дня и два самых
// крупных платежа, остальное под «ещё N» — клетка читается с одного взгляда.
//
// Вид строк и цвета — как в «Транзакциях» (тоже решение владельца): точка и
// сумма зелёные у прихода, красные у расхода. Чего нет в «Транзакциях» —
// плана, — показано пустым кружком: ещё не пришло или не оплачено. Раньше
// сделанное зачёркивалось, и прошедшая половина месяца превращалась в полосы.
// День в минусе — красная черта слева, первый такой день — янтарная.
//
// На телефоне сетка 7×5 не вмещает текст операций (клетка ~50 px), поэтому
// роли разделены: сетка остаётся обзором (число + уровень), читают в списке
// дня, а операции открываются шторкой.
import { useEffect, useMemo, useState } from 'react';
import { moneyBare, money, todayISO, pluralRu } from './finlib';
import CalendarItemModal from './CalendarItemModal';
import { FinModal } from './FinKit';
import BalanceCurve from './BalanceCurve';
import './finance.css';

/** Вариант В: в клетке два самых крупных платежа, остальное — под «ещё N». */
const DAY_LIMIT = 2;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Сумма со знаком и типографским минусом, без «с.» — для плотных ячеек. */
const signed = (v: number): string => (v < 0 ? '−' : '') + moneyBare(Math.abs(v));

/** Узкий экран — телефон и планшет в портрете. Порог 900, а не 760: при
 *  семи колонках дня плюс колонка недели клетка уже́ 760 px становится ~85 px,
 *  и названия операций в ней не прочитать. */
function useNarrow(max = 900): boolean {
  const query = `(max-width: ${max}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}

export default function PlanCalendar({ ym, txns, dayBalance, renderStatusControl, onMoveItem, canMoveItem }: {
  ym: string;
  txns: any[];
  /** Остаток денег на конец каждого дня ('YYYY-MM-DD' → сумма). Есть только
   *  для текущего месяца: у прошлых и будущих нет честной точки отсчёта. */
  dayBalance?: Map<string, number>;
  renderStatusControl?: (item: any, close: () => void) => any;
  onMoveItem?: (item: any, dateISO: string) => void;
  canMoveItem?: (item: any) => boolean;
}) {
  const narrow = useNarrow();
  const [detail, setDetail] = useState<any>(null);
  const [sheetIso, setSheetIso] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIso, setOverIso] = useState<string | null>(null);
  // День под курсором на кривой — подсвечиваем его в сетке.
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  // Оптимистичный сдвиг: {id → новая дата}. Операция сразу рисуется на новом
  // дне и держится, пока перезагруженные данные не догонят.
  const [moveOverrides, setMoveOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    setMoveOverrides((prev) => {
      if (!Object.keys(prev).length) return prev;
      let changed = false; const next = { ...prev };
      for (const t of txns) {
        if (next[t.id] && String(t.date || '').slice(0, 10) === next[t.id]) { delete next[t.id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [txns]);

  const canMove = (t: any) => !!onMoveItem && (!canMoveItem || canMoveItem(t));
  const effDate = (t: any) => moveOverrides[t.id] || String(t.date || '').slice(0, 10);

  const [year, monthNo] = ym.split('-').map(Number);
  const firstIdx = (new Date(year, monthNo - 1, 1).getDay() + 6) % 7;   // Пн = 0
  const daysIn = new Date(year, monthNo, 0).getDate();
  const isoOf = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;
  const monShort = MON_SHORT[monthNo - 1] || '';
  const today = todayISO();

  const cells: (string | null)[] = Array(firstIdx).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(isoOf(d));
  while (cells.length % 7) cells.push(null);

  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of txns) {
      const k = moveOverrides[t.id] || String(t.date || '').slice(0, 10);
      if (k.slice(0, 7) !== ym) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    // Крупное — выше: в клетке видно две строки, и это должны быть самые
    // заметные деньги дня, а не те, что первыми пришли из API.
    for (const list of map.values()) {
      list.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    }
    return map;
  }, [txns, ym, moveOverrides]);

  const dayTot = useMemo(() => {
    const map = new Map<string, { inc: number; exp: number }>();
    let count = 0, inc = 0, exp = 0;
    for (const [k, list] of byDay) {
      const t = { inc: 0, exp: 0 };
      for (const x of list) {
        if (x.status === 'cancelled') continue;
        const amount = Number(x.amount) || 0;
        if (x.type === 'income') t.inc += amount;
        else if (x.type === 'expense') t.exp += amount;
      }
      map.set(k, t);
      inc += t.inc; exp += t.exp;
      count += list.length;
    }
    // Итог месяца — всё движение вместе, и факт, и план: в «Планировании»
    // смысл ровно в этом, отделять прошедшее незачем.
    return { map, count, inc, exp };
  }, [byDay]);

  // ── Остатки по дням: для телефона (остаток сегодня, «не хватает», мини-сетка)
  //    и янтарной метки первого дня в минусе. Кривую рисует BalanceCurve.
  const balances = useMemo(() => {
    if (!dayBalance) return null;
    const out: number[] = [];
    for (let d = 1; d <= daysIn; d++) {
      const v = dayBalance.get(isoOf(d));
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      out.push(v);
    }
    return out;
  }, [dayBalance, ym, daysIn]);

  const facts = useMemo(() => {
    if (!balances) return null;
    let firstNeg = -1, lastNeg = -1, lowIdx = 0;
    balances.forEach((v, i) => {
      if (v < 0) { if (firstNeg < 0) firstNeg = i; lastNeg = i; }
      if (v < balances[lowIdx]) lowIdx = i;
    });
    const todayIdx = today.slice(0, 7) === ym ? Number(today.slice(8)) - 1 : -1;
    return {
      firstNeg, lastNeg, lowIdx, low: balances[lowIdx],
      end: balances[balances.length - 1],
      todayIdx, todayBal: todayIdx >= 0 ? balances[todayIdx] : null,
      negDays: balances.filter((v) => v < 0).length,
    };
  }, [balances, ym, today]);

  const gapIso = facts && facts.firstNeg >= 0 ? isoOf(facts.firstNeg + 1) : null;

  // ── Клетка дня ───────────────────────────────────────────────────────
  // Полоса уровня в мини-сетке телефона: самый большой остаток месяца =
  // 100% ширины, так сетка читается как тот же график, что нарисован выше.
  const maxAbs = useMemo(
    () => (balances ? Math.max(...balances.map((v) => Math.abs(v)), 1) : 1),
    [balances],
  );
  const dayView = (iso: string) => {
    const list = byDay.get(iso) ?? [];
    const bal = dayBalance?.get(iso);
    const neg = typeof bal === 'number' && bal < 0;
    const tot = dayTot.map.get(iso);
    const max = maxAbs;
    return {
      list, bal, neg, tot,
      isToday: iso === today,
      isGap: iso === gapIso,
      width: typeof bal === 'number' ? `${Math.max(3, Math.round((Math.abs(bal) / max) * 100))}%` : '0%',
    };
  };

  const rowNode = (t: any, key: string) => {
    const income = t.type === 'income';
    const movable = canMove(t);
    const title = t.comment || t.categoryName || (income ? 'Приход' : 'Расход');
    const pending = !t.done;
    return (
      <div key={key} role="button" tabIndex={0}
        className={'pcal-row ' + (income ? 'inc' : 'exp') + (pending ? ' plan' : '') + (movable ? ' movable' : '') + (dragId === t.id ? ' dragging' : '')}
        title={`${pending ? (income ? 'Ещё не пришло · ' : 'Ещё не оплачено · ') : ''}${title} · ${money(t.amount)}${movable ? ' · перетащите на другой день' : ''}`}
        draggable={movable}
        onDragStart={movable ? (e) => {
          setDragId(t.id); e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', t.id); } catch { /* noop */ }
        } : undefined}
        onDragEnd={() => { setDragId(null); setOverIso(null); }}
        onClick={() => setDetail(t)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(t); } }}>
        <i className="d" />
        <span className="t">{title}</span>
        <span className="a">{income ? '+' : '−'}{moneyBare(t.amount)}</span>
      </div>
    );
  };

  const drop = (iso: string) => (e: any) => {
    if (!dragId) return;
    e.preventDefault();
    const it = txns.find((x: any) => x.id === dragId);
    setDragId(null); setOverIso(null);
    if (!it || !onMoveItem || effDate(it) === iso) return;
    const movedId = it.id;
    setMoveOverrides((o) => ({ ...o, [movedId]: iso }));
    Promise.resolve(onMoveItem(it, iso)).catch(() => {
      setMoveOverrides((o) => { const next = { ...o }; delete next[movedId]; return next; });
    });
  };

  const moveTo = (t: any, iso: string) => {
    if (!onMoveItem || !iso || effDate(t) === iso) return;
    setMoveOverrides((o) => ({ ...o, [t.id]: iso }));
    Promise.resolve(onMoveItem(t, iso)).catch(() => {
      setMoveOverrides((o) => { const next = { ...o }; delete next[t.id]; return next; });
    });
  };

  // ── Телефон ──────────────────────────────────────────────────────────
  if (narrow) {
    const upcoming: string[] = [];
    for (let d = (facts && facts.todayIdx >= 0 ? facts.todayIdx + 2 : 1); d <= daysIn && upcoming.length < 3; d++) {
      if ((byDay.get(isoOf(d)) ?? []).length) upcoming.push(isoOf(d));
    }
    return (
      <div className="pcal pcal-narrow">
        {facts && (
          <div className="pcal-hero">
            <span className="muted mini">Остаток сегодня</span>
            <strong className={facts.todayBal != null && facts.todayBal < 0 ? 'neg' : ''}>
              {facts.todayBal == null ? '—' : `${signed(facts.todayBal)} с.`}
            </strong>
            <span className="muted mini">
              на конец месяца <b className={facts.end < 0 ? 'neg' : 'pos'}>{signed(facts.end)}</b>
            </span>
          </div>
        )}

        {facts && facts.firstNeg >= 0 && (
          <div className="pcal-warn">
            <i />
            <span>
              Денег не хватает <b>с {facts.firstNeg + 1} по {facts.lastNeg + 1} {MON_GEN[monthNo - 1]}</b>
              {' · '}дно <b className="neg">{signed(facts.low)} с.</b>
            </span>
          </div>
        )}

        {dayBalance && <BalanceCurve ym={ym} mode="plan" balances={dayBalance} narrow dayTotals={dayTot.map} />}

        <div className="pcal-mini">
          <div className="pcal-mini-head">
            {WD.map((d, i) => <span key={d} className={i >= 5 ? 'wknd' : ''}>{d}</span>)}
          </div>
          <div className="pcal-mini-body">
            {cells.map((iso, i) => {
              if (!iso) return <span key={i} className="pcal-mini-cell off" />;
              const v = dayView(iso);
              return (
                <button key={iso} type="button"
                  className={'pcal-mini-cell' + (v.neg ? ' neg' : '') + (v.isToday ? ' today' : '') + (v.isGap ? ' gap' : '') + (i % 7 >= 5 ? ' wknd' : '')}
                  onClick={() => setSheetIso(iso)}
                  aria-label={`${Number(iso.slice(8))} ${MON_GEN[monthNo - 1]}${typeof v.bal === 'number' ? `, остаток ${signed(v.bal)}` : ''}`}>
                  <span className="n">{Number(iso.slice(8))}</span>
                  <span className="lvl">
                    <i style={{ width: v.width }} className={v.neg ? 'neg' : 'pos'} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {upcoming.length > 0 && (
          <div className="pcal-next">
            <span className="muted mini">Дальше в этом месяце</span>
            {upcoming.map((iso) => {
              const tot = dayTot.map.get(iso)!;
              const list = byDay.get(iso) ?? [];
              const net = tot.inc - tot.exp;
              return (
                <button key={iso} type="button" className="pcal-next-row" onClick={() => setSheetIso(iso)}>
                  <span className="d">{Number(iso.slice(8))} {monShort}</span>
                  <span className="t">{list.map((x: any) => x.comment || x.categoryName).filter(Boolean).slice(0, 2).join(', ') || 'Операции дня'}</span>
                  <span className={'a ' + (net >= 0 ? 'pos' : '')}>{net >= 0 ? '+' : '−'}{moneyBare(Math.abs(net))}</span>
                </button>
              );
            })}
          </div>
        )}

        <p className="mini muted fin-table-note">Нажмите день — откроется карточка с операциями</p>

        {sheetIso && !detail && (
          <DaySheet iso={sheetIso} monthNo={monthNo} list={byDay.get(sheetIso) ?? []}
            tot={dayTot.map.get(sheetIso)} bal={dayBalance?.get(sheetIso)}
            isGap={sheetIso === gapIso}
            backDay={facts && facts.lastNeg >= 0 && facts.lastNeg + 2 <= daysIn ? facts.lastNeg + 2 : null}
            canMove={canMove} onMove={moveTo} onOpen={(t) => setDetail(t)}
            onClose={() => setSheetIso(null)} />
        )}
        {detail && <CalendarItemModal item={detail} planMode renderStatusControl={renderStatusControl}
          onClose={() => setDetail(null)} />}
      </div>
    );
  }

  // ── Компьютер ────────────────────────────────────────────────────────
  return (
    <div className="pcal">
      <BalanceCurve ym={ym} mode="plan" balances={dayBalance} dayTotals={dayTot.map} onHoverDay={setHoverIso}
        emptyNote="Остаток по дням считаем только для текущего месяца: от сегодняшних денег видно и вперёд, и назад. Для других месяцев честной точки отсчёта нет." />

      <div className="pcal-grid">
        <div className="pcal-top">
          <div className="sums">
            <span className="pos">+{money(dayTot.inc)}</span>
            <span className="neg">−{money(dayTot.exp)}</span>
            <span className={'net' + (dayTot.inc - dayTot.exp < 0 ? ' neg' : '')}>
              {money(dayTot.inc - dayTot.exp, true)}
            </span>
          </div>
          <span className="mini muted">
            {dayTot.count} {pluralRu(dayTot.count, 'операция', 'операции', 'операций')} за месяц
          </span>
        </div>
        <div className="pcal-row-head">
          {WD.map((d, i) => <div key={d} className={'pcal-h' + (i >= 5 ? ' wknd' : '')}>{d}</div>)}
        </div>
        <div className="pcal-days">
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} className="pcal-cell off" />;
            const v = dayView(iso);
            const list = v.list;
            const open = !!openDays[iso];
            const collapsible = list.length > DAY_LIMIT;
            const visible = collapsible && !open ? list.slice(0, DAY_LIMIT) : list;
            return (
              <div key={iso}
                className={'pcal-cell' + (v.neg ? ' neg' : '') + (v.isGap ? ' gap' : '') + (v.isToday ? ' today' : '')
                  + (i % 7 >= 5 ? ' wknd' : '') + (hoverIso === iso ? ' hl' : '') + (overIso === iso && dragId ? ' over' : '')}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overIso !== iso) setOverIso(iso); } }}
                onDrop={drop(iso)}>
                <div className="pcal-dayhead">
                  <span className="n">{Number(iso.slice(8))}</span>
                  {typeof v.bal === 'number' && (
                    <span className={'bal' + (v.neg ? ' neg' : '')}
                      title={`Остаток на конец дня · ${money(v.bal)}`}>{signed(v.bal)}</span>
                  )}
                </div>
                {visible.map((t: any) => rowNode(t, t.id))}
                {collapsible && (
                  <button type="button" className="pcal-more"
                    onClick={() => setOpenDays((st) => ({ ...st, [iso]: !st[iso] }))}>
                    {open ? 'свернуть' : `ещё ${list.length - DAY_LIMIT}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="pcal-legend mini">
        <span><i className="sw inc" />приход</span>
        <span><i className="sw out" />расход</span>
        <span><i className="sw plan" />ещё не пришло или не оплачено</span>
        <span><i className="sw neg" />день в минусе</span>
        <span><i className="sw gap" />день, когда деньги кончились</span>
        {onMoveItem && <span className="pcal-legend-note">Перетащите операцию на другой день, чтобы перенести срок.</span>}
      </div>

      {detail && <CalendarItemModal item={detail} planMode renderStatusControl={renderStatusControl}
        onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── Шторка дня (телефон) ───────────────────────────────────────────────
function DaySheet({ iso, monthNo, list, tot, bal, isGap, backDay, canMove, onMove, onOpen, onClose }: {
  iso: string; monthNo: number; list: any[]; tot?: { inc: number; exp: number };
  bal?: number; isGap: boolean; backDay: number | null;
  canMove: (t: any) => boolean; onMove: (t: any, iso: string) => void;
  onOpen: (t: any) => void; onClose: () => void;
}) {
  const d = Number(iso.slice(8));
  const wd = WD_LONG[(new Date(Number(iso.slice(0, 4)), monthNo - 1, d).getDay() + 6) % 7];
  return (
    <FinModal title={`${wd}, ${d} ${MON_GEN[monthNo - 1]}`} onClose={onClose} width={420}
      footer={<button className="btn ghost" onClick={onClose}>Закрыть</button>}>
      <div className="pcal-sheet">
        {typeof bal === 'number' && (
          <div className="pcal-sheet-bal">
            <span className="muted mini">остаток на конец дня</span>
            <strong className={bal < 0 ? 'neg' : ''}>{signed(bal)}</strong>
          </div>
        )}

        {isGap && (
          <div className="pcal-warn">
            <i />
            <span>С этого дня денег не хватает{backDay ? <>. Вернётесь в плюс <b>{backDay} {MON_GEN[monthNo - 1]}</b>.</> : '.'}</span>
          </div>
        )}

        {tot && (tot.inc > 0 || tot.exp > 0) && (
          <div className="pcal-sheet-tot">
            <div><span className="muted mini">пришло</span><b className="pos">+{moneyBare(tot.inc)}</b></div>
            <div><span className="muted mini">ушло</span><b>−{moneyBare(tot.exp)}</b></div>
          </div>
        )}

        <div className="pcal-sheet-list">
          <span className="muted mini">Операции дня</span>
          {list.length === 0 && <p className="muted mini">В этот день движения денег нет.</p>}
          {list.map((t: any) => (
            <div key={t.id} className={'pcal-sheet-row' + (t.type === 'income' ? ' inc' : '') + (t.done ? ' done' : '')}>
              <i className="bar" />
              <button type="button" className="body" onClick={() => onOpen(t)}>
                <span className="t">{t.comment || t.categoryName || (t.type === 'income' ? 'Приход' : 'Расход')}</span>
                <span className="s muted mini">{t.done ? 'уже прошло' : 'ожидается'}</span>
              </button>
              <span className="a">{t.type === 'income' ? '+' : '−'}{moneyBare(t.amount)}</span>
              {canMove(t) && (
                <label className="move">
                  <span className="sr-only">Перенести операцию на другой день</span>
                  <input type="date" value={iso} onChange={(e) => { if (e.target.value) { onMove(t, e.target.value); onClose(); } }} />
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
    </FinModal>
  );
}
