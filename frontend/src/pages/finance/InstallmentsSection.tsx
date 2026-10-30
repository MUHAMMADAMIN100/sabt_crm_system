// Рассрочки сотрудников (/finance/expense/installments). Компания купила
// сотруднику вещь, деньги возвращаются частями. Решения владельца:
// 26.10.2026 — своя карточка на «Расходе» + колонка «Рассрочка» в ведомости;
// 27.10.2026 — вид «карточки» (вариант А), у каждой рассрочки свой способ:
// «из зарплаты» (удерживаем в день выплаты ЗП, 10-го) или «платит отдельно»
// (к своему числу месяца, владелец отмечает «получено»); просрочка красным.
// Позже 27.10: деньги закрывают ближайшие месяцы (зелёные, из зарплаты за них
// не удерживаем), счёт обязателен; месяц «из зарплаты» отмечают «удержано» —
// удержание остаётся; любой месяц открывается окном с отменой.
// Менять может только владелец, сотрудник видит своё в профиле.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, moneyBare, monthLabel, shiftYm, todayISO, currentYm, apiErr, pluralRu } from './finlib';
import { FinLoading, FinLoadError, FinModal, finConfirm, invalidateFinance } from './FinKit';
import FinIcon from './FinIcon';
import { AccountMark } from './AccountIdentity';

export const INSTALLMENT_COLOR = '#47aaa4';
/** День выплаты зарплаты — в этот день удерживается рассрочка «из зарплаты». */
const SALARY_PAY_DAY = 10;

const num = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

type Entry = {
  ym: string; date: string; amount: number; paid: number; outstanding: number;
  status: 'done' | 'planned' | 'overdue' | 'waiting' | 'skip'; frozen: boolean; custom: boolean;
  /** Закрыто деньгами / удержано из зарплаты (выплаченной или отмеченное). */
  cash: number; withheld: number; marked: boolean;
  paymentIds: string[]; paidAt: string | null;
};

const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** «10 ноября», «5 сент. 2027» — год только если не текущий. */
function dayLabel(iso: string, short = false): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const year = y !== Number(todayISO().slice(0, 4)) ? ` ${y}` : '';
  return `${d} ${(short ? MONTHS_SHORT : MONTHS_GEN)[m - 1]}${year}`;
}

/** «декабрь» — месяц начисления зарплаты, без года. */
const monthName = (ym: string) => MONTHS_NOM[Number(ym.slice(5, 7)) - 1] ?? ym;

/** «а», «а и б», «а, б и в». */
const listRu = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);

/** «Зарипова Умрона» — фамилия и имя для заголовков окон. */
const shortName = (name?: string | null) => String(name || '').split(/\s+/).slice(0, 2).join(' ');

const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

/** Банки, через которые компания обычно берёт рассрочку (30.10.2026). */
const BANKS = ['Алиф', 'Эсхата'];

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

/** Какие месяцы закроет платёж — как на сервере (allocatePayment): сначала
 *  выбранный месяц, потом ближайшие открытые по порядку. */
function allocPreview(plan: Entry[], amount: number, preferYm?: string) {
  const open = plan.filter((e) => e.outstanding > 0 && !e.frozen && !e.marked);
  const ordered = preferYm ? [...open.filter((e) => e.ym === preferYm), ...open.filter((e) => e.ym !== preferYm)] : open;
  const out: Array<{ entry: Entry; amount: number; full: boolean }> = [];
  let left = Math.round(amount * 100) / 100;
  for (const e of ordered) {
    if (left <= 0.005) break;
    const take = Math.min(left, e.outstanding);
    out.push({ entry: e, amount: take, full: take >= e.outstanding - 0.005 });
    left = Math.round((left - take) * 100) / 100;
  }
  return out;
}

export function InstallmentsList() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'installments'],
    queryFn: () => financeApi.installments(),
  });
  const [formFor, setFormFor] = useState<any | 'new' | null>(null);
  const [entryFor, setEntryFor] = useState<{ row: any; entry: Entry } | null>(null);
  const [payFor, setPayFor] = useState<{ row: any; amount?: number; ym?: string } | null>(null);
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
                      onEdit={() => setFormFor(r)} onEntry={(entry) => setEntryFor({ row: r, entry })} onPay={() => {}} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {formFor && <InstallmentFormModal row={formFor === 'new' ? null : formFor} openYm={openYm} onClose={() => setFormFor(null)} />}
      {entryFor && (
        <InstallmentEntryModal row={entryFor.row} entry={entryFor.entry} openYm={openYm} onClose={() => setEntryFor(null)}
          onPay={(ym, amount) => { setPayFor({ row: entryFor.row, ym, amount }); setEntryFor(null); }} />
      )}
      {payFor && <InstallmentPaymentModal row={payFor.row} amount={payFor.amount} ym={payFor.ym} onClose={() => setPayFor(null)} />}
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

  // Любой месяц нажимается: оплаченный — посмотреть, когда и чем закрыт, и
  // отменить; открытый — отметить, поменять сумму, пропустить.
  const pill = (e: Entry) => {
    const cls = e.status === 'done' ? 'done' : e.status === 'overdue' ? 'late' : e.status === 'skip' ? 'skip' : e === nextEntry ? 'now' : '';
    const value = e.status === 'skip' ? 'пропуск'
      : e.status === 'done' ? `✓ ${moneyBare(e.amount)}`
        : e.status === 'overdue' && e.paid > 0 ? `${moneyBare(e.outstanding)} из ${moneyBare(e.amount)}`
          : moneyBare(e.outstanding);
    const note = e.status === 'done'
      ? (e.cash > 0 && e.paidAt ? `получено ${dayLabel(e.paidAt, true)}` : 'удержано')
      : e.cash > 0 && e.status !== 'overdue' ? `внесено ${moneyBare(e.cash)}` : null;
    return (
      <button key={e.ym} type="button" className={`fin-inst-p ${cls}`} onClick={() => onEntry(e)}>
        <em>{dayLabel(e.date, true)}{e.status === 'overdue' ? ' · нет' : ''}</em><b>{value}</b>
        {note && <small>{note}</small>}
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
  // Через банк: компания сама платит банку в свой день; суммы — как у сотрудника.
  const [viaBank, setViaBank] = useState<boolean>(!!inst?.bankName);
  const [bankPick, setBankPick] = useState<string>(
    inst?.bankName ? (BANKS.includes(inst.bankName) ? inst.bankName : 'other') : BANKS[0]);
  const [bankOther, setBankOther] = useState<string>(inst?.bankName && !BANKS.includes(inst.bankName) ? inst.bankName : '');
  const [bankDay, setBankDay] = useState<number>(Number(inst?.bankDueDay) || 15);
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
  const bankName = viaBank ? (bankPick === 'other' ? bankOther.trim() : bankPick) : '';
  // Банку — столько же платежей, первый — ближайшее число банка, которое ещё впереди.
  const bankStart = dueDate('separate', currentYm(), bankDay) < todayISO() ? shiftYm(currentYm(), 1) : currentYm();
  const bankDates = Array.from({ length: Math.min(count, 120) }, (_, i) => dueDate('separate', shiftYm(bankStart, i), bankDay));
  const valid = !!employeeId && !!name.trim() && t > 0 && mo > 0 && b <= t
    && (!buy || viaBank || !!accountForBuy) && (!viaBank || !!bankName);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const purchase = buy && !viaBank && !inst?.purchaseTxId ? { accountId: accountForBuy, date: buyDate } : undefined;
      const body: any = {
        name: name.trim(), totalAmount: t, monthlyAmount: mo, paidBefore: b,
        method, note: note.trim(), purchase,
        bankName: viaBank ? bankName : null,
        ...(viaBank ? { bankDueDay: bankDay } : {}),
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

      <label className="flex" style={{ cursor: 'pointer', fontWeight: 600 }}>
        <input type="checkbox" checked={viaBank} onChange={(e) => setViaBank(e.target.checked)} style={{ width: 'auto' }} />
        Купили в рассрочку через банк — платим банку сами
      </label>
      {viaBank && (
        <div className="fin-inst-bank">
          <div className="field">
            <label>Банк</label>
            <div className="fin-inst-banks" role="radiogroup" aria-label="Банк">
              {BANKS.map((b) => (
                <button key={b} type="button" role="radio" aria-checked={bankPick === b} className={bankPick === b ? 'on' : ''} onClick={() => setBankPick(b)}>
                  <AccountMark name={b} compact />{b}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={bankPick === 'other'} className={bankPick === 'other' ? 'on' : ''} onClick={() => setBankPick('other')}>
                <AccountMark name="банк" compact />Другой
              </button>
            </div>
            {bankPick === 'other' && (
              <input autoFocus value={bankOther} maxLength={100} placeholder="название банка" onChange={(e) => setBankOther(e.target.value)} style={{ marginTop: 8 }} />
            )}
          </div>
          <div className="field">
            <label>День оплаты банку</label>
            <select value={bankDay} onChange={(e) => setBankDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}-е число</option>)}
            </select>
          </div>
          {count > 0 && b <= t && bankDates.length > 0 && (
            <div className="fin-inst-plan">
              <div className="h">
                <b>{pluralRu(count, 'платёж', 'платежа', 'платежей')} банку по {money(mo)}</b>
                {lastAmount !== mo ? `, последний ${money(lastAmount)}` : ''}
                {' · '}{bankDay}-го числа, {count > 1 ? `с ${dayLabel(bankDates[0])} по ${dayLabel(bankDates[bankDates.length - 1])}` : dayLabel(bankDates[0])}
              </div>
              <div className="sl">
                {bankDates.slice(0, count > 4 ? 3 : 4).map((d, i) => <span key={d}>{dayLabel(d, true)}<b>{money(i === count - 1 ? lastAmount : mo)}</b></span>)}
                {count > 4 && <span>… ещё {count - 3}<b>до {dayLabel(bankDates[bankDates.length - 1], true)}</b></span>}
              </div>
              <span className="mini muted">Каждый платёж встанет в «Планирование» на {bankDay}-е и в «Расход → Долги». «Оплачено» — расход со счёта, остаток банку уменьшится.</span>
            </div>
          )}
        </div>
      )}

      {viaBank ? (
        <p className="mini muted" style={{ margin: 0 }}>С банком покупку целиком в расходы не пишем — расходом будет каждый платёж банку.</p>
      ) : inst?.purchaseTxId ? (
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

/** Окно месяца: что с платежом сейчас — ожидается, получен, удержан — и что
 *  можно сделать: отметить «Получено» / «Удержано из зарплаты», отменить,
 *  поменять сумму или дату, пропустить. «Отмена» закрывает без изменений. */
function InstallmentEntryModal({ row, entry, openYm, onPay, onClose }: {
  row: any; entry: Entry; openYm: string;
  onPay: (ym: string, amount?: number) => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const inst = row.installment;
  const separate = isSeparate(row);
  const plan: Entry[] = row.schedule ?? [];
  const usual = Number(inst.monthlyAmount) || 0;
  const month = monthName(entry.ym);
  const isOpen = entry.status !== 'done' && entry.status !== 'skip';
  const editable = entryEditable(row, entry, openYm);
  const isCustom = inst.overrides?.[entry.ym] != null;
  const isMoved = !!inst.dueDates?.[entry.ym];
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<'amount' | 'date' | null>(null);
  const [amount, setAmount] = useState<string>(String(entry.status === 'skip' ? usual : entry.amount || usual));
  const [date, setDate] = useState<string>(entry.date);
  const [got, setGot] = useState<string>(entry.outstanding > 0 ? String(entry.outstanding) : '');
  const [gotDate, setGotDate] = useState<string>(todayISO());
  const [accountId, setAccountId] = useState<string>('');
  const payments: any[] = (inst.payments ?? []).filter((p: any) => entry.paymentIds?.includes(p.id));
  const payout = (row.history ?? []).find((h: any) => h.key === `s-${entry.ym}`)?.date as string | undefined;

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
  const g = num(got);
  const gotOver = g > (Number(row.remaining) || 0) + 0.005;
  const saveAmount = () => run(() => financeApi.setInstallmentMonth(inst.id, { ym: entry.ym, amount: a }), 'Сумма месяца сохранена');
  const resetAmount = () => run(() => financeApi.setInstallmentMonth(inst.id, { ym: entry.ym, amount: null }), 'Вернули как было');
  const saveDate = () => run(() => financeApi.setInstallmentDue(inst.id, { ym: entry.ym, date }), 'Дата перенесена');
  const resetDate = () => run(() => financeApi.setInstallmentDue(inst.id, { ym: entry.ym, date: null }), 'Вернули число');
  const skip = () => run(() => financeApi.setInstallmentMonth(inst.id, { ym: entry.ym, amount: 0 }), 'Месяц пропущен — срок сдвинулся');
  const mark = (on: boolean) => run(() => financeApi.setInstallmentMark(inst.id, { ym: entry.ym, on }),
    on ? 'Отмечено: удержано из зарплаты' : 'Отметка снята');
  const receive = () => run(() => financeApi.addInstallmentPayment(inst.id, { amount: g, date: gotDate, accountId, ym: entry.ym }), 'Платёж записан');
  const undo = (p: any) => run(() => financeApi.removeInstallmentPayment(inst.id, p.id), 'Получение отменено');

  // Что с месяцем сейчас.
  let badge: { cls: string; text: string };
  let value: string;
  let sub: string;
  if (entry.status === 'skip') {
    badge = { cls: 'skip', text: 'Пропуск' };
    value = '—';
    sub = separate ? 'платежа в этом месяце нет — срок сдвинулся' : `из зарплаты за ${month} не удерживаем — срок сдвинулся`;
  } else if (entry.status === 'done' && (entry.frozen || entry.marked)) {
    badge = { cls: 'ok', text: '✓ Удержано' };
    value = money(entry.amount);
    sub = entry.frozen
      ? `из зарплаты за ${month}${payout ? `, выплачена ${dayLabel(payout)}` : ''}`
      : `из зарплаты за ${month}${entry.paidAt ? ` · отмечено ${dayLabel(entry.paidAt)}` : ''}`;
  } else if (entry.status === 'done') {
    badge = { cls: 'ok', text: '✓ Получено' };
    value = money(entry.cash);
    sub = separate ? `получено ${dayLabel(entry.paidAt || entry.date)}` : `из зарплаты за ${month} не удержится`;
  } else {
    const part = entry.cash > 0 ? ` · внесено ${money(entry.cash)} из ${money(entry.amount)}` : '';
    value = money(entry.outstanding);
    if (entry.status === 'overdue') {
      badge = { cls: 'late', text: 'Просрочено' };
      sub = `срок был ${dayLabel(entry.date)}${part}`;
    } else if (entry.status === 'waiting') {
      badge = { cls: 'wait', text: 'Ждёт выплаты' };
      sub = `удержится, когда выплатят зарплату за ${month}${part}`;
    } else {
      badge = { cls: '', text: 'Ожидается' };
      sub = separate ? `платит отдельно · до ${dayLabel(entry.date)}${part}` : `удержится из зарплаты за ${month} · ${dayLabel(entry.date)}${part}`;
    }
  }
  const coveredBy = (p: any) => plan.filter((x) => x.paymentIds?.includes(p.id));

  return (
    <FinModal title={`${shortName(row.employee?.name) || 'Рассрочка'} · ${dayLabel(entry.date)}`} onClose={onClose} width={620}
      footer={<button className="btn ghost" onClick={onClose}>{isOpen || entry.status === 'skip' ? 'Отмена' : 'Закрыть'}</button>}>
      <div className={`fin-inst-state ${badge.cls}`}>
        <span className={`fin-inst-badge ${badge.cls}`}>{badge.text}</span>
        <div className="tx"><div className="v">{value}</div><div className="s">{sub}</div></div>
      </div>

      {/* Открытый месяц «из зарплаты»: отметить, что удержали. */}
      {isOpen && !separate && !entry.frozen && (
        <div className="fin-inst-got">
          <b>Удержали из зарплаты?</b>
          <button type="button" className="btn fin-inst-ok solid" disabled={busy} onClick={() => mark(true)}>✓ Удержано из зарплаты</button>
          <span className="hint">Месяц станет зелёным. Удержание {money(entry.outstanding)} в ведомости за {month} остаётся.</span>
        </div>
      )}

      {/* Открытый месяц «платит отдельно»: деньги пришли. */}
      {isOpen && separate && (
        <div className="fin-inst-got">
          <b>Деньги уже внесли?</b>
          <div className="form-grid">
            <div className="field"><label>Сумма</label><input inputMode="decimal" value={got} onChange={(e) => setGot(e.target.value)} /></div>
            <div className="field"><label>Когда</label><input type="date" value={gotDate} onChange={(e) => setGotDate(e.target.value)} /></div>
          </div>
          <div className="field">
            <label>Куда пришли деньги</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="" disabled>Выберите счёт</option>
              {accounts.map((acc: any) => <option key={acc.id} value={acc.id}>{acc.name} — доход «Возврат долга»</option>)}
            </select>
          </div>
          <button type="button" className="btn fin-inst-ok solid" disabled={busy || !(g > 0) || gotOver || !accountId} onClick={receive}>
            Получено{g > 0 ? ` ${money(g)}` : ''}
          </button>
          <span className={`hint${gotOver ? ' neg' : ''}`}>
            {gotOver ? `Больше остатка: осталось ${money(row.remaining)}`
              : !accountId ? 'Выберите счёт — деньги запишутся доходом «Возврат долга».'
                : g > entry.outstanding + 0.005 ? 'Месяц станет зелёным, лишнее закроет следующие месяцы.'
                  : 'Месяц станет зелёным.'}
          </span>
        </div>
      )}

      {/* Поменять сумму, дату, пропустить. */}
      {(isOpen || entry.status === 'skip') && !edit && (
        <div className="fin-inst-links">
          {entry.status === 'skip' ? (
            editable && <button type="button" className="fin-inst-link" disabled={busy} onClick={resetAmount}>{separate ? 'Вернуть платёж' : 'Удерживать как обычно'}</button>
          ) : (
            <>
              {!separate && <button type="button" className="fin-inst-link" onClick={() => onPay(entry.ym, entry.outstanding)}>Внесли деньгами</button>}
              {editable && <button type="button" className="fin-inst-link" onClick={() => setEdit('amount')}>Изменить сумму месяца</button>}
              {separate && <button type="button" className="fin-inst-link" onClick={() => setEdit('date')}>Перенести дату</button>}
              {editable && <button type="button" className="fin-inst-link" disabled={busy} onClick={skip}>Пропустить месяц</button>}
            </>
          )}
        </div>
      )}
      {edit === 'amount' && (
        <>
          <div className="fin-inst-edit">
            <div className="field">
              <label>{separate ? 'Сумма за месяц' : `Удержать из зарплаты за ${month}`}</label>
              <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <button type="button" className="btn primary" disabled={busy || !(a > 0)} onClick={saveAmount}>Сохранить</button>
            {isCustom && <button type="button" className="btn ghost" disabled={busy} onClick={resetAmount}>Как было · {money(usual)}</button>}
          </div>
          <p className="mini muted" style={{ margin: 0 }}>Больше обычного — рассрочка закроется раньше, меньше — срок сдвинется. Осталось {money(row.remaining)}</p>
        </>
      )}
      {edit === 'date' && (
        <div className="fin-inst-edit">
          <div className="field"><label>Дата платежа</label><input autoFocus type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <button type="button" className="btn primary" disabled={busy || !date || date === entry.date} onClick={saveDate}>Сохранить</button>
          {isMoved && <button type="button" className="btn ghost" disabled={busy} onClick={resetDate}>Вернуть {inst.dueDay}-е число</button>}
        </div>
      )}

      {/* Чем закрыт месяц — и отмена. */}
      {payments.length > 0 && (
        <div className="fin-inst-by">
          <div className="cap">Чем закрыто</div>
          {payments.map((p) => (
            <div key={p.id} className="row">
              <span>{dayLabel(p.date)} · платёж {money(p.amount)}{p.note ? ` · ${p.note}` : ''}</span>
              {payments.length > 1
                ? <button type="button" className="btn ghost sm danger" disabled={busy} onClick={() => undo(p)}>Отменить</button>
                : <span className="muted">{p.txId ? 'на счёт' : 'только учёт'}</span>}
            </div>
          ))}
          {(payments.length > 1 || Number(payments[0].amount) !== entry.cash) && (
            <div className="row"><span className="muted">{payments.length > 1 ? 'на этот месяц' : 'из него на этот месяц'}</span><b>{money(entry.cash)}</b></div>
          )}
        </div>
      )}
      {payments.length === 1 && (() => {
        const p = payments[0];
        const covered = coveredBy(p);
        return (
          <>
            <button type="button" className="btn danger fin-inst-undo" disabled={busy} onClick={() => undo(p)}>Отменить получение</button>
            <span className="fin-inst-undo-note">
              Отменится платёж {dayLabel(p.date)} целиком — {money(p.amount)}
              {covered.length > 1 ? `: ${listRu(covered.map((x) => dayLabel(x.date, true)))} снова станут «ожидается».` : ''}
              {p.txId ? ' Доход на счёт тоже отменится.' : ''}
            </span>
          </>
        );
      })()}
      {entry.marked && (
        <>
          <button type="button" className="btn danger fin-inst-undo" disabled={busy} onClick={() => mark(false)}>Снять отметку</button>
          <span className="fin-inst-undo-note">Месяц снова станет «ожидается». Удержание в ведомости не меняется.</span>
        </>
      )}
      {entry.frozen && (
        <p className="fin-inst-undo-note" style={{ margin: 0 }}>
          Эти деньги удержаны при выплате зарплаты. Отменить можно только вместе с выплатой: «Зарплата» → {month} → «Отменить выплату».
        </p>
      )}
    </FinModal>
  );
}

/** Деньги внесли отдельно: доход «Возврат долга» на счёт (счёт обязателен).
 *  Платёж закрывает выбранный месяц, потом ближайшие — окно сразу показывает
 *  какие; месяцы «из зарплаты», закрытые деньгами, из зарплаты не удержатся. */
function InstallmentPaymentModal({ row, amount: suggestedRaw, ym, onClose }: {
  row: any; amount?: number; ym?: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const inst = row.installment;
  const separate = isSeparate(row);
  const suggested = Math.min(Number(suggestedRaw) || Number(inst.monthlyAmount) || 0, Number(row.remaining) || 0);
  const [amount, setAmount] = useState<string>(suggested > 0 ? String(suggested) : '');
  const [date, setDate] = useState<string>(todayISO());
  const [accountId, setAccountId] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const a = num(amount);
  const over = a > (Number(row.remaining) || 0) + 0.005;
  const preview = useMemo(() => (a > 0 && !over ? allocPreview(row.schedule ?? [], a, ym) : []), [row.schedule, a, over, ym]);

  // «Из зарплаты за декабрь и январь ничего не удержится, за февраль — 630 с.»
  let salaryNote = '';
  if (!separate && preview.length) {
    const full = preview.filter((x) => x.full).map((x) => monthName(x.entry.ym));
    const part = preview.find((x) => !x.full);
    const rest = part ? money(part.entry.outstanding - part.amount) : '';
    salaryNote = full.length
      ? `Из зарплаты за ${listRu(full)} ничего не удержится${part ? `, за ${monthName(part.entry.ym)} — ${rest}` : '.'}`
      : part ? `Из зарплаты за ${monthName(part.entry.ym)} удержится ${rest} вместо ${money(part.entry.outstanding)}` : '';
  }

  async function save() {
    if (busy || !(a > 0) || over || !accountId) return;
    setBusy(true);
    try {
      await financeApi.addInstallmentPayment(inst.id, { amount: a, date, note: note.trim() || undefined, accountId, ym });
      invalidateFinance(qc);
      toast.success('Платёж записан');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={`Получено · ${shortName(row.employee?.name)}`} onClose={onClose} width={620}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={busy || !(a > 0) || over || !accountId} onClick={save}>{busy ? 'Записываю…' : 'Записать платёж'}</button>
      </>}>
      <p style={{ margin: 0 }}>{inst.name} · осталось <b>{money(row.remaining)}</b></p>
      <div className="form-grid">
        <div className="field"><label>Сумма</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {over && <p className="mini neg" style={{ margin: 0 }}>Больше остатка: осталось {money(row.remaining)}</p>}
      {preview.length > 0 && (
        <div className="fin-inst-will">
          <span className="lb">{ym ? 'Закроет:' : 'Закроет ближайшие месяцы:'}</span>
          <div className="fin-inst-chips">
            {preview.map((x) => (
              <span key={x.entry.ym} className={`fin-inst-chip${x.full ? '' : ' part'}`}>
                <span>{dayLabel(x.entry.date, true)}</span>
                <b>{x.full ? `✓ ${moneyBare(x.amount)}` : `${moneyBare(x.amount)} из ${moneyBare(x.entry.outstanding)}`}</b>
              </span>
            ))}
          </div>
          {salaryNote && <span className="sb">{salaryNote}</span>}
        </div>
      )}
      <div className="field">
        <label>Куда пришли деньги</label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>Выберите счёт</option>
          {accounts.map((acc: any) => <option key={acc.id} value={acc.id}>{acc.name} — доход «Возврат долга»</option>)}
        </select>
      </div>
      <div className="field"><label>Комментарий</label><input value={note} maxLength={300} placeholder="например, наличными" onChange={(e) => setNote(e.target.value)} /></div>
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
