// «Планирование» (/finance/planning) — денежный календарь месяца, вариант А
// (выбор владельца 03.11.2026): итоги месяца, фильтры, значки статуса,
// просроченное красным. Режим «К прогнозу» и корректировки убраны — месяцы
// вперёд теперь в «Расходе» → «3 месяца / 6 месяцев / 1 год».
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { apiErr, currentYm, shiftYm, todayISO, useYmParam, withYm } from './finlib';
import { FinLoadError, FinLoading, invalidateFinanceAll, keepMonth } from './FinKit';
import FinIcon from './FinIcon';
import MonthNav from './MonthNav';
import PlanCalendar from './PlanCalendar';
import TransactionModal from './TransactionModal';
import { buildLateOther, buildMonthItems } from './planItems';
import './finance.css';

/** Управление статусом операции в модалке «Планирования»: отметить
 *  полученной/оплаченной или вернуть в план. Работает для план-платежей
 *  (id `pp-…`) и подписок (`sub-…`); для остальных просто показывает статус. */
function PlanningStatusControl({ item, ym, onClose }: { item: any; ym: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  const activeAccounts = ((accounts as any[]) || []).filter((a) => !a.archived);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  // Дата оплаты (08.11.2026): у просроченного по умолчанию — сегодня. Раньше
  // бралась дата срока, и оплата, пришедшая сегодня, задним числом уходила в
  // прошлый месяц.
  const [payDate, setPayDate] = useState(() => {
    const d = String(item.date || '').slice(0, 10);
    const today = todayISO();
    return d && d < today ? today : (d || today);
  });
  useEffect(() => { if (!accountId && activeAccounts.length) setAccountId(activeAccounts[0].id); }, [activeAccounts, accountId]);

  const id = String(item.id || '');
  const isPlan = id.startsWith('pp-');
  const isSub = id.startsWith('sub-');
  const done = !!item.done;
  const income = item.type === 'income';
  const doneLabel = done ? (income ? 'Получено' : 'Оплачено') : 'Запланировано';

  if (id.startsWith('inst-')) {
    // Рассрочка: отмечают на её странице — там же перенос даты и пропуск.
    const late = String(item.comment || '').includes('просрочено');
    const label = item.installmentMethod === 'separate'
      ? (done ? 'Получено' : late ? 'Просрочено' : 'Ожидается')
      : (done ? 'Удержано из зарплаты' : 'Удержим из зарплаты');
    return (
      <div className="cal-item-rows">
        <div className="cal-item-row"><span>Статус</span><b>{label}</b></div>
        <Link to="/finance/expense/installments" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>Открыть рассрочки</Link>
      </div>
    );
  }
  if (id.startsWith('smmdue-')) {
    // Оплату SMM-клиента отмечают на странице SMM — там же частичная оплата.
    return (
      <div className="cal-item-rows">
        <div className="cal-item-row"><span>Статус</span><b>Срок прошёл</b></div>
        {/* Просрочку SMM считаем по данным текущего месяца — там её и видно. */}
        <Link to={withYm('/finance/income/smm', currentYm())} className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>Открыть SMM</Link>
      </div>
    );
  }
  if (id.startsWith('due-')) {
    // Долг со сроком «вернуть до»: отдают на странице «Долги» (сразу или траншем).
    return (
      <div className="cal-item-rows">
        <div className="cal-item-row"><span>Статус</span><b>{item.date < todayISO() ? 'Срок прошёл' : 'Вернуть до этого дня'}</b></div>
        {/* Срок долга — в этом же месяце календаря: «Долги» открываем на нём. */}
        <Link to={withYm('/finance/expense/debts', ym)} className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>Открыть долги</Link>
      </div>
    );
  }
  if (id.startsWith('fc-')) {
    // Прогноз по тарифу (14.11.2026): оплату клиента отмечают на странице
    // направления — раньше карточка была тупиком без действий.
    const dir = item.direction === 'maintenance' ? 'maintenance' : 'smm';
    return (
      <div className="cal-item-rows">
        <div className="cal-item-row"><span>Статус</span><b>{item.date < todayISO() ? 'Срок прошёл' : 'Ждём оплату'}</b></div>
        <Link to={withYm(`/finance/income/${dir}`, ym)} className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>
          {dir === 'maintenance' ? 'Открыть обслуживание' : 'Открыть SMM'}
        </Link>
      </div>
    );
  }
  if (id.startsWith('salary-') || id.startsWith('salpaid-')) {
    // Зарплату выплачивают в ведомости за прошлый месяц.
    return (
      <div className="cal-item-rows">
        <div className="cal-item-row"><span>Статус</span><b>{doneLabel}</b></div>
        <Link to={withYm('/finance/expense/salary', item.salaryYm || shiftYm(ym, -1))} className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>Открыть зарплату</Link>
      </div>
    );
  }
  if (!isPlan && !isSub) {
    return <div className="cal-item-rows"><div className="cal-item-row"><span>Статус</span><b>{doneLabel}</b></div></div>;
  }
  const rawId = isPlan ? id.slice(3) : id.slice(4);
  const itemDate = String(item.date || '').slice(0, 10) || todayISO();

  async function mark() {
    if (busy || (isPlan && !accountId)) return;
    setBusy(true);
    try {
      if (isPlan) await financeApi.receivePlanned(rawId, { accountId, date: payDate || itemDate });
      else await financeApi.markSubPaid(rawId, { ym, date: payDate || itemDate });
      invalidateFinanceAll(qc); onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }
  async function revert() {
    if (busy) return;
    setBusy(true);
    try {
      if (isPlan) await financeApi.unreceivePlanned(rawId);
      else await financeApi.unmarkSubPaid(rawId, { ym });
      invalidateFinanceAll(qc); onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }

  return (
    <div className="cal-item-status">
      <div className="cal-item-status-head">Статус: <b>{doneLabel}</b></div>
      {done ? (
        <button className="btn ghost" disabled={busy} onClick={revert}>Вернуть в план</button>
      ) : (
        <>
          {isPlan && (
            <div className="field"><label htmlFor={`${fieldId}-acc`}>{income ? 'На счёт' : 'Со счёта'}</label>
              <select id={`${fieldId}-acc`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label htmlFor={`${fieldId}-date`}>{income ? 'Когда пришли деньги' : 'Когда оплатили'}</label>
            <input id={`${fieldId}-date`} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
          <button className="btn primary" disabled={busy || (isPlan && !accountId)} onClick={mark}>
            {income ? 'Отметить полученной' : 'Отметить оплаченной'}
          </button>
        </>
      )}
    </div>
  );
}

export default function FinancePlanningPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Месяц — в адресе (?ym=, с заменой шага, 08.11.2026), как на других
  // страницах «Финансов»: вернулись «Назад» из долгов или SMM — тот же месяц.
  const [calYm, setCalYm] = useYmParam();
  // ── Данные календаря: всё движение денег по датам ──────────────────
  // Зарплата выдаётся 10-го числа за ПРЕДЫДУЩИЙ месяц (работали в августе —
  // платим 10 сентября). Значит в месяце calYm платим ЗП за salaryYm = calYm − 1.
  const salaryYm = shiftYm(calYm, -1);
  const plannedQ = useQuery({ queryKey: ['finance', 'planned-payments'], queryFn: () => financeApi.plannedPayments() });
  const projectsQ = useQuery({ queryKey: ['finance', 'projects'], queryFn: () => financeApi.projects() });
  // Рассрочки сотрудников (27.10.2026): дата каждого платежа — в календаре.
  const instQ = useQuery({
    queryKey: ['finance', 'installments', 'calendar', calYm],
    queryFn: () => financeApi.installmentsCalendar(calYm),
    ...keepMonth,
  });
  const debtsQ = useQuery({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() });
  // SMM-оплаты не лежат плановыми платежами — сроки считает страница SMM.
  // Берём её же данные на сегодня (тот же ключ, кэш общий), чтобы просрочки
  // SMM-клиентов попали в «Просрочено» (08.11.2026: не было Комерцбанка и Chrono).
  const nowYm = currentYm();
  const smmQ = useQuery({
    queryKey: ['finance', 'income-direction', 'smm', nowYm, ''],
    queryFn: () => financeApi.incomeDirectionDetail('smm', nowYm),
  });
  const subsQ = useQuery({ queryKey: ['finance', 'subscriptions'], queryFn: () => financeApi.subscriptions() });
  // Зарплата для календаря — тот же источник, что страница «Зарплата»:
  // expenseDetail('salary') → «К выплате» (toPay) за месяц. Совпадает с экраном.
  const salaryQ = useQuery({
    queryKey: ['finance', 'expenseDetail', 'salary', salaryYm],
    queryFn: () => financeApi.expenseDetail('salary', salaryYm),
    ...keepMonth,
  });
  // Операции журнала за месяц — берём только будущие разовые (не привязанные к
  // зарплате/подписке/долгу, чтобы не задваивать эти источники).
  const txMonthQ = useQuery({
    queryKey: ['finance', 'transactions', 'month-plan', calYm],
    queryFn: () => {
      // Последний день месяца считаем, а не пишем «31»: в сентябре такой даты
      // нет, Postgres отвергал ВЕСЬ запрос.
      const [y, m] = calYm.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      return financeApi.transactions({
        from: `${calYm}-01`,
        to: `${calYm}-${String(last).padStart(2, '0')}`,
        status: 'all', pageSize: 1000,
      });
    },
    ...keepMonth,
  });
  // Всё движение денег месяца и просроченное других месяцев — planItems.ts
  // (там же правила и тесты).
  const calTxns = useMemo(() => buildMonthItems({
    calYm, today: todayISO(),
    planned: plannedQ.data || [], projects: projectsQ.data || [], debts: debtsQ.data || [],
    subscriptions: subsQ.data || [], salary: salaryQ.data, txItems: txMonthQ.data?.items || [],
    installments: instQ.data || [],
  }), [calYm, plannedQ.data, projectsQ.data, debtsQ.data, subsQ.data, salaryQ.data, txMonthQ.data, instQ.data]);
  const lateOther = useMemo(() => buildLateOther({
    calYm, today: todayISO(),
    planned: plannedQ.data || [], projects: projectsQ.data || [], debts: debtsQ.data || [],
    smmRows: (smmQ.data as any)?.rows || [],
  }), [calYm, plannedQ.data, projectsQ.data, debtsQ.data, smmQ.data]);

  // Перетаскивание операции на другой день сохраняет дату в записи:
  // разовая → дата операции, план-платёж → срок оплаты, подписка → день оплаты.
  const canMovePlanItem = (item: any) => {
    const id = String(item.id || '');
    if (id.startsWith('tx-')) return true;               // разовая операция
    if (id.startsWith('pp-')) return !item.done;         // план-платёж, пока ожидается
    if (id.startsWith('sub-')) return !item.done;        // подписка, пока не оплачена
    if (id.startsWith('inst-')) return !item.done && item.installmentMethod === 'separate'; // рассрочка «отдельно»
    return false;                                        // зарплата, прогноз — не двигаем
  };
  async function movePlanItem(item: any, dateISO: string) {
    const id = String(item.id || '');
    try {
      if (id.startsWith('tx-')) await financeApi.updateTransaction(id.slice(3), { date: dateISO });
      else if (id.startsWith('pp-')) await financeApi.updatePlanned(id.slice(3), { dueDate: dateISO });
      else if (id.startsWith('sub-')) await financeApi.updateSubscription(id.slice(4), { dueDay: Number(dateISO.slice(8, 10)) || 1 });
      else if (id.startsWith('inst-')) await financeApi.setInstallmentDue(item.installmentId, { ym: item.installmentYm, date: dateISO });
      else return;
      invalidateFinanceAll(qc);
    } catch (e) { toast.error(apiErr(e)); throw e; }
  }

  const all = [plannedQ, projectsQ, instQ, debtsQ, subsQ, salaryQ, txMonthQ];
  const loading = all.some((q) => q.isLoading);
  const failed = all.find((q) => q.isError);
  const stale = instQ.isPlaceholderData || salaryQ.isPlaceholderData || txMonthQ.isPlaceholderData;
  // Соседний месяц заранее (08.11.2026) — те же три запроса, что зависят от месяца.
  const prefetch = (m: string) => {
    const sy = shiftYm(m, -1);
    const [y, mm] = m.split('-').map(Number);
    const last = new Date(y, mm, 0).getDate();
    qc.prefetchQuery({ queryKey: ['finance', 'installments', 'calendar', m], queryFn: () => financeApi.installmentsCalendar(m) });
    qc.prefetchQuery({ queryKey: ['finance', 'expenseDetail', 'salary', sy], queryFn: () => financeApi.expenseDetail('salary', sy) });
    qc.prefetchQuery({
      queryKey: ['finance', 'transactions', 'month-plan', m],
      queryFn: () => financeApi.transactions({ from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}`, status: 'all', pageSize: 1000 }),
    });
  };
  return (
    <div className={'fin-root' + (stale ? ' fin-stale' : '')}>
      <div className="page-head">
        <div><h1 className="flex"><FinIcon name="chart" size={22} /> Планирование</h1><p>Сколько придёт и уйдёт в месяце и когда</p></div>
        <div className="flex" style={{ gap: 8 }}>
          <MonthNav ym={calYm} onChange={setCalYm} prefetch={prefetch} />
          <button className="btn primary" onClick={() => setAdding(true)}><FinIcon name="plus" size={16} /> Платёж</button>
        </div>
      </div>
      {failed ? <FinLoadError onRetry={() => all.forEach((q) => q.isError && q.refetch())} />
        : loading ? <FinLoading cards={3} /> : (
          <PlanCalendar ym={calYm} txns={calTxns} lateOther={lateOther}
            renderStatusControl={(item, close) => <PlanningStatusControl item={item} ym={calYm} onClose={close} />}
            onMoveItem={movePlanItem} canMoveItem={canMovePlanItem} />
        )}
      {adding && <TransactionModal onClose={() => setAdding(false)} />}
    </div>
  );
}
