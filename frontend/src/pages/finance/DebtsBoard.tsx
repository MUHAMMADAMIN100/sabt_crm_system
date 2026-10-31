// «Долги» (31.10.2026, вариант Б): долг — это не ежемесячный платёж.
// Должны человеку N — отдаём сразу всё или траншами, когда получается.
// Карточка на каждый долг: сколько осталось, что уже отдали, намеченные
// транши (по желанию, видны в «Планировании»). «Отдать» — любая сумма с
// любого счёта, это расход; отдали — ближайшие транши закрываются сами.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, todayISO, apiErr, pluralRu } from './finlib';
import { FinLoading, FinLoadError, FinModal, finConfirm, invalidateFinanceAll } from './FinKit';
import { DebtFormModal } from './FinForms';
import FinIcon from './FinIcon';
import type { FinDebtRow } from './types';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

/** «15 нояб.», «5 дек. 2027» — год только если не текущий. */
export function debtDay(iso: string, long = false): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const year = y !== Number(todayISO().slice(0, 4)) ? ` ${y}` : '';
  return `${d} ${(long ? MONTHS_GEN : MONTHS_SHORT)[m - 1]}${year}`;
}

/** Буква для кружка: «Долг Мухаммаду» → «М», «Сабина» → «С». */
const initial = (name: string) => (name.replace(/^долг\s+/i, '').trim()[0] || '·').toUpperCase();

export function DebtsList({ ym }: { ym: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const [debtFor, setDebtFor] = useState<FinDebtRow | 'new' | null>(null);
  const [payFor, setPayFor] = useState<{ row: FinDebtRow; preset?: number } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'debts', ym],
    queryFn: () => financeApi.expenseDetail('debts', ym),
  });

  if (isLoading) return <FinLoading />;
  if (isError) return <FinLoadError onRetry={refetch} />;

  const rows: FinDebtRow[] = data?.rows ?? [];
  const stats = data?.stats ?? { totalDebt: 0, count: 0, closedCount: 0, next: null, paidMonth: { amount: 0, count: 0, names: [] } };
  const active = rows.filter((r) => !r.closed);
  const closed = rows.filter((r) => r.closed);
  const shown = tab === 'active' ? active : closed;
  const today = todayISO();
  const next = stats.next;
  const nextLate = !!next && next.date < today;
  const monthIdx = Number(ym.slice(5, 7)) - 1;
  const whoOwed = active.slice(0, 3).map((r) => `${r.name} ${money(r.remaining)}`).join(' · ') + (active.length > 3 ? ` · ещё ${active.length - 3}` : '');

  async function remove(row: FinDebtRow) {
    const ok = await finConfirm(`Удалить долг «${row.name}»? Намеченные транши удалятся, уже отданное останется в журнале.`, { danger: true, confirmLabel: 'Удалить' });
    if (!ok) return;
    try {
      await financeApi.removeDebt(row.id);
      invalidateFinanceAll(qc);
    } catch (e) { toast.error(apiErr(e)); }
  }
  async function cancelPayment(row: FinDebtRow, p: FinDebtRow['payments'][number]) {
    const ok = await finConfirm(`Отменить «отдали ${money(p.amount)}» ${debtDay(p.date, true)}? Расход отменится, деньги вернутся на счёт${p.account ? ` «${p.account}»` : ''}. Закрытые этой оплатой транши не вернутся — поправьте план, если нужно.`, { danger: true, confirmLabel: 'Отменить оплату' });
    if (!ok) return;
    try {
      await financeApi.cancelDebtPayment(row.id, p.txId);
      invalidateFinanceAll(qc);
    } catch (e) { toast.error(apiErr(e)); }
  }

  return (
    <>
      <div className="fin-dbt-tiles">
        <div>
          <span className="lb">Всего должны</span>
          <span className="vl">{money(stats.totalDebt)}</span>
          <span className="sb">{active.length ? whoOwed : 'долгов нет'}</span>
        </div>
        <div>
          <span className="lb">Ближайший транш</span>
          <span className={'vl ' + (next ? (nextLate ? 'late' : 'soon') : '')}>{next ? `${debtDay(next.date)} · ${money(next.amount)}` : '—'}</span>
          <span className="sb">{next ? `${next.name} · ${nextLate ? 'просрочен' : 'по плану'}` : 'транши не намечены'}</span>
        </div>
        <div>
          <span className="lb">Отдали в {MONTHS_PREP[monthIdx] ?? 'этом месяце'}</span>
          <span className="vl">{money(stats.paidMonth.amount)}</span>
          <span className="sb">{stats.paidMonth.count ? `${pluralRu(stats.paidMonth.count, 'платёж', 'платежа', 'платежей')} ·${stats.paidMonth.names.join(', ')}` : 'пока ничего'}</span>
        </div>
      </div>

      <div className="fin-dbt-bar">
        <div className="fin-dbt-tabs" role="tablist" aria-label="Долги">
          <button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'on' : ''} onClick={() => setTab('active')}>Активные · {active.length}</button>
          <button type="button" role="tab" aria-selected={tab === 'closed'} className={tab === 'closed' ? 'on' : ''} onClick={() => setTab('closed')}>Закрытые · {closed.length}</button>
        </div>
        <button className="btn primary" onClick={() => setDebtFor('new')}><FinIcon name="plus" size={16} /> Новый долг</button>
      </div>

      {shown.length === 0 ? (
        <div className="card empty">
          <div className="big"><FinIcon name="checkCircle" size={30} /></div>
          {tab === 'active' ? 'Долгов нет — нажмите «＋ Новый долг»' : 'Закрытых долгов пока нет'}
        </div>
      ) : (
        <div className="fin-dbt-grid">
          {shown.map((r) => (
            <DebtCard key={r.id} row={r}
              onPay={(preset) => setPayFor({ row: r, preset })}
              onEdit={() => setDebtFor(r)}
              onRemove={() => remove(r)}
              onCancelPayment={(p) => cancelPayment(r, p)} />
          ))}
        </div>
      )}

      {payFor && <DebtPayModal row={payFor.row} preset={payFor.preset} onClose={() => setPayFor(null)} />}
      {debtFor && <DebtFormModal debt={debtFor === 'new' ? undefined : debtFor} onClose={() => setDebtFor(null)} />}
    </>
  );
}

function DebtCard({ row, onPay, onEdit, onRemove, onCancelPayment }: {
  row: FinDebtRow;
  onPay: (preset?: number) => void;
  onEdit: () => void;
  onRemove: () => void;
  onCancelPayment: (p: FinDebtRow['payments'][number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const today = todayISO();
  const given = Math.max(0, row.totalAmount - row.remaining);
  const pct = row.totalAmount > 0 ? Math.min(100, Math.round((given / row.totalAmount) * 1000) / 10) : 0;
  const pays = row.payments;
  const paidSum = pays.reduce((s, p) => s + p.amount, 0);
  const firstPay = pays[0]?.date;
  const lastPay = pays[pays.length - 1]?.date;
  const sameAmount = pays.length > 1 && pays.every((p) => Math.abs(p.amount - pays[0].amount) < 0.005);
  const plannedSum = row.tranches.reduce((s, t) => s + t.amount, 0);
  const sub = row.note || (firstPay ? `отдаём с ${MONTHS_GEN[Number(firstPay.slice(5, 7)) - 1]}` : '');
  const period = firstPay && lastPay
    ? (firstPay.slice(0, 7) === lastPay.slice(0, 7) ? MONTHS_NOM[Number(firstPay.slice(5, 7)) - 1] : `${MONTHS_NOM[Number(firstPay.slice(5, 7)) - 1]} — ${MONTHS_NOM[Number(lastPay.slice(5, 7)) - 1]}`)
    : '';

  return (
    <div className={'fin-dbt-card' + (row.overdue ? ' late' : '') + (row.closed ? ' closed' : '')}>
      <div className="fin-dbt-head">
        <span className="av" aria-hidden="true">{initial(row.name)}</span>
        <div className="who">
          <b>{row.name}</b>
          {sub && <span>{sub}</span>}
        </div>
        {row.closed ? <span className="chip ok">закрыт</span>
          : row.dueDate ? <span className={'chip' + (row.overdue ? ' late' : '')}>{row.overdue ? `просрочен · до ${debtDay(row.dueDate)}` : `вернуть до ${debtDay(row.dueDate)}`}</span>
          : <span className="chip mute">без срока</span>}
      </div>

      <div className="fin-dbt-rem">
        <div><span className="lb">{row.closed ? 'Отдали' : 'Осталось отдать'}</span><span className="big">{money(row.closed ? row.totalAmount : row.remaining)}</span></div>
        <span className="of">отдали {money(given)} из {money(row.totalAmount)}</span>
      </div>
      <div className="progress fin-dbt-progress"><i style={{ width: pct + '%' }} /></div>

      <div className="fin-dbt-list">
        <div className="fin-dbt-lh"><span>ТРАНШИ</span><span>{row.closed ? '' : row.tranches.length ? 'можно отдать и раньше' : 'план не намечен — отдаёте, когда получится'}</span></div>

        {pays.length === 0 && row.paidBefore <= 0 && (
          <div className="fin-dbt-tr mute"><span className="dot dashed" /><span>—</span><span>ещё не отдавали</span><span /></div>
        )}
        {row.paidBefore > 0 && (
          <div className="fin-dbt-tr done"><span className="ok"><FinIcon name="check" size={12} /></span><span>раньше</span><span className="mu">отдали до записи в CRM</span><b>{money(row.paidBefore)}</b></div>
        )}
        {pays.length > 0 && (
          <button type="button" className="fin-dbt-tr done btn-row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="ok"><FinIcon name="check" size={12} /></span>
            <span>{pays.length === 1 ? debtDay(pays[0].date) : `${pays.length} отдано`}</span>
            <span className="mu">{pays.length === 1 ? (pays[0].account || 'отдали') : `${period}${sameAmount ? `, по ${money(pays[0].amount)}` : ''}`} · {open ? 'скрыть ⌃' : 'показать ⌄'}</span>
            <b>{money(paidSum)}</b>
          </button>
        )}
        {open && pays.map((p) => (
          <div key={p.txId} className="fin-dbt-tr done sub">
            <span />
            <span>{debtDay(p.date)}</span>
            <span className="mu">{p.account || '—'} · <button type="button" className="fin-dbt-link danger" onClick={() => onCancelPayment(p)}>отменить</button></span>
            <b>{money(p.amount)}</b>
          </div>
        ))}

        {!row.closed && row.tranches.map((t, i) => {
          const late = t.date < today;
          const closes = i === row.tranches.length - 1 && Math.abs(plannedSum - row.remaining) < 0.005;
          return (
            <button key={t.id} type="button" className={'fin-dbt-tr btn-row' + (late ? ' late' : '')} title="Отдать этот транш" onClick={() => onPay(t.amount)}>
              <span className={'dot' + (i === 0 ? (late ? ' late' : ' next') : '')} />
              <span>{debtDay(t.date)}</span>
              {i === 0 ? <span><em className={'tag' + (late ? ' late' : '')}>{late ? 'просрочен' : 'ближайший'}</em>{closes ? <span className="mu"> · закроет долг</span> : null}</span>
                : <span className="mu">по плану{closes ? ' · закроет долг' : ''}</span>}
              <b>{money(t.amount)}</b>
            </button>
          );
        })}
        {!row.closed && row.tranches.length > 0 && row.unplanned > 0.005 && (
          <div className="fin-dbt-tr mute"><span className="dot dashed" /><span>—</span><span>без даты — когда получится</span><b>{money(row.unplanned)}</b></div>
        )}
      </div>

      <div className="fin-dbt-acts">
        {!row.closed && <button className="btn primary" onClick={() => onPay()}>Отдать</button>}
        <button className="btn" onClick={onEdit}>{row.closed ? 'Изменить' : 'Изменить план'}</button>
        <div className="fin-dbt-more">
          <button type="button" className="btn ghost" aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu((v) => !v)} onBlur={() => setTimeout(() => setMenu(false), 150)}>⋯</button>
          {menu && (
            <div className="fin-dbt-menu" role="menu">
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); onRemove(); }}>Удалить долг</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Отдать: сразу всё или часть — с какого счёта и когда. */
function DebtPayModal({ row, preset, onClose }: { row: FinDebtRow; preset?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accData } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  const accounts: any[] = useMemo(() => (accData ?? []).filter((a: any) => !a.archived), [accData]);
  const remaining = row.remaining;
  const nextT = row.tranches[0];
  const showTranche = !!nextT && Math.abs(nextT.amount - remaining) > 0.005;
  const initialChoice: 'tranche' | 'all' | 'other' = preset != null
    ? (Math.abs(preset - remaining) < 0.005 ? 'all' : showTranche && Math.abs(preset - nextT.amount) < 0.005 ? 'tranche' : 'other')
    : (showTranche ? 'tranche' : 'all');
  const [choice, setChoice] = useState(initialChoice);
  const [amount, setAmount] = useState(String(preset ?? (initialChoice === 'tranche' ? nextT.amount : remaining)));
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = Math.round((parseFloat(amount.replace(',', '.').replace(/\s/g, '')) || 0) * 100) / 100;
  const over = amt > remaining + 0.005;
  const left = Math.max(0, Math.round((remaining - amt) * 100) / 100);
  const future = date > todayISO();
  const accName = accounts.find((a) => a.id === accountId)?.name ?? '';
  // Что будет ближайшим траншем после этой оплаты (отдали — закрываются ближайшие).
  let rest = amt;
  let after: { date: string; amount: number } | null = null;
  for (const t of row.tranches) {
    if (rest >= t.amount - 0.005) { rest -= t.amount; continue; }
    after = { date: t.date, amount: Math.round((t.amount - rest) * 100) / 100 };
    break;
  }
  const can = amt > 0 && !over && !!accountId && !future && !busy;

  function pick(c: 'tranche' | 'all' | 'other') {
    setChoice(c);
    if (c === 'tranche' && nextT) setAmount(String(nextT.amount));
    if (c === 'all') setAmount(String(remaining));
  }

  async function submit() {
    if (!can) return;
    setBusy(true);
    try {
      await financeApi.payDebt(row.id, { amount: amt, accountId, date });
      invalidateFinanceAll(qc);
      toast.success(left <= 0.005 ? `Долг «${row.name}» закрыт` : `Записали: отдали ${money(amt)}`);
      onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }

  return (
    <FinModal title={`Отдать · ${row.name}`} onClose={onClose} width={560}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!can} onClick={submit}>{busy ? 'Записываю…' : `Отдать ${amt > 0 ? money(amt) : ''}`}</button>
      </>}>
      <span className="mini muted">осталось {money(remaining)}</span>
      <div className="field">
        <label>Сколько отдаём</label>
        <div className={'fin-inst-method' + (showTranche ? ' three' : '')} role="radiogroup" aria-label="Сколько отдаём">
          {showTranche && (
            <button type="button" role="radio" aria-checked={choice === 'tranche'} className={choice === 'tranche' ? 'on' : ''} onClick={() => pick('tranche')}>
              <b>{money(nextT.amount)}</b><span>транш на {debtDay(nextT.date)}</span>
            </button>
          )}
          <button type="button" role="radio" aria-checked={choice === 'all'} className={choice === 'all' ? 'on' : ''} onClick={() => pick('all')}>
            <b>{money(remaining)}</b><span>всё сразу — закрыть</span>
          </button>
          <button type="button" role="radio" aria-checked={choice === 'other'} className={choice === 'other' ? 'on' : ''} onClick={() => pick('other')}>
            <b>Другая сумма</b><span>сколько есть сейчас</span>
          </button>
        </div>
      </div>
      <div className="fin-inst-row3">
        <div className="field"><label>Сумма</label>
          <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setChoice('other'); }} />
        </div>
        <div className="field"><label>Со счёта</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Дата</label><input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {over ? (
        <p className="mini neg" style={{ margin: 0 }}>Это больше, чем осталось отдать: {money(remaining)}.</p>
      ) : future ? (
        <p className="mini neg" style={{ margin: 0 }}>«Отдать» записывает то, что уже отдали. Будущий платёж добавьте траншем в «Изменить план».</p>
      ) : amt > 0 ? (
        <div className="fin-dbt-will">
          <b>{money(amt)}</b> уйдут расходом{accName ? ` с «${accName}»` : ''} {debtDay(date, true)}.{' '}
          {left <= 0.005 ? <>Долг закроется и уйдёт в «Закрытые».</> : <>Останется <b>{money(left)}</b>{after ? <> — следующий транш {debtDay(after.date, true)}{Math.abs(after.amount - (row.tranches.find((t) => t.date === after!.date)?.amount ?? after.amount)) > 0.005 ? `, станет ${money(after.amount)}` : ''}.</> : '.'}</>}
        </div>
      ) : null}
    </FinModal>
  );
}
