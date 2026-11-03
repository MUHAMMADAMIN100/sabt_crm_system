// «Планирование» (/finance/planning) — денежный календарь месяца, вариант А
// (выбор владельца 03.11.2026): итоги месяца, фильтры, значки статуса,
// просроченное красным. Режим «К прогнозу» и корректировки убраны — месяцы
// вперёд теперь в «Расходе» → «3 месяца / 6 месяцев / 1 год».
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { apiErr, currentYm, formatDate, money, monthLabel, pluralRu, shiftYm, todayISO } from './finlib';
import { FinLoadError, FinLoading, invalidateFinanceAll } from './FinKit';
import FinIcon from './FinIcon';
import MonthNav from './MonthNav';
import PlanCalendar from './PlanCalendar';
import TransactionModal from './TransactionModal';
import './finance.css';

// Проект «зарабатывает» — как на бэкенде (isEarningFinanceProject): не архивный
// и статус не в [lead, paused, done, archived]. Плановые доходы проектов на
// паузе не актуальны, пока проект не вернут в «Активный».
const NON_EARNING_PROJECT_STATUSES = new Set(['lead', 'paused', 'done', 'archived']);
const isEarningProject = (p: any) => !!p && !p.archived && !NON_EARNING_PROJECT_STATUSES.has(p.status || 'active');

const DIR_LABEL: Record<string, string> = { smm: 'SMM', development: 'Development', design: 'Design', maintenance: 'Обслуживание' };
// Собрать список деталей операции (label/value), отбросив пустые.
const detailList = (rows: (({ label: string; value: any }) | null | false | undefined)[]) =>
  rows.filter((r): r is { label: string; value: any } => !!r && r.value != null && r.value !== '');

/** Управление статусом операции в модалке «Планирования»: отметить
 *  полученной/оплаченной или вернуть в план. Работает для план-платежей
 *  (id `pp-…`) и подписок (`sub-…`); для остальных просто показывает статус. */
function PlanningStatusControl({ item, ym, onClose }: { item: any; ym: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  const activeAccounts = ((accounts as any[]) || []).filter((a) => !a.archived);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
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
  if (id.startsWith('due-')) {
    // Долг со сроком «вернуть до»: отдают на странице «Долги» (сразу или траншем).
    return (
      <div className="cal-item-rows">
        <div className="cal-item-row"><span>Статус</span><b>{item.date < todayISO() ? 'Срок прошёл' : 'Вернуть до этого дня'}</b></div>
        <Link to="/finance/expense/debts" className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>Открыть долги</Link>
      </div>
    );
  }
  if (!isPlan && !isSub) {
    return <div className="cal-item-rows"><div className="cal-item-row"><span>Статус</span><b>{doneLabel}</b></div></div>;
  }
  const rawId = isPlan ? id.slice(3) : id.slice(4);
  const date = String(item.date || '').slice(0, 10) || todayISO();

  async function mark() {
    if (busy || (isPlan && !accountId)) return;
    setBusy(true);
    try {
      if (isPlan) await financeApi.receivePlanned(rawId, { accountId, date });
      else await financeApi.markSubPaid(rawId, { ym, date });
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
            <div className="field"><label>{income ? 'На счёт' : 'Со счёта'}</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
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
  const [calYm, setCalYm] = useState(currentYm());
  // ── Данные календаря: всё движение денег по датам ──────────────────
  const calYear = calYm.slice(0, 4);
  // Зарплата выдаётся 10-го числа за ПРЕДЫДУЩИЙ месяц (работали в августе —
  // платим 10 сентября). Значит в месяце calYm платим ЗП за salaryYm = calYm − 1.
  const salaryYm = shiftYm(calYm, -1);
  const plannedQ = useQuery({ queryKey: ['finance', 'planned-payments'], queryFn: () => financeApi.plannedPayments() });
  const projectsQ = useQuery({ queryKey: ['finance', 'projects'], queryFn: () => financeApi.projects() });
  // Рассрочки сотрудников (27.10.2026): дата каждого платежа — в календаре.
  const instQ = useQuery({
    queryKey: ['finance', 'installments', 'calendar', calYm],
    queryFn: () => financeApi.installmentsCalendar(calYm),
  });
  const debtsQ = useQuery({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() });
  const subsQ = useQuery({ queryKey: ['finance', 'subscriptions'], queryFn: () => financeApi.subscriptions() });
  // Зарплата для календаря — тот же источник, что страница «Зарплата»:
  // expenseDetail('salary') → «К выплате» (toPay) за месяц. Совпадает с экраном.
  const salaryQ = useQuery({
    queryKey: ['finance', 'expenseDetail', 'salary', salaryYm],
    queryFn: () => financeApi.expenseDetail('salary', salaryYm),
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
  });
  const projById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of (projectsQ.data || [])) m.set(p.id, p);
    return m;
  }, [projectsQ.data]);
  const debtNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of (debtsQ.data || [])) m.set(d.id, d.name);
    return m;
  }, [debtsQ.data]);
  const debtById = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of (debtsQ.data || [])) m.set(d.id, d);
    return m;
  }, [debtsQ.data]);
  // Операции месяца по id — чтобы поставить полученную оплату на день прихода.
  const txById = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of ((txMonthQ.data?.items) || [])) m.set(t.id, t);
    return m;
  }, [txMonthQ.data]);

  // Единый список движения денег за месяц для календаря: приходы (оплаты
  // клиентов) + расходы (долги, аренда/подписки, зарплаты, разовые операции).
  const calTxns = useMemo(() => {
    const items: any[] = [];
    const today = todayISO();
    const lastDay = new Date(Number(calYear), Number(calYm.slice(5, 7)), 0).getDate();

    // Операции, привязанные к полученным план-платежам — не дублируем в источнике 4.
    const linkedTxIds = new Set<string>();

    // 1. Плановые платежи: проект → доход, долг → расход. Показываем и expected
    // (не сделано), и received (сделано, приглушённо). Дата: dueDate; без неё —
    // долг на 10-е, проект — на день контракта проекта, иначе 1-е число.
    for (const p of (plannedQ.data || [])) {
      if (p.status !== 'expected' && p.status !== 'received') continue;
      const planYm = p.dueDate ? String(p.dueDate).slice(0, 7) : (p.ym || '');
      if (planYm !== calYm) continue;
      if (p.receivedTxId) linkedTxIds.add(p.receivedTxId);
      const done = p.status === 'received';
      // Полученную оплату ставим на день, когда деньги ДЕЙСТВИТЕЛЬНО пришли, а
      // не на плановый срок: иначе приход 7-го висел на 1-м, и остаток на
      // счетах по дням врал всю первую неделю.
      const paidTx = done && p.receivedTxId ? txById.get(p.receivedTxId) : null;
      let date = paidTx?.date ? String(paidTx.date).slice(0, 10)
        : (p.dueDate ? String(p.dueDate).slice(0, 10) : '');
      if (p.projectId) {
        const proj = projById.get(p.projectId);
        // Проект на паузе — ПЛАНОВЫЙ доход не актуален; уже полученный оставляем.
        if (!done && !isEarningProject(proj)) continue;
        if (!date) {
          const cday = proj?.contractDate ? Math.min(Number(String(proj.contractDate).slice(8, 10)) || 1, lastDay) : 1;
          date = `${calYm}-${String(cday).padStart(2, '0')}`;
        }
        items.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'income', status: 'completed', done,
          comment: proj?.name || 'Оплата по проекту',
          details: detailList([
            { label: 'Направление', value: proj ? (DIR_LABEL[proj.direction] || proj.direction) : null },
          ]) });
      } else if (p.debtId) {
        const debt = debtById.get(p.debtId);
        if (!date) {
          // День платежа долга — из настройки долга (по умолчанию 10-е).
          const dday = Math.min(Number(debt?.dueDay) || 10, lastDay);
          date = `${calYm}-${String(dday).padStart(2, '0')}`;
        }
        // Кредит или рассрочка банка (30.10.2026) — «Рассрочка», не «Долг».
        const bank = debt?.kind === 'bank';
        const debtName = debtNameById.get(p.debtId);
        items.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'expense', status: 'completed', done,
          // Настоящий долг отдают траншами, не помесячно (31.10.2026).
          comment: bank ? (debtName || 'Платёж банку') : (debtName ? `${debtName} · транш` : 'Транш долга'),
          details: detailList(bank ? [
            { label: 'Рассрочка', value: debt?.name || debtName },
            { label: 'Банк', value: debt?.counterparty },
            { label: 'Осталось банку', value: debt?.remaining != null ? money(Number(debt.remaining)) : null },
            { label: 'Платёж/мес', value: debt?.monthlyPayment ? money(Number(debt.monthlyPayment)) : null },
            { label: 'День оплаты', value: `${Number(debt?.dueDay) || 10}-го` },
          ] : [
            { label: 'Долг', value: debt?.name || debtName },
            { label: 'Осталось отдать', value: debt?.remaining != null ? money(Number(debt.remaining)) : null },
            { label: 'Вернуть до', value: debt?.dueDate ? new Date(String(debt.dueDate).slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'без срока' },
          ]) });
      }
    }
    // 1б. Долг со сроком «вернуть до» (03.11.2026): сумма вне траншей — в день
    // срока. Раньше такой долг в календаре не появлялся вовсе.
    for (const d of (debtsQ.data || [])) {
      if (d.kind === 'bank' || !d.dueDate) continue;
      const due = String(d.dueDate).slice(0, 10);
      if (due.slice(0, 7) !== calYm) continue;
      const planned = (plannedQ.data || [])
        .filter((p: any) => p.debtId === d.id && p.status === 'expected')
        .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
      const left = Math.round((Number(d.remaining) - planned) * 100) / 100;
      if (!(left > 0.005)) continue;
      items.push({ id: `due-${d.id}`, date: due, amount: left, type: 'expense', status: 'completed', done: false,
        comment: `${d.name} · вернуть долг`,
        details: detailList([
          { label: 'Долг', value: d.name },
          { label: 'Осталось отдать', value: money(Number(d.remaining)) },
          { label: 'Вернуть до', value: formatDate(due) },
        ]) });
    }
    // 2. Аренда и подписки: активные, каждый месяц в день начала — с даты
    // начала (dueDate) до даты окончания (endDate). Оплаченный месяц — на
    // фактическую дату (paidMarks).
    for (const s of (subsQ.data || [])) {
      if (!s.active) continue;
      const startYm = s.dueDate ? String(s.dueDate).slice(0, 7) : null;
      const endYmSub = s.endDate ? String(s.endDate).slice(0, 7) : null;
      if (startYm && calYm < startYm) continue;   // ещё не началась
      if (endYmSub && calYm > endYmSub) continue;  // уже закончилась
      // «Оплачено» = отметка paidMark ИЛИ фактическая оплата операциями
      // (транзакции с subscriptionId за этот месяц покрывают сумму подписки).
      const mark = (s.paidMarks || []).find((pm: any) => pm.ym === calYm);
      const subTx = ((txMonthQ.data?.items) || []).filter((t: any) =>
        t.subscriptionId === s.id && t.status !== 'cancelled');
      const paidViaTx = subTx.reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);
      const done = !!mark || paidViaTx >= Number(s.amount) - 0.005;
      // День платежа: заданный день месяца, иначе день начала подписки
      // («каждый месяц в день начала»), и только потом 1-е. Server и Gpt Plus
      // без дня оплаты падали на 1-е число, хотя начались в середине месяца.
      const startDay = s.dueDate ? Number(String(s.dueDate).slice(8, 10)) : 0;
      const day = Math.min(Number(s.dueDay) || startDay || 1, lastDay);
      const paidDate = mark?.date ? String(mark.date).slice(0, 10)
        : (subTx.length ? String(subTx[subTx.length - 1].date).slice(0, 10) : null);
      const date = done && paidDate ? paidDate : `${calYm}-${String(day).padStart(2, '0')}`;
      if (s.endDate && !done && date > String(s.endDate).slice(0, 10)) continue; // позже окончания
      items.push({ id: `sub-${s.id}`, date, amount: s.amount, type: 'expense', status: 'completed', done, comment: s.name,
        details: detailList([
          { label: 'Категория', value: s.kind === 'rent' ? 'Аренда' : 'Подписка' },
          { label: 'Сумма/мес', value: money(Number(s.amount)) },
          { label: 'День оплаты', value: s.dueDay ? `${s.dueDay}-го` : null },
        ]) });
    }
    // 3. Зарплата. Деньги уходят НЕ одним платежом 10-го: авансы и выплаты
    // разбросаны по всему месяцу десятками операций. Раньше календарь прятал
    // их все и рисовал одну глыбу на 10-е — и врал про самый крупный расход
    // компании, и по дате, и по сумме дня. Теперь показываем фактические
    // выплаты на их днях (одной строкой на день), а остаток обязательства —
    // отдельной строкой впереди.
    const salCards = salaryQ.data?.cards || {};
    const salToPay = Math.max(0, Math.round(Number(salCards.toPay || 0) * 100) / 100);
    const salByDay = new Map<string, { sum: number; rows: { label: string; value: any }[] }>();
    for (const t of ((txMonthQ.data?.items) || [])) {
      if (t.status === 'cancelled' || t.type !== 'expense' || !t.employeeId) continue;
      const d = String(t.date || '').slice(0, 10);
      if (!d) continue;
      const cur = salByDay.get(d) || { sum: 0, rows: [] };
      cur.sum += Number(t.amount) || 0;
      cur.rows.push({ label: t.employeeName || t.comment || 'Выплата', value: money(Number(t.amount) || 0) });
      salByDay.set(d, cur);
    }
    for (const [d, v] of salByDay) {
      items.push({ id: `salpaid-${d}`, date: d, amount: Math.round(v.sum * 100) / 100,
        type: 'expense', status: 'completed', done: d <= today,
        comment: v.rows.length > 1 ? `Зарплаты · ${pluralRu(v.rows.length, 'выплата', 'выплаты', 'выплат')}` : 'Зарплата',
        details: detailList([{ label: 'Всего за день', value: money(v.sum) }, ...v.rows]) });
    }
    if (salToPay > 0.005) {
      // Просроченный остаток не рисуем в прошлом: деньги, которые ещё не ушли,
      // уйдут начиная с сегодняшнего дня — иначе остаток по дням считался бы
      // от несуществующего платежа.
      const planned = `${calYm}-10`;
      const salDate = calYm === currentYm() && planned < today ? today : planned;
      const empCount = (salaryQ.data?.rows || []).length;
      items.push({ id: `salary-${calYm}`, date: salDate, amount: salToPay, type: 'expense', status: 'completed', done: false,
        comment: `Зарплаты за ${monthLabel(salaryYm)} · осталось`,
        details: detailList([
          { label: 'За месяц', value: monthLabel(salaryYm, true) },
          { label: 'Сотрудников', value: empCount ? String(empCount) : null },
          { label: 'Фонд', value: salCards.fund ? money(Number(salCards.fund)) : null },
          { label: 'Уже выплачено', value: salCards.paid ? money(Number(salCards.paid)) : null },
          { label: 'Осталось доплатить', value: money(salToPay) },
          { label: 'Плановый день', value: `${monthLabel(calYm, true)}, 10-е` },
        ]) });
    }
    // 4. Прочие операции журнала за месяц (без привязки к ЗП/подписке/долгу/
    // полученному план-платежу). Прошедшие (≤ сегодня) — сделано (приглушённо),
    // будущие — обычное.
    for (const t of ((txMonthQ.data?.items) || [])) {
      if (t.status === 'cancelled') continue;
      if (t.type !== 'income' && t.type !== 'expense') continue;
      if (t.employeeId || t.subscriptionId || t.debtId) continue;
      if (linkedTxIds.has(t.id)) continue; // уже показан как полученный план-платёж
      // Плановый доход проекта на паузе не актуален; фактический (прошедший) оставляем.
      const past = String(t.date || '').slice(0, 10) <= today;
      if (!past && t.projectId && !isEarningProject(projById.get(t.projectId))) continue;
      const txTitle = t.comment || t.categoryName || (t.type === 'income' ? 'Поступление' : 'Расход');
      items.push({ id: `tx-${t.id}`, date: t.date, amount: t.amount, type: t.type, status: 'completed', done: past,
        comment: txTitle,
        details: detailList([
          { label: 'Категория', value: t.categoryName },
          { label: 'Счёт', value: t.accountName },
          { label: 'Проект', value: t.projectId ? projById.get(t.projectId)?.name : null },
        ]) });
    }
    // 5. Прогноз повторяющегося дохода по SMM/обслуживанию на «ориентировочный
    // срок» проекта. Текущий и будущие месяцы (прошлые считаем по фактам и планам).
    // Обслуживание в CRM — виртуальные планы (не сохраняются в БД), поэтому в
    // текущем месяце его нужно показывать именно из этого прогноза. Двойного счёта
    // нет: проекты с сохранённым планом/оплатой за месяц отсекает coveredProjIds.
    const curYm = currentYm();
    if (calYm >= curYm) {
      const coveredProjIds = new Set<string>();
      for (const p of (plannedQ.data || [])) {
        const py = p.dueDate ? String(p.dueDate).slice(0, 7) : (p.ym || '');
        if (p.projectId && py === calYm) coveredProjIds.add(p.projectId);
      }
      for (const t of ((txMonthQ.data?.items) || [])) {
        if (t.type === 'income' && t.projectId && String(t.date || '').slice(0, 7) === calYm) coveredProjIds.add(t.projectId);
      }
      for (const proj of projById.values()) {
        if (proj.direction !== 'smm' && proj.direction !== 'maintenance') continue;
        if (!isEarningProject(proj) || !(Number(proj.tariff) > 0)) continue;
        if (coveredProjIds.has(proj.id)) continue;
        const startYm = proj.contractDate ? String(proj.contractDate).slice(0, 7) : curYm;
        if (calYm < startYm) continue; // проект ещё не начался
        // Горизонт: срок вперёд от текущего месяца; «бессрочно» (null) = 12 мес.
        const horizonN = proj.retentionMonths != null ? Number(proj.retentionMonths) : 12;
        if (calYm > shiftYm(curYm, horizonN)) continue; // за пределом срока
        const cday = proj.contractDate ? Math.min(Number(String(proj.contractDate).slice(8, 10)) || 1, lastDay) : 1;
        items.push({ id: `fc-${proj.id}-${calYm}`, date: `${calYm}-${String(cday).padStart(2, '0')}`,
          amount: Number(proj.tariff), type: 'income', status: 'completed', done: false, comment: proj.name,
          details: detailList([
            { label: 'Направление', value: DIR_LABEL[proj.direction] || proj.direction },
            { label: 'Прогноз', value: proj.retentionMonths ? `на ${proj.retentionMonths} мес. вперёд` : 'бессрочно (12 мес.)' },
          ]) });
      }
    }
    // 6. Рассрочки сотрудников. «Платит отдельно» — ожидаемый приход на свою
    // дату (просроченный — на сегодня, как остаток зарплаты). «Из зарплаты» и
    // уже полученное — пометка без влияния на остаток: деньги не приходят
    // отдельно, просто меньше уходит на зарплату, а полученное со счётом уже
    // есть в журнале операций.
    for (const x of (instQ.data || [])) {
      const separate = x.method === 'separate';
      const late = x.status === 'overdue';
      const paidOff = x.status === 'done';
      const expected = separate && !paidOff;
      const date = late && x.date < today && calYm === currentYm() ? today : x.date;
      items.push({
        id: `inst-${x.key}`, date, amount: expected ? (Number(x.outstanding) || Number(x.amount)) : Number(x.amount),
        type: expected ? 'income' : 'note', status: 'completed',
        done: paidOff,
        comment: `Рассрочка · ${x.employeeName}${late ? ' · просрочено' : ''}`,
        installmentId: x.installmentId, installmentYm: x.ym, installmentMethod: x.method,
        details: detailList([
          { label: 'Что куплено', value: x.name },
          { label: 'Как возвращает', value: separate ? 'платит отдельно' : 'удерживаем из зарплаты' },
          { label: 'Срок', value: formatDate(x.date) },
          late ? { label: 'Статус', value: 'просрочено' } : paidOff ? { label: 'Статус', value: 'получено' } : null,
          { label: 'Остаток по рассрочке', value: money(Number(x.remaining) || 0) },
        ]) });
    }
    // Мелочь в одну строку: «Транспорт −20» занимал строку наравне с арендой
    // на 6 000, и за ними не было видно обязательств. Сворачиваем, только если
    // мелких расходов за день набралось несколько.
    const MINOR_MAX = 300;
    const byDate = new Map<string, any[]>();
    for (const it of items) {
      const d = String(it.date || '').slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(it);
    }
    const out: any[] = [];
    for (const [d, list] of byDate) {
      const minor = list.filter(x => String(x.id).startsWith('tx-') && x.type === 'expense'
        && (Number(x.amount) || 0) <= MINOR_MAX);
      if (minor.length < 2) { out.push(...list); continue; }
      const rest = list.filter(x => !minor.includes(x));
      const sum = minor.reduce((a, x) => a + (Number(x.amount) || 0), 0);
      out.push(...rest);
      out.push({ id: `misc-${d}`, date: d, amount: Math.round(sum * 100) / 100,
        type: 'expense', status: 'completed', done: minor.every(x => x.done),
        comment: `Прочее · ${pluralRu(minor.length, 'операция', 'операции', 'операций')}`,
        details: detailList(minor.map(x => ({ label: x.comment, value: money(Number(x.amount) || 0) }))) });
    }
    return out;
  }, [plannedQ.data, subsQ.data, salaryQ.data, txMonthQ.data, instQ.data, txById, projById, debtNameById, debtById, calYm, calYear, salaryYm]);

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
  return (
    <div className="fin-root">
      <div className="page-head">
        <div><h1 className="flex"><FinIcon name="chart" size={22} /> Планирование</h1><p>Сколько придёт и уйдёт в месяце и когда</p></div>
        <div className="flex" style={{ gap: 8 }}>
          <MonthNav ym={calYm} onChange={setCalYm} />
          <button className="btn primary" onClick={() => setAdding(true)}><FinIcon name="plus" size={16} /> Платёж</button>
        </div>
      </div>
      {failed ? <FinLoadError onRetry={() => all.forEach((q) => q.isError && q.refetch())} />
        : loading ? <FinLoading cards={3} /> : (
          <PlanCalendar ym={calYm} txns={calTxns}
            renderStatusControl={(item, close) => <PlanningStatusControl item={item} ym={calYm} onClose={close} />}
            onMoveItem={movePlanItem} canMoveItem={canMovePlanItem} />
        )}
      {adding && <TransactionModal onClose={() => setAdding(false)} />}
    </div>
  );
}
