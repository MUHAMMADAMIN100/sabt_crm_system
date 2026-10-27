// Рассрочки сотрудников (/finance/expense/installments). Компания купила
// сотруднику вещь, деньги возвращаются частями. Решения владельца:
// 26.10.2026 — своя карточка на «Расходе» + колонка «Рассрочка» в ведомости;
// 27.10.2026 — вид «карточки» (вариант А), у каждой рассрочки свой способ:
// «из зарплаты» (удерживаем в день выплаты ЗП, 10-го) или «платит отдельно»
// (к своему числу месяца, владелец отмечает «получено»); просрочка красным.
// Менять может только владелец, сотрудник видит своё в профиле.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, moneyBare, monthLabel, shiftYm, todayISO, currentYm, apiErr, pluralRu, formatDate } from './finlib';
import { FinLoading, FinLoadError, FinModal, finConfirm, invalidateFinance } from './FinKit';
import FinIcon from './FinIcon';

export const INSTALLMENT_COLOR = '#47aaa4';
/** День выплаты зарплаты — в этот день удерживается рассрочка «из зарплаты». */
const SALARY_PAY_DAY = 10;

const num = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

type Entry = {
  ym: string; date: string; amount: number; paid: number; outstanding: number;
  status: 'done' | 'planned' | 'overdue' | 'waiting' | 'skip'; frozen: boolean; custom: boolean;
};

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** «10 ноября», «5 сент. 2027» — год только если не текущий. */
function dayLabel(iso: string, short = false): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const year = y !== Number(todayISO().slice(0, 4)) ? ` ${y}` : '';
  return `${d} ${(short ? MONTHS_SHORT : MONTHS_GEN)[m - 1]}${year}`;
}

const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

/** Дата платежа за месяц ym по правилам сервера (installments.logic dueDateOf). */
function dueDate(method: string, ym: string, dueDay: number, moved?: string | null): string {
  if (method !== 'separate') return `${shiftYm(ym, 1)}-${String(SALARY_PAY_DAY).padStart(2, '0')}`;
  if (moved) return moved;
  return `${ym}-${String(Math.min(Math.max(1, dueDay || 1), lastDayOf(ym))).padStart(2, '0')}`;
}

function useAccounts(): any[] {
  const { data } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  return (data ?? []).filter((a: any) => !a.archived);
}

const isSeparate = (r: any) => r?.installment?.method === 'separate';

export function InstallmentsList() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'installments'],
    queryFn: () => financeApi.installments(),
  });
  const [formFor, setFormFor] = useState<any | 'new' | null>(null);
  const [entryFor, setEntryFor] = useState<{ row: any; entry: Entry } | null>(null);
  const [payFor, setPayFor] = useState<{ row: any; amount?: number } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  if (isLoading) return <FinLoading />;
  if (isError) return <FinLoadError onRetry={refetch} />;

  const rows: any[] = data?.rows ?? [];
  const stats = data?.stats ?? { remaining: 0, total: 0, paid: 0, count: 0, people: 0, next: null, overdue: null };
  const openYm: string = data?.latestOpenYm ?? currentYm();
  const active = rows.filter((r) => !r.done);
  const closed = rows.filter((r) => r.done);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="flex" style={{ color: INSTALLMENT_COLOR }}><FinIcon name="installment" size={22} /> <span style={{ color: 'var(--text)' }}>Рассрочки сотрудников</span></h1>
          <p>Покупки сотрудникам с возвратом частями — из зарплаты или отдельно</p>
        </div>
        <button className="btn primary" onClick={() => setFormFor('new')}><FinIcon name="plus" size={16} /> Рассрочка</button>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          <div className="big"><FinIcon name="installment" size={30} /></div>
          Рассрочек нет — нажмите «＋ Рассрочка», если купили сотруднику вещь с возвратом частями
        </div>
      ) : (
        <>
          <section className="fin-inst-sum" aria-label="Итого по рассрочкам">
            <div>
              <span className="lb">Сотрудники должны</span>
              <span className="vl" style={{ color: INSTALLMENT_COLOR }}>{money(stats.remaining)}</span>
              <span className="sb">из {money(stats.total)} · вернули {money(stats.paid)}</span>
            </div>
            <div>
              <span className="lb">Ближайший платёж</span>
              <span className="vl">{stats.next ? `${dayLabel(stats.next.date)} · ${money(stats.next.amount)}` : '—'}</span>
              <span className="sb">{stats.next ? `${stats.next.employeeName ?? ''} · ${stats.next.method === 'separate' ? 'платит отдельно' : 'из зарплаты'}` : 'платежей впереди нет'}</span>
            </div>
            <div>
              <span className="lb">Просрочено</span>
              <span className="vl" style={stats.overdue ? { color: 'var(--red)' } : undefined}>{stats.overdue ? money(stats.overdue.amount) : 'нет'}</span>
              <span className="sb">{stats.overdue ? `${pluralRu(stats.overdue.count, 'платёж', 'платежа', 'платежей')} · с ${dayLabel(stats.overdue.since)}` : 'все платежи вовремя'}</span>
            </div>
          </section>

          <div className="fin-inst-list">
            {active.map((r) => (
              <InstallmentCard key={r.installment.id} row={r} openYm={openYm}
                onEdit={() => setFormFor(r)}
                onEntry={(entry) => setEntryFor({ row: r, entry })}
                onPay={(amount) => setPayFor({ row: r, amount })} />
            ))}
          </div>

          {closed.length > 0 && (
            <>
              <button type="button" className="btn ghost sm fin-inst-closed-toggle" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
                {showClosed ? 'Скрыть закрытые' : `Закрытые · ${closed.length}`}
              </button>
              {showClosed && (
                <div className="fin-inst-list">
                  {closed.map((r) => (
                    <InstallmentCard key={r.installment.id} row={r} openYm={openYm}
                      onEdit={() => setFormFor(r)} onEntry={() => {}} onPay={() => {}} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {formFor && <InstallmentFormModal row={formFor === 'new' ? null : formFor} openYm={openYm} onClose={() => setFormFor(null)} />}
      {entryFor && <InstallmentEntryModal row={entryFor.row} entry={entryFor.entry} onClose={() => setEntryFor(null)} />}
      {payFor && <InstallmentPaymentModal row={payFor.row} amount={payFor.amount} onClose={() => setPayFor(null)} />}
    </>
  );
}

/** Платёж месяца можно поправить, пока он не оплачен: «отдельно» — всегда,
 *  «из зарплаты» — пока зарплата месяца не выплачена и период открыт. */
function entryEditable(row: any, e: Entry, openYm: string): boolean {
  if (row.done || e.status === 'done') return false;
  return isSeparate(row) || (!e.frozen && e.ym >= openYm);
}

function InstallmentCard({ row, openYm, onEdit, onEntry, onPay }: {
  row: any; openYm: string;
  onEdit: () => void; onEntry: (e: Entry) => void; onPay: (amount?: number) => void;
}) {
  const qc = useQueryClient();
  const inst = row.installment;
  const separate = isSeparate(row);
  const plan: Entry[] = row.schedule ?? [];
  const late: Entry[] = plan.filter((e) => e.status === 'overdue');
  const nextEntry: Entry | undefined = plan.find((e) => e.outstanding > 0 && e.status !== 'overdue');
  const firstLate = late[0];

  // Полоса графика: «до CRM», два последних оплаченных, всё неоплаченное
  // по порядку — не больше 7 плашек, остаток одной строкой «ещё N».
  const done = plan.filter((e) => e.status === 'done').slice(-2);
  const open = plan.filter((e) => e.status !== 'done');
  const room = Math.max(3, 7 - done.length - (Number(inst.paidBefore) > 0 ? 1 : 0));
  const shown = open.slice(0, room);
  const hidden = open.length - shown.length;
  const lastOpen = open[open.length - 1];

  async function skip(e: Entry) {
    const ok = await finConfirm(`Пропустить удержание ${money(e.amount)} ${dayLabel(e.date)}? Срок рассрочки сдвинется на месяц.`, { confirmLabel: 'Пропустить' });
    if (!ok) return;
    try {
      await financeApi.setInstallmentMonth(inst.id, { ym: e.ym, amount: 0 });
      invalidateFinance(qc);
      toast.success('Месяц пропущен — срок сдвинулся');
    } catch (err) { toast.error(apiErr(err)); }
  }

  const pill = (e: Entry) => {
    const cls = e.status === 'done' ? 'done' : e.status === 'overdue' ? 'late' : e.status === 'skip' ? 'skip' : e === nextEntry ? 'now' : '';
    const value = e.status === 'skip' ? 'пропуск'
      : e.status === 'done' ? `✓ ${moneyBare(e.amount)}`
        : e.status === 'overdue' && e.paid > 0 ? `${moneyBare(e.outstanding)} из ${moneyBare(e.amount)}`
          : moneyBare(e.amount);
    const body = <><em>{dayLabel(e.date, true)}{e.status === 'overdue' ? ' · нет' : ''}</em><b>{value}</b></>;
    if (!entryEditable(row, e, openYm)) return <span key={e.ym} className={`fin-inst-p ${cls}`}>{body}</span>;
    return (
      <button key={e.ym} type="button" className={`fin-inst-p ${cls}`} onClick={() => onEntry(e)}
        title={separate ? 'Изменить сумму, перенести дату или пропустить' : 'Изменить сумму или пропустить'}>
        {body}
      </button>
    );
  };

  return (
    <section className={`fin-inst-card${late.length ? ' late' : ''}${row.done ? ' closed' : ''}`}>
      <div className="fin-inst-top">
        <div className="fin-inst-who">
          <b>{row.employee?.name ?? 'Сотрудник удалён'}</b>
          <div className="it">{inst.name} · <button type="button" className="fin-inst-link" onClick={onEdit}>изменить</button></div>
          <span className={`fin-inst-how ${separate ? 'self' : 'sal'}`}>
            {separate ? `платит отдельно · ${inst.dueDay}-го числа` : `из зарплаты · ${SALARY_PAY_DAY}-го числа`}
          </span>
        </div>

        <div className="fin-inst-rem">
          {row.done ? (
            <span className="big" style={{ color: 'var(--green)' }}>Закрыта</span>
          ) : (
            <div><span className="big">{money(row.remaining)}</span><small>осталось из {money(inst.totalAmount)}</small></div>
          )}
          <div className="progress"><i style={{ width: `${row.progress ?? 0}%`, background: INSTALLMENT_COLOR }} /></div>
          <span className="mini muted">
            вернули {money(row.paid)}
            {!row.done && row.paymentsLeft > 0 ? ` · впереди ${pluralRu(row.paymentsLeft, 'платёж', 'платежа', 'платежей')}` : ''}
            {!row.done && row.endDate ? ` · последний ${dayLabel(row.endDate)}` : ''}
          </span>
        </div>

        {!row.done && (
          <div className={`fin-inst-next${firstLate ? ' late' : ''}`}>
            {firstLate ? (
              <>
                <span className="lb late">Просрочено · срок был {dayLabel(firstLate.date)}</span>
                <span className="d">{money(row.overdue?.amount ?? firstLate.outstanding)}</span>
                {nextEntry && <span className="a">Следующий — {dayLabel(nextEntry.date)}, {money(nextEntry.outstanding)}</span>}
              </>
            ) : nextEntry ? (
              <>
                <span className="lb">Следующий платёж</span>
                <span className="d">{dayLabel(nextEntry.date)} · {money(nextEntry.outstanding)}</span>
                <span className="a">
                  {separate ? 'вносит отдельно — отметьте, когда деньги придут'
                    : nextEntry.status === 'waiting' ? `ждёт выплаты зарплаты за ${monthLabel(nextEntry.ym, true)}`
                      : `удержится из зарплаты за ${monthLabel(nextEntry.ym, true)} — делать ничего не нужно`}
                </span>
              </>
            ) : (
              <span className="a">По плану платежей нет — поменяйте сумму в месяц или внесите остаток.</span>
            )}
            <div className="fin-inst-acts">
              {separate ? (
                <>
                  <button className="btn sm fin-inst-ok" onClick={() => onPay((row.overdue?.amount ?? 0) || nextEntry?.outstanding)}>
                    Получено{(row.overdue?.amount || nextEntry?.outstanding) ? ` ${money(row.overdue?.amount || nextEntry?.outstanding)}` : ''}
                  </button>
                  {(firstLate || nextEntry) && <button className="btn sm" onClick={() => onEntry((firstLate || nextEntry)!)}>Перенести дату</button>}
                </>
              ) : (
                <>
                  <button className="btn sm" onClick={() => onPay(Number(inst.monthlyAmount) || undefined)}>Принять платёж</button>
                  {nextEntry && entryEditable(row, nextEntry, openYm) && <button className="btn sm" onClick={() => skip(nextEntry)}>Пропустить месяц</button>}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {(plan.length > 0 || Number(inst.paidBefore) > 0) && (
        <div className="fin-inst-sched" aria-label="График платежей">
          {Number(inst.paidBefore) > 0 && <span className="fin-inst-p done"><em>до CRM</em><b>✓ {moneyBare(inst.paidBefore)}</b></span>}
          {done.map(pill)}
          {shown.map(pill)}
          {hidden > 0 && lastOpen && <span className="fin-inst-p more">ещё {hidden} · до {dayLabel(lastOpen.date, true)}</span>}
        </div>
      )}
    </section>
  );
}

// ─── Окна ────────────────────────────────────────────────

/** Новая рассрочка / правка: как возвращает, день оплаты и весь график. */
export function InstallmentFormModal({ row, openYm, onClose }: { row: any | null; openYm: string; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const inst = row?.installment;
  const isEdit = !!inst;
  const { data: employees = [] } = useQuery({ queryKey: ['finref', 'employees'], queryFn: () => financeApi.employees() });
  const activeEmployees = useMemo(
    () => (employees as any[]).filter((e) => e.status === 'active' || e.id === inst?.employeeId)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')),
    [employees, inst?.employeeId],
  );
  const deducted = (row?.history ?? []).some((h: any) => h.kind === 'salary');

  const [employeeId, setEmployeeId] = useState<string>(inst?.employeeId ?? '');
  const [name, setName] = useState<string>(inst?.name ?? '');
  const [total, setTotal] = useState<string>(inst ? String(inst.totalAmount) : '');
  const [before, setBefore] = useState<string>(inst ? String(inst.paidBefore || '') : '');
  const [monthly, setMonthly] = useState<string>(inst ? String(inst.monthlyAmount) : '');
  const [method, setMethod] = useState<'salary' | 'separate'>(inst?.method === 'separate' ? 'separate' : 'salary');
  const [dueDay, setDueDay] = useState<number>(Number(inst?.dueDay) || 5);
  // Пока первый месяц не выбрали руками, подставляем ближайший подходящий.
  const [startYm, setStartYm] = useState<string | null>(inst?.startYm ?? null);
  const [note, setNote] = useState<string>(inst?.note ?? '');
  const [buy, setBuy] = useState(false);
  const [buyAccount, setBuyAccount] = useState<string>('');
  const [buyDate, setBuyDate] = useState<string>(todayISO());
  const [busy, setBusy] = useState(false);

  // Первый месяц: из зарплаты — с открытой ведомости, отдельно — с текущего;
  // по умолчанию «отдельно» — первый месяц, где дата платежа ещё впереди.
  const firstYm = method === 'separate' ? currentYm() : openYm;
  const monthOptions = useMemo(() => {
    const list = Array.from({ length: 12 }, (_, i) => shiftYm(firstYm, i));
    if (inst?.startYm && !list.includes(inst.startYm)) list.unshift(inst.startYm);
    return list;
  }, [firstYm, inst?.startYm]);
  const autoStart = method === 'separate' && dueDate('separate', firstYm, dueDay) < todayISO() ? shiftYm(firstYm, 1) : firstYm;
  const start = startYm && monthOptions.includes(startYm) ? startYm : autoStart;

  const t = num(total), b = num(before), mo = num(monthly);
  const rest = Math.max(0, t - b);
  const count = mo > 0 ? Math.ceil(rest / mo - 1e-9) : 0;
  const lastAmount = count > 0 ? Math.round((rest - mo * (count - 1)) * 100) / 100 : 0;
  const dates = Array.from({ length: Math.min(count, 120) }, (_, i) => dueDate(method, shiftYm(start, i), dueDay));
  const accountForBuy = buyAccount || accounts[0]?.id || '';
  const valid = !!employeeId && !!name.trim() && t > 0 && mo > 0 && b <= t && (!buy || !!accountForBuy);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const purchase = buy && !inst?.purchaseTxId ? { accountId: accountForBuy, date: buyDate } : undefined;
      const body: any = {
        name: name.trim(), totalAmount: t, monthlyAmount: mo, paidBefore: b,
        method, note: note.trim(), purchase,
      };
      if (method === 'separate') body.dueDay = dueDay;
      if (!isEdit || start !== inst.startYm) body.startYm = start;
      if (isEdit) await financeApi.updateInstallment(inst.id, body);
      else await financeApi.createInstallment({ ...body, employeeId });
      invalidateFinance(qc);
      toast.success(isEdit ? 'Рассрочка сохранена' : 'Рассрочка добавлена');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!inst || busy) return;
    const ok = await finConfirm(
      `Удалить рассрочку «${inst.name}»? Операции, записанные вместе с ней (покупка, платежи на счёт), отменятся. Удержания из уже выплаченных зарплат останутся в ведомости.`,
      { danger: true, confirmLabel: 'Удалить' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await financeApi.removeInstallment(inst.id);
      invalidateFinance(qc);
      toast.success('Рассрочка удалена');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={isEdit ? 'Рассрочка' : 'Новая рассрочка'} onClose={onClose} width={580}
      footer={<>
        {isEdit && <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>Удалить</button>}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="form-grid">
        <div className="field">
          <label>Сотрудник</label>
          <select value={employeeId} disabled={isEdit} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— выберите —</option>
            {activeEmployees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Что куплено</label><input autoFocus={!isEdit} value={name} maxLength={200} placeholder="например, iPhone 15" onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Стоимость</label><input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
        <div className="field"><label>Уже вернули раньше</label><input inputMode="decimal" value={before} placeholder="0" onChange={(e) => setBefore(e.target.value)} /></div>
      </div>
      {b > t && <p className="mini neg" style={{ margin: 0 }}>«Уже вернули» больше стоимости.</p>}

      <div className="field">
        <label>Как возвращает</label>
        <div className="fin-inst-method" role="radiogroup" aria-label="Как возвращает">
          <button type="button" role="radio" aria-checked={method === 'salary'} className={method === 'salary' ? 'on' : ''} onClick={() => setMethod('salary')}>
            <b>Из зарплаты</b><span>удерживаем сами в день выплаты ЗП — {SALARY_PAY_DAY}-го числа</span>
          </button>
          <button type="button" role="radio" aria-checked={method === 'separate'} className={method === 'separate' ? 'on' : ''} onClick={() => setMethod('separate')}>
            <b>Платит отдельно</b><span>вносит деньги к своему числу; вы отмечаете «получено»</span>
          </button>
        </div>
      </div>

      <div className="fin-inst-row3">
        <div className="field"><label>В месяц</label><input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></div>
        <div className="field">
          <label>День оплаты</label>
          {method === 'separate' ? (
            <select value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}-е число</option>)}
            </select>
          ) : (
            <input value={`${SALARY_PAY_DAY}-е — выплата ЗП`} disabled />
          )}
        </div>
        <div className="field">
          <label>{method === 'separate' ? 'Первый платёж' : 'Первое удержание'}</label>
          <select value={start} disabled={deducted && method === 'salary'} onChange={(e) => setStartYm(e.target.value)}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {method === 'separate' ? monthLabel(m, true) : `${dayLabel(dueDate('salary', m, dueDay))} · ЗП за ${monthLabel(m, true)}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {count > 0 && b <= t && dates.length > 0 && (
        <div className="fin-inst-plan">
          <div className="h">
            <b>{pluralRu(count, 'платёж', 'платежа', 'платежей')} по {money(mo)}</b>
            {lastAmount !== mo ? `, последний ${money(lastAmount)}` : ''}
            {' · '}{count > 1 ? `с ${dayLabel(dates[0])} по ${dayLabel(dates[dates.length - 1])}` : dayLabel(dates[0])}
          </div>
          <div className="sl">
            {dates.slice(0, count > 4 ? 3 : 4).map((d, i) => <span key={d}>{dayLabel(d, true)}<b>{money(i === count - 1 ? lastAmount : mo)}</b></span>)}
            {count > 4 && <span>… ещё {count - 3}<b>до {dayLabel(dates[dates.length - 1], true)}</b></span>}
          </div>
          <span className="mini muted">Каждая дата встанет в календарь «Планирование».{method === 'separate' ? ' За день до даты придёт напоминание в Telegram.' : ''}</span>
        </div>
      )}
      {deducted && method === 'salary' && <p className="mini muted" style={{ margin: 0 }}>Из зарплаты уже удерживали — первый месяц не меняется.</p>}

      {inst?.purchaseTxId ? (
        <p className="mini muted" style={{ margin: 0 }}>Покупка записана в расходы — категория «Рассрочки сотрудникам».</p>
      ) : (
        <>
          <label className="flex" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={buy} onChange={(e) => setBuy(e.target.checked)} style={{ width: 'auto' }} />
            Записать покупку в расходы
          </label>
          {buy ? (
            <div className="form-grid">
              <div className="field"><label>Со счёта</label>
                <select value={accountForBuy} onChange={(e) => setBuyAccount(e.target.value)}>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Дата покупки</label><input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} /></div>
            </div>
          ) : <p className="mini muted" style={{ margin: 0 }}>Без галочки — только учёт возврата, счета не меняются.</p>}
        </>
      )}
      <div className="field"><label>Комментарий</label><input value={note} maxLength={2000} placeholder="необязательно" onChange={(e) => setNote(e.target.value)} /></div>
    </FinModal>
  );
}

/** Платёж месяца: своя сумма, пропуск, для «отдельно» — перенос даты. */
function InstallmentEntryModal({ row, entry, onClose }: { row: any; entry: Entry; onClose: () => void }) {
  const qc = useQueryClient();
  const inst = row.installment;
  const separate = isSeparate(row);
  const usual = Number(inst.monthlyAmount) || 0;
  const plannedDate = dueDate(inst.method, entry.ym, Number(inst.dueDay) || 1);
  const [amount, setAmount] = useState<string>(String(entry.status === 'skip' ? usual : entry.amount || usual));
  const [date, setDate] = useState<string>(entry.date);
  const [busy, setBusy] = useState(false);
  const isCustom = inst.overrides?.[entry.ym] != null;
  const isMoved = !!inst.dueDates?.[entry.ym];

  async function run(fn: () => Promise<any>, done: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      invalidateFinance(qc);
      toast.success(done);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  const a = num(amount);
  const save = () => run(async () => {
    if (a !== entry.amount || entry.status === 'skip') await financeApi.setInstallmentMonth(inst.id, { ym: entry.ym, amount: a });
    if (separate && date && date !== entry.date) await financeApi.setInstallmentDue(inst.id, { ym: entry.ym, date });
  }, 'Платёж сохранён');
  const reset = () => run(async () => {
    if (isCustom) await financeApi.setInstallmentMonth(inst.id, { ym: entry.ym, amount: null });
    if (isMoved) await financeApi.setInstallmentDue(inst.id, { ym: entry.ym, date: null });
  }, 'Вернули как было');

  return (
    <FinModal title={`${row.employee?.name ?? 'Рассрочка'} · ${dayLabel(entry.date)}`} onClose={onClose} width={460}
      footer={<>
        {entry.status !== 'skip' && (
          <button className="btn ghost" style={{ marginRight: 'auto' }} disabled={busy}
            onClick={() => run(() => financeApi.setInstallmentMonth(inst.id, { ym: entry.ym, amount: 0 }), 'Месяц пропущен — срок сдвинулся')}>
            Пропустить месяц
          </button>
        )}
        {(isCustom || isMoved) && (
          <button className="btn ghost" style={entry.status === 'skip' ? { marginRight: 'auto' } : undefined} disabled={busy} onClick={reset}>
            Как было · {money(usual)}{separate ? `, ${dayLabel(plannedDate, true)}` : ''}
          </button>
        )}
        <button className="btn primary" disabled={busy || !(a > 0) || (separate && !date)} onClick={save}>Сохранить</button>
      </>}>
      <p style={{ margin: 0 }}>
        {inst.name}. {separate
          ? <>Обычно — <b>{money(usual)}</b> {inst.dueDay}-го числа.</>
          : <>Обычно удерживаем <b>{money(usual)}</b> из зарплаты за {monthLabel(entry.ym, true)} — {dayLabel(entry.date)}.</>}
      </p>
      <div className={separate ? 'form-grid' : undefined}>
        <div className="field">
          <label>{separate ? 'Сумма' : `Удержать из зарплаты за ${monthLabel(entry.ym, true)}`}</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {separate && (
          <div className="field"><label>Дата платежа</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        )}
      </div>
      <p className="mini muted" style={{ margin: 0 }}>Больше обычного — рассрочка закроется раньше, меньше или пропуск — срок сдвинется. Осталось {money(row.remaining)}</p>
    </FinModal>
  );
}

/** Платёж мимо зарплаты: деньги внесли или закрыли часть досрочно. Счёт — по
 *  желанию: тогда это ещё и доход «Возврат долга». */
function InstallmentPaymentModal({ row, amount: suggestedRaw, onClose }: { row: any; amount?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const inst = row.installment;
  const suggested = Math.min(Number(suggestedRaw) || Number(inst.monthlyAmount) || 0, Number(row.remaining) || 0);
  const [amount, setAmount] = useState<string>(suggested > 0 ? String(suggested) : '');
  const [date, setDate] = useState<string>(todayISO());
  const [accountId, setAccountId] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const payments: any[] = inst.payments ?? [];
  const a = num(amount);
  const over = a > (Number(row.remaining) || 0) + 0.005;

  async function save() {
    if (busy || !(a > 0) || over) return;
    setBusy(true);
    try {
      await financeApi.addInstallmentPayment(inst.id, { amount: a, date, note: note.trim() || undefined, accountId: accountId || undefined });
      invalidateFinance(qc);
      toast.success('Платёж записан');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function removePayment(p: any) {
    const ok = await finConfirm(
      `Убрать платёж ${money(p.amount)} от ${formatDate(p.date)}?${p.txId ? ' Доход на счёт тоже отменится.' : ''}`,
      { danger: true, confirmLabel: 'Убрать' },
    );
    if (!ok) return;
    try {
      await financeApi.removeInstallmentPayment(inst.id, p.id);
      invalidateFinance(qc);
      toast.success('Платёж убран');
      onClose();
    } catch (e) { toast.error(apiErr(e)); }
  }

  return (
    <FinModal title={`Получено · ${row.employee?.name ?? ''}`} onClose={onClose} width={460}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={busy || !(a > 0) || over} onClick={save}>{busy ? 'Записываю…' : 'Записать платёж'}</button>
      </>}>
      <p style={{ margin: 0 }}>{inst.name} · осталось <b>{money(row.remaining)}</b></p>
      <div className="form-grid">
        <div className="field"><label>Сумма</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {over && <p className="mini neg" style={{ margin: 0 }}>Больше остатка: осталось {money(row.remaining)}.</p>}
      <div className="field">
        <label>Куда пришли деньги</label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Не записывать на счёт — только учёт</option>
          {accounts.map((acc: any) => <option key={acc.id} value={acc.id}>{acc.name} — доход «Возврат долга»</option>)}
        </select>
      </div>
      <div className="field"><label>Комментарий</label><input value={note} maxLength={300} placeholder="например, наличными" onChange={(e) => setNote(e.target.value)} /></div>
      {payments.length > 0 && (
        <div className="fin-inst-paylist">
          <span className="mini muted">Уже внесено отдельно</span>
          {payments.map((p) => (
            <div key={p.id} className="fin-inst-payrow">
              <span>{formatDate(p.date)}</span>
              <span className="mini muted">{p.note || (p.txId ? 'на счёт' : 'учёт')}</span>
              <b className="num">{money(p.amount)}</b>
              <button type="button" className="btn ghost sm" aria-label="Убрать платёж" onClick={() => removePayment(p)}><FinIcon name="close" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </FinModal>
  );
}

// ─── Блок в раскрытой строке зарплатной ведомости ─────────────

/** «Рассрочка» в месяце сотрудника: что удерживаем, сколько осталось;
 *  в открытом месяце — пропустить или поменять сумму прямо отсюда. */
export function InstallmentSalaryField({ row, ym, frozen }: { row: any; ym: string; frozen: boolean }) {
  const qc = useQueryClient();
  const parts: any[] = row.installmentParts || [];
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  if (!parts.length) return null;
  const total = Number(row.installment) || 0;

  async function setMonth(p: any, amount: number | null, done: string) {
    try {
      await financeApi.setInstallmentMonth(p.id, { ym, amount });
      invalidateFinance(qc);
      setEditing(null);
      toast.success(done);
    } catch (e) { toast.error(apiErr(e)); }
  }

  return (
    <div className="fld fin-inst-fld">
      <div className="cap"><span className="lbl">Рассрочка</span>{total > 0 && <span className="tot" style={{ color: INSTALLMENT_COLOR }}>{money(total)}</span>}</div>
      {parts.map((p) => {
        const pct = p.total > 0 ? Math.min(100, Math.round((p.paid / p.total) * 100)) : 0;
        return (
          <div key={p.id} className="fin-inst-part">
            <div className="t">
              <b title={p.name}>{p.name}</b>
              <span>{p.amount > 0 ? money(p.amount) : p.skipped ? 'пропуск' : '—'}</span>
            </div>
            {p.total > 0 && <div className="progress"><i style={{ width: `${pct}%`, background: INSTALLMENT_COLOR }} /></div>}
            {p.total > 0 && (
              <div className="mini muted">
                вернули {money(p.paid)} из {money(p.total)}{p.remaining > 0 ? ` · осталось ${money(p.remaining)}` : ''}
              </div>
            )}
            {!frozen && !p.done && editing !== p.id && (
              <div className="acts">
                {p.skipped
                  ? <button type="button" className="btn ghost sm" onClick={() => setMonth(p, null, 'Удержание вернули')}>Удержать как обычно</button>
                  : <button type="button" className="btn ghost sm" onClick={() => setMonth(p, 0, 'Месяц пропущен — срок сдвинулся')}>Пропустить месяц</button>}
                <button type="button" className="btn ghost sm" onClick={() => { setEditing(p.id); setValue(String(p.amount || p.monthly || '')); }}>Изменить сумму</button>
              </div>
            )}
            {editing === p.id && (
              <div className="in">
                <input autoFocus inputMode="decimal" value={value} aria-label="Сумма удержания за месяц"
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); const n = num(value); if (n > 0) setMonth(p, n, 'Сумма месяца сохранена'); }
                    if (e.key === 'Escape') setEditing(null);
                  }} />
                <button type="button" className="issue" title="Сохранить" onClick={() => { const n = num(value); if (n > 0) setMonth(p, n, 'Сумма месяца сохранена'); }}>
                  <FinIcon name="check" size={15} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
