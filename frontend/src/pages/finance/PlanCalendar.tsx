// Денежный календарь «Планирования» — вариант А (выбор владельца 03.11.2026).
//
// Сверху итоги месяца: сколько придёт и уйдёт, сколько уже прошло и что
// просрочено. Под ними фильтры и подписанные значки статуса. В клетке — число
// дня и до трёх операций со значком: ✓ уже прошло, ○ ждём, ! просрочено,
// пунктир — не влияет на деньги (рассрочка из зарплаты). Остатка на конец дня
// и кривой остатка больше нет: владелец — «смысла в нём нет».
//
// На телефоне сетка 7×5 не вмещает текст операций, поэтому там итоги,
// мини-календарь с точками и список ближайших дней; день открывается шторкой.
import { useEffect, useMemo, useState } from 'react';
import { moneyBare, money, todayISO, pluralRu } from './finlib';
import CalendarItemModal from './CalendarItemModal';
import { FinModal } from './FinKit';
import './finance.css';
import { useHistoryOverlay } from '@/lib/navMemory';

type Status = 'done' | 'wait' | 'late' | 'note';
type Filter = 'all' | 'income' | 'expense' | 'open';

const DAY_LIMIT = 3;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MON_SHORT = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'income', label: 'Приходы' },
  { key: 'expense', label: 'Расходы' },
  { key: 'open', label: 'Только не сделанное' },
];
const STATUS_TEXT: Record<Status, string> = {
  done: 'уже прошло', wait: 'ждём', late: 'просрочено', note: 'не влияет на деньги',
};
const STATUS_ORDER: Record<Status, number> = { late: 0, wait: 1, note: 2, done: 3 };

/** Узкий экран — телефон и планшет в портрете. */
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

const titleOf = (t: any) => t.comment || t.categoryName || (t.type === 'income' ? 'Приход' : 'Расход');

/** Значок статуса: ✓ прошло, пустой круг — ждём, ! — просрочено, пунктир — пометка. */
function StatusMark({ s }: { s: Status }) {
  return <i className={`pln-st ${s}`} aria-hidden="true">{s === 'done' ? '✓' : s === 'late' ? '!' : ''}</i>;
}

function Amount({ t }: { t: any }) {
  if (t.type === 'note') return <span className="a note">{moneyBare(t.amount)}</span>;
  const inc = t.type === 'income';
  return <span className={`a ${inc ? 'inc' : 'exp'}`}>{inc ? '+' : '−'}{moneyBare(t.amount)}</span>;
}

export default function PlanCalendar({ ym, txns, lateOther = [], renderStatusControl, onMoveItem, canMoveItem }: {
  ym: string;
  txns: any[];
  /** Просроченное из других месяцев (08.11.2026): долги клиентов и наши
   *  платежи не пропадают из «Просрочено», когда месяц сменился. В итоги
   *  месяца не входят — только в карточку «Просрочено» и строку под итогами. */
  lateOther?: any[];
  renderStatusControl?: (item: any, close: () => void) => any;
  onMoveItem?: (item: any, dateISO: string) => void;
  canMoveItem?: (item: any) => boolean;
}) {
  const narrow = useNarrow();
  const [detail, setDetail] = useState<any>(null);
  const [sheetIso, setSheetIso] = useState<string | null>(null);
  // «Назад» закрывает шторку дня и карточку операции (08.11.2026); ушли из
  // карточки дальше («Открыть долги») — при возврате она снова открыта.
  useHistoryOverlay('pln-day', sheetIso, (v) => setSheetIso(v));
  useHistoryOverlay('pln-op', detail ? String(detail.id) : null, (v) => {
    setDetail(v ? ([...txns, ...lateOther].find((t) => String(t.id) === v) ?? null) : null);
  });
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIso, setOverIso] = useState<string | null>(null);
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
  const today = todayISO();
  const statusOf = (t: any): Status => {
    if (t.type === 'note') return 'note';
    if (t.done) return 'done';
    return effDate(t) < today ? 'late' : 'wait';
  };

  const [year, monthNo] = ym.split('-').map(Number);
  const firstIdx = (new Date(year, monthNo - 1, 1).getDay() + 6) % 7;   // Пн = 0
  const daysIn = new Date(year, monthNo, 0).getDate();
  const isoOf = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;
  const dayLabel = (iso: string) => `${Number(iso.slice(8))} ${MON_SHORT[Number(iso.slice(5, 7)) - 1] || ''}`;

  const cells: (string | null)[] = Array(firstIdx).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(isoOf(d));
  while (cells.length % 7) cells.push(null);

  const inMonth = useMemo(
    () => txns.filter((t) => t.status !== 'cancelled' && effDate(t).slice(0, 7) === ym),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns, ym, moveOverrides],
  );

  // ── Итоги месяца — по всем операциям, фильтр на них не влияет.
  const sum = useMemo(() => {
    let inc = 0, incDone = 0, exp = 0, expDone = 0;
    const late: any[] = [];
    for (const t of inMonth) {
      if (t.type !== 'income' && t.type !== 'expense') continue;
      const a = Number(t.amount) || 0;
      const s = statusOf(t);
      if (t.type === 'income') { inc += a; if (s === 'done') incDone += a; }
      else { exp += a; if (s === 'done') expDone += a; }
      if (s === 'late') late.push(t);
    }
    // Просроченное других месяцев: прошлые — отдельной строкой под итогами.
    const monthStart = `${ym}-01`;
    let prevInc = 0, prevExp = 0;
    const seen = new Set(late.map((t) => t.id));
    for (const t of lateOther) {
      if (seen.has(t.id) || t.done || effDate(t) >= today) continue;
      seen.add(t.id);
      late.push(t);
      if (effDate(t) < monthStart) {
        if (t.type === 'income') prevInc += Number(t.amount) || 0;
        else if (t.type === 'expense') prevExp += Number(t.amount) || 0;
      }
    }
    late.sort((a, b) => effDate(a).localeCompare(effDate(b)));
    const lateInc = late.filter((t) => t.type === 'income').reduce((a, t) => a + (Number(t.amount) || 0), 0);
    const lateExp = late.filter((t) => t.type === 'expense').reduce((a, t) => a + (Number(t.amount) || 0), 0);
    return { inc, incDone, exp, expDone, late, lateInc, lateExp, prevInc, prevExp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMonth, lateOther, today, ym]);
  const daysLate = (t: any) => Math.max(1, Math.round(
    (new Date(`${today}T00:00:00`).getTime() - new Date(`${effDate(t)}T00:00:00`).getTime()) / 86400000));

  // ── Операции по дням с учётом фильтра. В дне сверху просроченное и то,
  //    чего ждём, крупное выше; прошедшее — в конце.
  const byDay = useMemo(() => {
    const keep = (t: any) => {
      if (filter === 'income') return t.type === 'income';
      if (filter === 'expense') return t.type === 'expense';
      if (filter === 'open') { const s = statusOf(t); return s === 'wait' || s === 'late'; }
      return true;
    };
    const map = new Map<string, any[]>();
    for (const t of inMonth) {
      if (!keep(t)) continue;
      const k = effDate(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)] || (Number(b.amount) || 0) - (Number(a.amount) || 0));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMonth, filter, today]);

  const rowNode = (t: any) => {
    const s = statusOf(t);
    const movable = canMove(t);
    const title = titleOf(t);
    return (
      <div key={t.id} role="button" tabIndex={0}
        className={`pln-row ${s}${movable ? ' movable' : ''}${dragId === t.id ? ' dragging' : ''}`}
        title={`${title} · ${t.type === 'note' ? '' : money(t.amount) + ' · '}${STATUS_TEXT[s]}${movable ? ' · перетащите на другой день' : ''}`}
        draggable={movable}
        onDragStart={movable ? (e) => {
          setDragId(t.id); e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', t.id); } catch { /* noop */ }
        } : undefined}
        onDragEnd={() => { setDragId(null); setOverIso(null); }}
        onClick={() => setDetail(t)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(t); } }}>
        <StatusMark s={s} />
        <span className="t">{title}</span>
        <Amount t={t} />
        <span className="sr-only">, {STATUS_TEXT[s]}</span>
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

  // ── Итоги, фильтры, значки — общие для компьютера и телефона.
  const pct = (part: number, all: number) => `${all > 0 ? Math.min(100, Math.round((part / all) * 100)) : 0}%`;
  const summary = (
    <div className="pln-sum">
      <section className="card pln-tile" aria-label="Придёт">
        <span className="lb">Придёт в {MON_PREP[monthNo - 1]}</span>
        <span className="vl pos">+{money(sum.inc)}</span>
        <span className="sb">уже пришло {moneyBare(sum.incDone)} · ждём {moneyBare(sum.inc - sum.incDone)}</span>
        {sum.prevInc > 0.005 && <span className="sb late-prev">и ещё {money(sum.prevInc)} просрочено с прошлых месяцев</span>}
        <div className="progress"><i style={{ width: pct(sum.incDone, sum.inc), background: 'var(--green)' }} /></div>
      </section>
      <section className="card pln-tile" aria-label="Уйдёт">
        <span className="lb">Уйдёт в {MON_PREP[monthNo - 1]}</span>
        <span className="vl neg">−{money(sum.exp)}</span>
        <span className="sb">уже ушло {moneyBare(sum.expDone)} · осталось {moneyBare(sum.exp - sum.expDone)}</span>
        {sum.prevExp > 0.005 && <span className="sb late-prev">и ещё {money(sum.prevExp)} не оплачено с прошлых месяцев</span>}
        <div className="progress"><i style={{ width: pct(sum.expDone, sum.exp), background: 'var(--red)' }} /></div>
      </section>
      <section className={`card pln-tile${sum.late.length ? ' late' : ''}`} aria-label="Просрочено">
        <span className="lb">Просрочено</span>
        <span className={`vl ${sum.late.length ? 'neg' : 'pos'}`}>
          {sum.late.length ? pluralRu(sum.late.length, 'платёж', 'платежа', 'платежей') : 'нет'}
        </span>
        {sum.late.length ? (
          <>
            <span className="sb">
              {sum.lateInc > 0.005 && <>ждём <b className="pos">{moneyBare(sum.lateInc)}</b></>}
              {sum.lateInc > 0.005 && sum.lateExp > 0.005 && ' · '}
              {sum.lateExp > 0.005 && <>должны <b className="neg">{moneyBare(sum.lateExp)}</b></>}
            </span>
            {/* За все месяцы, от самого старого (08.11.2026). */}
            <span className="late-list">
              {sum.late.slice(0, 5).map((t) => (
                <button key={t.id} type="button" onClick={() => setDetail(t)}>
                  {dayLabel(effDate(t))}: {titleOf(t)} <Amount t={t} /> <span className="late-days">· {daysLate(t)} дн.</span>
                </button>
              ))}
              {sum.late.length > 5 && <span className="sb">ещё {sum.late.length - 5}</span>}
            </span>
          </>
        ) : <span className="sb">всё вовремя</span>}
      </section>
    </div>
  );
  const bar = (
    <div className="pln-bar">
      <div className="pln-chips" role="group" aria-label="Что показать в календаре">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={filter === f.key ? 'on' : ''} aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="pln-legend" aria-label="Значки">
        {(['done', 'wait', 'late', 'note'] as Status[]).map((s) => (
          <span key={s}><StatusMark s={s} />{STATUS_TEXT[s]}</span>
        ))}
      </div>
    </div>
  );

  // ── Телефон ──────────────────────────────────────────────────────────
  if (narrow) {
    const upcoming: string[] = [];
    const startDay = today.slice(0, 7) === ym ? Number(today.slice(8)) : 1;
    if (today.slice(0, 7) <= ym) {
      for (let d = startDay; d <= daysIn && upcoming.length < 4; d++) {
        if ((byDay.get(isoOf(d)) ?? []).length) upcoming.push(isoOf(d));
      }
    }
    return (
      <div className="pln pln-narrow">
        {summary}
        {bar}
        <div className="pln-mini">
          <div className="pln-mini-head">
            {WD.map((d, i) => <span key={d} className={i >= 5 ? 'wknd' : ''}>{d}</span>)}
          </div>
          <div className="pln-mini-body">
            {cells.map((iso, i) => {
              if (!iso) return <span key={i} className="pln-mini-cell off" />;
              const list = byDay.get(iso) ?? [];
              const hasInc = list.some((t) => t.type === 'income');
              const hasExp = list.some((t) => t.type === 'expense');
              const late = list.some((t) => statusOf(t) === 'late');
              return (
                <button key={iso} type="button"
                  className={'pln-mini-cell' + (iso === today ? ' today' : '') + (iso < today ? ' past' : '') + (late ? ' late' : '')}
                  onClick={() => setSheetIso(iso)}
                  aria-label={`${Number(iso.slice(8))} ${MON_GEN[monthNo - 1]}${list.length ? `, ${pluralRu(list.length, 'операция', 'операции', 'операций')}` : ''}${late ? ', есть просроченное' : ''}`}>
                  <span className="n">{Number(iso.slice(8))}</span>
                  <span className="dots">{hasInc && <i className="inc" />}{hasExp && <i className="exp" />}</span>
                </button>
              );
            })}
          </div>
        </div>

        {upcoming.length > 0 && (
          <div className="pln-next">
            <span className="muted mini">Ближайшие дни</span>
            {upcoming.map((iso) => {
              const list = byDay.get(iso) ?? [];
              return (
                <button key={iso} type="button" className="pln-next-day" onClick={() => setSheetIso(iso)}>
                  <span className="d">{iso === today ? 'Сегодня' : dayLabel(iso)}</span>
                  <span className="rows">
                    {list.slice(0, 3).map((t) => (
                      <span key={t.id} className={`r ${statusOf(t)}`}><StatusMark s={statusOf(t)} /><span className="t">{titleOf(t)}</span><Amount t={t} /></span>
                    ))}
                    {list.length > 3 && <span className="muted mini">ещё {list.length - 3}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {sheetIso && !detail && (
          <DaySheet iso={sheetIso} monthNo={monthNo} list={byDay.get(sheetIso) ?? []} statusOf={statusOf}
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
    <div className="pln">
      {summary}
      {bar}
      <div className="pln-cal">
        <div className="pln-wd">
          {WD.map((d, i) => <div key={d} className={i >= 5 ? 'wknd' : ''}>{d}</div>)}
        </div>
        <div className="pln-days">
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} className="pln-cell off" />;
            const list = byDay.get(iso) ?? [];
            const open = !!openDays[iso];
            const collapsible = list.length > DAY_LIMIT;
            const visible = collapsible && !open ? list.slice(0, DAY_LIMIT) : list;
            const isToday = iso === today;
            return (
              <div key={iso}
                className={'pln-cell' + (isToday ? ' today' : iso < today ? ' past' : '') + (i % 7 >= 5 ? ' wknd' : '')
                  + (overIso === iso && dragId ? ' over' : '')}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overIso !== iso) setOverIso(iso); } }}
                onDrop={drop(iso)}>
                <div className="pln-dayhead">
                  <span className="n">{Number(iso.slice(8))}</span>
                  {isToday && <span className="tag">сегодня</span>}
                </div>
                {visible.map((t: any) => rowNode(t))}
                {collapsible && (
                  <button type="button" className="pln-more"
                    onClick={() => setOpenDays((st) => ({ ...st, [iso]: !st[iso] }))}>
                    {open ? 'свернуть' : `ещё ${list.length - DAY_LIMIT}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {onMoveItem && <p className="mini muted fin-table-note">Нажмите операцию — откроется карточка с кнопкой «Получено» или «Оплачено». Перетащите её на другой день, чтобы перенести срок.</p>}

      {detail && <CalendarItemModal item={detail} planMode renderStatusControl={renderStatusControl}
        onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── Шторка дня (телефон) ───────────────────────────────────────────────
function DaySheet({ iso, monthNo, list, statusOf, canMove, onMove, onOpen, onClose }: {
  iso: string; monthNo: number; list: any[]; statusOf: (t: any) => Status;
  canMove: (t: any) => boolean; onMove: (t: any, iso: string) => void;
  onOpen: (t: any) => void; onClose: () => void;
}) {
  const d = Number(iso.slice(8));
  const wd = WD_LONG[(new Date(Number(iso.slice(0, 4)), monthNo - 1, d).getDay() + 6) % 7];
  const inc = list.filter((t) => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const exp = list.filter((t) => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return (
    <FinModal title={`${wd}, ${d} ${MON_GEN[monthNo - 1]}`} onClose={onClose} width={420}
      footer={<button className="btn ghost" onClick={onClose}>Закрыть</button>}>
      <div className="pln-sheet">
        {(inc > 0 || exp > 0) && (
          <div className="pln-sheet-tot">
            <div><span className="muted mini">приход</span><b className="pos">+{moneyBare(inc)}</b></div>
            <div><span className="muted mini">расход</span><b className="neg">−{moneyBare(exp)}</b></div>
          </div>
        )}
        {list.length === 0 && <p className="muted mini">В этот день движения денег нет.</p>}
        {list.map((t: any) => {
          const s = statusOf(t);
          return (
            <div key={t.id} className={`pln-sheet-row ${s}`}>
              <StatusMark s={s} />
              <button type="button" className="body" onClick={() => onOpen(t)}>
                <span className="t">{titleOf(t)}</span>
                <span className="s">{STATUS_TEXT[s]}</span>
              </button>
              <Amount t={t} />
              {canMove(t) && (
                <label className="move">
                  <span className="sr-only">Перенести на другой день</span>
                  <input type="date" value={iso} onChange={(e) => { if (e.target.value) { onMove(t, e.target.value); onClose(); } }} />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </FinModal>
  );
}
