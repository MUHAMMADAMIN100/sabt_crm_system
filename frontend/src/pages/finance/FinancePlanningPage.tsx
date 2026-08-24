import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { apiErr, currentYm, formatDate, money, monthLabel, shiftYm, todayISO } from './finlib';
import { FinLoadError, FinLoading, FinModal } from './FinKit';
import FinIcon from './FinIcon';
import MonthNav from './MonthNav';
import { TxCalendar } from './FinanceTransactionsPage';
import ImportedArchiveBadge, { isImportedArchive } from './ImportedArchiveBadge';
import { floatingPosition, scrollableAncestors, type FloatingPosition } from './floatingPosition';
import './finance.css';
import { PlanningCashFlowChart } from './FinanceCharts';
import { AccountMark } from './AccountIdentity';

const scenarios: Record<string, string> = { conservative: 'Осторожный', base: 'Базовый', optimistic: 'Оптимистичный' };

// Проект «зарабатывает» — как на бэкенде (isEarningFinanceProject): не архивный
// и статус не в [lead, paused, done, archived]. Плановые доходы проектов на
// паузе не актуальны, пока проект не вернут в «Активный».
const NON_EARNING_PROJECT_STATUSES = new Set(['lead', 'paused', 'done', 'archived']);
const isEarningProject = (p: any) => !!p && !p.archived && !NON_EARNING_PROJECT_STATUSES.has(p.status || 'active');

const DIR_LABEL: Record<string, string> = { smm: 'SMM', development: 'Development', design: 'Design', maintenance: 'Обслуживание' };
// Собрать список деталей операции (label/value), отбросив пустые.
const detailList = (rows: (({ label: string; value: any }) | null | false | undefined)[]) =>
  rows.filter((r): r is { label: string; value: any } => !!r && r.value != null && r.value !== '');

export default function FinancePlanningPage() {
  const qc = useQueryClient();
  const currentYear = Number(currentYm().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const start = `${year}-01`;
  const months = 12;
  const [scenario, setScenario] = useState('base');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Денежный календарь открыт по умолчанию; кнопкой можно переключиться на прогноз.
  const [showCalendar, setShowCalendar] = useState(true);
  const [calYm, setCalYm] = useState(currentYm());
  const query = useQuery({
    queryKey: ['finance', 'forecast', start, months, scenario],
    queryFn: () => financeApi.forecast({ start, months, scenario }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => financeApi.removeForecastAdjustment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'forecast'] }),
    onError: (e) => toast.error(apiErr(e)),
  });
  // ── Данные календаря: всё движение денег по датам ──────────────────
  const calYear = calYm.slice(0, 4);
  // Зарплата выдаётся 10-го числа за ПРЕДЫДУЩИЙ месяц (работали в августе —
  // платим 10 сентября). Значит в месяце calYm платим ЗП за salaryYm = calYm − 1.
  const salaryYm = shiftYm(calYm, -1);
  const plannedQ = useQuery({
    queryKey: ['finance', 'planned-payments'],
    queryFn: () => financeApi.plannedPayments(),
    enabled: showCalendar,
  });
  const projectsQ = useQuery({
    queryKey: ['finance', 'projects'],
    queryFn: () => financeApi.projects(),
    enabled: showCalendar,
  });
  const debtsQ = useQuery({
    queryKey: ['finance', 'debts'],
    queryFn: () => financeApi.debts(),
    enabled: showCalendar,
  });
  const subsQ = useQuery({
    queryKey: ['finance', 'subscriptions'],
    queryFn: () => financeApi.subscriptions(),
    enabled: showCalendar,
  });
  // Зарплата для календаря — тот же источник, что страница «Зарплата»:
  // expenseDetail('salary') → «К выплате» (toPay) за месяц. Совпадает с экраном.
  const salaryQ = useQuery({
    queryKey: ['finance', 'expenseDetail', 'salary', salaryYm],
    queryFn: () => financeApi.expenseDetail('salary', salaryYm),
    enabled: showCalendar,
  });
  // Операции журнала за месяц — берём только будущие разовые (не привязанные к
  // зарплате/подписке/долгу, чтобы не задваивать эти источники).
  const txMonthQ = useQuery({
    queryKey: ['finance', 'transactions', 'month-plan', calYm],
    queryFn: () => financeApi.transactions({ from: `${calYm}-01`, to: `${calYm}-31`, status: 'all', pageSize: 1000 }),
    enabled: showCalendar,
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

  // Единый список движения денег за месяц для TxCalendar: приходы (оплаты
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
      let date = p.dueDate ? String(p.dueDate).slice(0, 10) : '';
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
            { label: 'Проект', value: proj?.name },
            { label: 'Направление', value: proj ? (DIR_LABEL[proj.direction] || proj.direction) : null },
            { label: 'Тариф', value: proj?.tariff ? money(Number(proj.tariff)) : null },
            { label: 'Дата контракта', value: proj?.contractDate ? formatDate(proj.contractDate) : null },
            { label: 'Часть', value: p.partNo ? `№${p.partNo}` : null },
          ]) });
      } else if (p.debtId) {
        if (!date) date = `${calYm}-10`; // долги — 10-го числа
        const debt = debtById.get(p.debtId);
        items.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'expense', status: 'completed', done,
          comment: debtNameById.get(p.debtId) || 'Погашение долга',
          details: detailList([
            { label: 'Долг', value: debt?.name || debtNameById.get(p.debtId) },
            { label: 'Кому', value: debt?.counterparty },
            { label: 'Остаток долга', value: debt?.remaining != null ? money(Number(debt.remaining)) : null },
            { label: 'Платёж/мес', value: debt?.monthlyPayment ? money(Number(debt.monthlyPayment)) : null },
          ]) });
      }
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
      const day = Math.min(Number(s.dueDay) || 1, lastDay);
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
    // 3. Зарплата за ПРЕДЫДУЩИЙ месяц выплачивается 10-го числа. В календаре
    // показываем ТОЛЬКО реальный отток этого дня — остаток «к выплате». Уже
    // выданные авансы/бонусы ушли в своём месяце и не относятся к 10-му числу.
    const salaryToPay = Number(salaryQ.data?.cards?.toPay || 0);
    if (salaryToPay > 0) {
      const cards = salaryQ.data?.cards || {};
      const empCount = (salaryQ.data?.rows || []).length;
      items.push({ id: `salary-topay-${calYm}`, date: `${calYm}-10`, amount: salaryToPay, type: 'expense', status: 'completed', done: false,
        comment: `Зарплаты за ${monthLabel(salaryYm)}`,
        details: detailList([
          { label: 'За месяц', value: monthLabel(salaryYm, true) },
          { label: 'Сотрудников', value: empCount ? String(empCount) : null },
          { label: 'Фонд', value: cards.fund ? money(Number(cards.fund)) : null },
          { label: 'Уже выдано', value: cards.paid ? money(Number(cards.paid)) : null },
          { label: 'К выплате 10-го', value: money(salaryToPay) },
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
    // 5. Прогноз будущего дохода по SMM/обслуживанию на «ориентировочный срок»
    // проекта. Только будущие месяцы (текущий/прошлые считаем по фактам и планам).
    // Не дублируем проекты, у которых уже есть план/оплата за этот месяц.
    const curYm = currentYm();
    if (calYm > curYm) {
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
            { label: 'Проект', value: proj.name },
            { label: 'Направление', value: DIR_LABEL[proj.direction] || proj.direction },
            { label: 'Тариф', value: money(Number(proj.tariff)) },
            { label: 'Дата контракта', value: proj.contractDate ? formatDate(proj.contractDate) : null },
            { label: 'Прогноз', value: proj.retentionMonths ? `на ${proj.retentionMonths} мес. вперёд` : 'бессрочно (12 мес.)' },
          ]) });
      }
    }
    return items;
  }, [plannedQ.data, subsQ.data, salaryQ.data, txMonthQ.data, projById, debtNameById, debtById, calYm, calYear, salaryYm]);
  if (query.isLoading) return <div className="fin-root"><FinLoading cards={4} /></div>;
  if (query.isError) return <div className="fin-root"><FinLoadError onRetry={() => query.refetch()} /></div>;
  const data = query.data;
  const availableYear = Number(String(data.availableFrom || start).slice(0, 4)) || year;
  const firstYear = Math.min(availableYear, currentYear);
  const lastYear = Math.max(currentYear + 5, year);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  const visibleRows = data.rows.filter((row: any) => !data.availableFrom || row.ym >= data.availableFrom);
  const periodStart = data.availableFrom?.startsWith(`${year}-`) ? data.availableFrom : `${year}-01`;
  return (
    <div className="fin-root">
      <div className="page-head">
        <div><h1 className="flex"><FinIcon name="chart" size={22} /> Планирование</h1><p>Прогноз движения денег по уже известным доходам и обязательствам</p></div>
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setShowCalendar(v => !v)}>
            <FinIcon name="overview" size={15} /> {showCalendar ? 'К прогнозу' : 'Денежный календарь'}
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Корректировка</button>
        </div>
      </div>
      {showCalendar ? (
      <div className="fin-plan-payments-cal" style={{ marginTop: 16 }}>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <p className="muted mini" style={{ margin: 0 }}>Всё движение денег по датам: приходы от клиентов (+) и расходы — долги, аренда/подписки, зарплаты, разовые платежи (−). Суммы на дне.</p>
          <MonthNav ym={calYm} onChange={setCalYm} />
        </div>
        {(plannedQ.isLoading || subsQ.isLoading || txMonthQ.isLoading || salaryQ.isLoading) ? <FinLoading /> : (
          <TxCalendar ym={calYm} txns={calTxns} onAdd={() => {}} hideAdd planMode />
        )}
      </div>
      ) : (<>
      <div className="fin-plan-controls">
        <div className="field fin-plan-period-field">
          <label>Период планирования</label>
          <strong>{monthLabel(periodStart, true)} — {monthLabel(`${year}-12`, true)}</strong>
        </div>
        <div className="fin-segments" role="group" aria-label="Сценарий прогноза">
          {Object.entries(scenarios).map(([key, label]) => (
            <button key={key} className={scenario === key ? 'active' : ''}
              aria-pressed={scenario === key} onClick={() => setScenario(key)}>{label}</button>
          ))}
        </div>
      </div>
      {data.summary.cashGapYm && <div className="fin-plan-warning">Внимание: при этом сценарии возможен кассовый разрыв в {monthLabel(data.summary.cashGapYm, true)}.</div>}
      <div className="cards grid-4">
        <div className="card"><span className="muted mini">Текущий баланс</span><div className="value">{money(data.openingBalance)}</div></div>
        <div className="card"><span className="muted mini">Доход за период · факт + план</span><div className="value pos">{money(data.summary.expectedIncome)}</div></div>
        <div className="card"><span className="muted mini">Расход за период · факт + план</span><div className="value neg">{money(data.summary.expectedExpense)}</div></div>
        <div className="card"><span className="muted mini">Баланс в конце</span><div className={`value ${data.summary.endingBalance < 0 ? 'neg' : ''}`}>{money(data.summary.endingBalance)}</div></div>
      </div>
      <PlanningCashFlowChart rows={visibleRows} scenarioLabel={scenarios[scenario]} cashGapYm={data.summary.cashGapYm} dataTableId="fin-planning-data" />
      <div className="table-wrap"><table id="fin-planning-data"><caption className="sr-only">Подробные значения прогноза движения денег по месяцам</caption><thead><tr><th>Месяц</th><th>Доход · факт / осталось</th><th>Расход · факт / осталось</th><th>Результат</th><th>Баланс сейчас / после плана</th></tr></thead><tbody>
        {visibleRows.map((r: any) => {
          const toggle = () => setExpanded(expanded === r.ym ? null : r.ym);
          const isCurrentMonth = r.ym === currentYm();
          return <Fragment key={r.ym}><tr className={`clickable${isCurrentMonth ? ' fin-current-month-row' : ''}`} aria-expanded={expanded === r.ym}
            tabIndex={0} onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
              }
            }}>
          <td>
            <strong>{monthLabel(r.ym, true)}</strong>
            {isCurrentMonth && <small className="fin-current-month-badge">текущий месяц</small>}
            {r.balanceReset && (
              <small className="fin-plan-balance-reset"
                title="С этого месяца остаток считается по счетам CRM, а не по архиву Notion">
                переход на остатки CRM
              </small>
            )}
          </td>
          <td><FlowCell tone="income" actual={r.actualIncome} planned={r.plannedIncome} total={r.income} /></td>
          <td><FlowCell tone="expense" actual={r.actualExpense} planned={r.plannedExpense} total={r.expense} /></td>
          <td><FlowCell actual={r.actualIncome - r.actualExpense} planned={r.plannedIncome - r.plannedExpense} total={r.net} signed /></td>
          <td><BalanceCell current={r.balanceNow} forecast={r.closingBalance} /></td>
        </tr>{expanded === r.ym && <tr className="fin-plan-detail-row"><td colSpan={5}><div className="fin-plan-detail">
          <SourceList title="Доходы" tone="income" rows={r.incomeSources} remove={(id) => remove.mutate(id)} />
          <SourceList title="Расходы" tone="expense" rows={r.expenseSources} remove={(id) => remove.mutate(id)} />
        </div></td></tr>}</Fragment>;
        })}
      </tbody></table></div>
      <div className="fin-plan-year-nav" role="group" aria-label="Выбор года планирования">
        <button type="button" className="btn ghost" disabled={year <= firstYear} onClick={() => setYear(year - 1)}>‹</button>
        <label>
          <span>Другой год</span>
          <select aria-label="Другой год" value={year} onChange={event => setYear(Number(event.target.value))}>
            {years.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button type="button" className="btn ghost" onClick={() => setYear(year + 1)}>›</button>
      </div>
      </>)}
      {adding && <AdjustmentModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['finance', 'forecast'] }); }} />}
    </div>
  );
}

function SourceList({ title, tone, rows, remove }: { title: string; tone: 'income' | 'expense'; rows: any[]; remove: (id: string) => void }) {
  const salaryRows = rows.filter(x => x.salary || String(x.kind).startsWith('Зарплата'));
  const salaryMap = new Map<string, any>();
  for (const row of salaryRows) {
    const prev = salaryMap.get(row.label);
    salaryMap.set(row.label, prev
      ? {
          ...prev,
          amount: Number(prev.amount) + Number(row.amount),
          imported: isImportedArchive(prev) || isImportedArchive(row),
        }
      : { ...row });
  }
  const salaries = [...salaryMap.values()];
  const visible = rows.filter(x => !(x.salary || String(x.kind).startsWith('Зарплата')));
  if (salaries.length) visible.unshift({
    key: 'salary-group',
    label: 'Зарплата',
    kind: `${salaries.length} сотрудников`,
    amount: salaries.reduce((s, x) => s + Number(x.amount), 0),
    salaries,
    imported: salaries.some(isImportedArchive),
  });
  return <div className={`fin-plan-column ${tone}`}>
    <div className="fin-plan-column-title"><strong>{title}</strong><span>{money(rows.reduce((s, x) => s + Number(x.amount), 0))}</span></div>
    {visible.length ? visible.map(x => x.salaries
      ? <SalaryGroup key={x.key} group={x} />
      : <PlanSource key={x.key} source={x} remove={remove} />
    ) : <p className="muted">Нет ожидаемых операций</p>}
  </div>;
}

function sourceMeta(source: any): string[] {
  return [
    source.date ? (String(source.date).length >= 10 ? formatDate(source.date) : String(source.date)) : null,
    source.categoryName ? `категория: ${source.categoryName}` : null,
    source.accountName ? `счёт: ${source.accountName}` : null,
  ].filter(Boolean) as string[];
}

function PlanSource({ source, remove }: { source: any; remove: (id: string) => void }) {
  const meta = sourceMeta(source);
  return (
    <div className={`fin-plan-source${isImportedArchive(source) ? ' imported' : ''}`}>
      <span>
        <span className="fin-plan-source-label">
          {source.label}
          {isImportedArchive(source) && <ImportedArchiveBadge />}
        </span>
        <small>{source.kind}</small>
        {meta.length > 0 && <span className="fin-plan-source-meta-row">
          {source.accountName && <AccountMark name={source.accountName} compact />}
          <small className="fin-plan-source-meta">{meta.join(' · ')}</small>
        </span>}
      </span>
      <b>{money(source.amount)}</b>
      {source.adjustmentId && (
        <button onClick={() => remove(source.adjustmentId)} title="Удалить"
          aria-label={`Удалить корректировку «${source.label}»`}>×</button>
      )}
    </div>
  );
}

function SalaryGroup({ group }: { group: any }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<FloatingPosition | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos(floatingPosition(rect, 410, Math.min(390, window.innerHeight * .7)));
  }, []);
  useEffect(() => {
    if (!open || pinned) return;
    pinTimer.current = setTimeout(() => setPinned(true), 5_500);
    return () => { if (pinTimer.current) clearTimeout(pinTimer.current); };
  }, [open, pinned]);
  useEffect(() => () => {
    if (pinTimer.current) clearTimeout(pinTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    if (!open) return;
    const ancestors = scrollableAncestors(anchorRef.current);
    window.addEventListener('resize', updatePosition);
    ancestors.forEach((el) => el.addEventListener('scroll', updatePosition, { passive: true }));
    return () => {
      window.removeEventListener('resize', updatePosition);
      ancestors.forEach((el) => el.removeEventListener('scroll', updatePosition));
    };
  }, [open, updatePosition]);
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    updatePosition();
    setOpen(true);
  };
  const leave = () => {
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const close = (e: MouseEvent) => { e.stopPropagation(); setPinned(false); setOpen(false); };
  const togglePinned = () => {
    updatePosition();
    setOpen((wasOpen) => {
      const nextOpen = !wasOpen || !pinned;
      setPinned(nextOpen);
      return nextOpen;
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePinned();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setPinned(false);
      setOpen(false);
    }
  };
  return <div ref={anchorRef} className="fin-plan-source has-popover"
    role="button" tabIndex={0} aria-expanded={open} aria-controls={open ? popoverId : undefined}
    aria-label={`Показать зарплаты ${group.kind}`}
    onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
    onClick={togglePinned} onKeyDown={onKeyDown}>
    <span>
      <span className="fin-plan-source-label">
        {group.label}
        {isImportedArchive(group) && <ImportedArchiveBadge />}
      </span>
      <small>{group.kind}</small>
    </span>
    <b>{money(group.amount)}</b>
    {open && pos && createPortal(<div id={popoverId} className={`fin-salary-popover open${pinned ? ' pinned' : ''}`}
      role="dialog" aria-label="Зарплата сотрудников" tabIndex={-1}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
      onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onMouseLeave={leave}
      onFocus={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onBlur={leave}
      onClick={e => e.stopPropagation()}>
      <div className="fin-salary-popover-head"><strong>Зарплата сотрудников</strong><b>{money(group.amount)}</b>
        {pinned && <button className="fin-payout-close" type="button" aria-label="Закрыть" onClick={close}><FinIcon name="close" size={14} /></button>}
      </div>
      <div className="fin-salary-popover-body">{group.salaries.map((person: any) => {
        const meta = sourceMeta(person);
        return <div key={person.key}>
          <span>
            {person.label}
            {meta.length > 0 && <small className="fin-salary-person-meta">{meta.join(' · ')}</small>}
          </span>
          <b>{money(person.amount)}</b>
        </div>;
      })}</div>
      <div className={'fin-payout-pin-hint' + (pinned ? ' pinned' : '')}>{pinned ? 'Окно закреплено — можно прокручивать' : 'Задержите курсор, чтобы закрепить окно'}</div>
    </div>, document.body)}
  </div>;
}

function FlowCell({ actual, planned, total, tone, signed = false }: {
  actual: number; planned: number; total: number; tone?: 'income' | 'expense'; signed?: boolean;
}) {
  const hasFact = Math.abs(Number(actual) || 0) > .004;
  const hasPlan = Math.abs(Number(planned) || 0) > .004;
  const shown = hasFact ? actual : total;
  const cls = tone === 'income' ? 'pos' : tone === 'expense' ? 'neg' : Number(shown) < 0 ? 'neg' : '';
  const remainderLabel = tone === 'income' ? 'осталось получить' : tone === 'expense' ? 'осталось оплатить' : 'ожидаемое изменение';
  return <div className={`fin-plan-flow-cell ${cls}`}>
    <strong>{money(shown, signed)}</strong>
    <small>{hasFact ? 'факт' : remainderLabel}{hasFact && hasPlan ? ` · ${remainderLabel} ${money(planned, signed)}` : ''}</small>
  </div>;
}

function BalanceCell({ current, forecast }: { current?: number | null; forecast: number }) {
  const now = current == null ? null : Number(current);
  const shown = now ?? Number(forecast);
  return <div className={`fin-plan-flow-cell ${shown < 0 ? 'neg' : ''}`}>
    <strong>{money(shown)}</strong>
    <small>{now == null ? 'прогноз' : `сейчас · после планов ${money(forecast)}`}</small>
  </div>;
}

function AdjustmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', type: 'expense', amount: '', startYm: currentYm(), endYm: '', recurrence: 'once', scenario: 'all', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await financeApi.createForecastAdjustment({ ...form, amount: Number(form.amount) }); onSaved(); } catch (e) { toast.error(apiErr(e)); setBusy(false); } };
  return <FinModal title="Корректировка прогноза" onClose={onClose} width={520} footer={<><button className="btn ghost" onClick={onClose}>Отмена</button><button className="btn primary" disabled={busy || !form.name || !form.amount} onClick={save}>Добавить</button></>}>
    <div className="field"><label>Название</label><input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Налог, новая услуга, покупка…" /></div>
    <div className="form-grid"><div className="field"><label>Тип</label><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="income">Доход</option><option value="expense">Расход</option></select></div><div className="field"><label>Сумма</label><input inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div></div>
    <div className="form-grid"><div className="field"><label>С месяца</label><input type="month" value={form.startYm} onChange={e => setForm({ ...form, startYm: e.target.value })} /></div><div className="field"><label>Повторение</label><select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value })}><option value="once">Один раз</option><option value="monthly">Каждый месяц</option></select></div></div>
    {form.recurrence === 'monthly' && <div className="field"><label>До месяца (необязательно)</label><input type="month" value={form.endYm} onChange={e => setForm({ ...form, endYm: e.target.value })} /></div>}
    <div className="field"><label>Сценарий</label><select value={form.scenario} onChange={e => setForm({ ...form, scenario: e.target.value })}><option value="all">Все сценарии</option><option value="base">Базовый</option><option value="conservative">Осторожный</option><option value="optimistic">Оптимистичный</option></select></div>
  </FinModal>;
}
