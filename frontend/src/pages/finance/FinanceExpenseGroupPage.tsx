// Статья расхода /finance/expense/:kind (salary | rent_subs | debts | other) —
// порт fin-webrand/src/pages/ExpenseGroup.tsx (ТЗ 4.2–4.5).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, currentYm, todayISO, formatDate, monthLabel, apiErr, downloadCsv, EXPENSE_GROUPS, OTHER_GROUP, useYmParam, salaryComment, withYm } from './finlib';
import { FinLoading, FinLoadError, FinModal, useModalKeys, finConfirm, invalidateFinance } from './FinKit';
import { EmployeeFormModal, SubFormModal } from './FinForms';
import FinIcon, { CatIcon } from './FinIcon';
import MonthNav from './MonthNav';
import EmployeeSalaryHistory from './EmployeeSalaryHistory';
import { InstallmentsList, InstallmentSalaryField, INSTALLMENT_COLOR } from './InstallmentsSection';
import { DebtsList } from './DebtsBoard';
import './finance.css';

const SALARY_ROW_CONTROL_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '[data-history-toggle-ignore]',
].join(',');

function isSalaryRowControl(target: EventTarget | null) {
  return target instanceof Element && target.closest(SALARY_ROW_CONTROL_SELECTOR) !== null;
}

/** ФИО в ведомости — только фамилия и имя (первые два слова); отчество убираем. */
function shortName(name?: string) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(' ') : (name ?? '');
}

export default function FinanceExpenseGroupPage() {
  const { kind } = useParams<{ kind: string }>();
  const location = useLocation();
  // Зарплатная ведомость по умолчанию показывает предыдущий календарный месяц
  // и остаётся на нём до явного закрытия после выплаты. Сервер переключит её
  // на текущий месяц, когда предыдущий будет закрыт.
  // Месяц приходит из адреса (?ym=…) — тот же, что был выбран в «Расходах».
  const [ym, setYm] = useYmParam(currentYm());
  const openedWithoutMonth = useRef(!new URLSearchParams(location.search).has('ym'));
  const { data: payrollDefault } = useQuery({
    queryKey: ['finance', 'salaryPeriod', 'current'],
    queryFn: () => financeApi.salaryPeriod(),
    enabled: kind === 'salary' && openedWithoutMonth.current,
  });
  useEffect(() => {
    if (kind !== 'salary' || !openedWithoutMonth.current || !payrollDefault?.latestOpenYm) return;
    openedWithoutMonth.current = false;
    setYm(payrollDefault.latestOpenYm);
  }, [kind, payrollDefault?.latestOpenYm, setYm]);

  if (kind === 'other') {
    return (
      <div className="fin-root">
        <Link to={withYm('/finance/expense', ym)} className="back"><FinIcon name="chevronLeft" size={15} /> Расход</Link>
        <div className="page-head">
          <div><h1 className="flex" style={{ color: OTHER_GROUP.color }}><FinIcon name={OTHER_GROUP.icon} size={22} /> <span style={{ color: 'var(--text)' }}>Прочие расходы</span></h1><p>Реклама, транспорт, налоги и другие категории</p></div>
          <MonthNav ym={ym} onChange={setYm} />
        </div>
        <OtherExpenseList ym={ym} />
      </div>
    );
  }

  if (kind === 'installments') {
    return (
      <div className="fin-root">
        <Link to={withYm('/finance/expense', ym)} className="back"><FinIcon name="chevronLeft" size={15} /> Расход</Link>
        <InstallmentsList />
      </div>
    );
  }

  const g = EXPENSE_GROUPS.find((x) => x.key === kind);
  if (!g || !kind) return <div className="fin-root"><div className="empty">Статья не найдена</div></div>;

  return (
    <div className="fin-root">
      <Link to={withYm('/finance/expense', ym)} className="back"><FinIcon name="chevronLeft" size={15} /> Расход</Link>
      <div className="page-head">
        <div><h1 className="flex" style={{ color: g.color }}><FinIcon name={g.icon} size={22} /> <span style={{ color: 'var(--text)' }}>{g.label}</span></h1><p>Детализация и быстрая оплата</p></div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>
      {kind === 'salary' && <SalaryList ym={ym} onYmChange={setYm} />}
      {kind === 'rent_subs' && <SubsList ym={ym} />}
      {kind === 'debts' && <DebtsList ym={ym} />}
    </div>
  );
}

// ─── Общие хуки ──────────────────────────────────────────

function useFinAccounts(): any[] {
  const { data } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  return (data ?? []).filter((a: any) => !a.archived);
}

function useFinCategories(): any[] {
  const { data } = useQuery({ queryKey: ['finref', 'categories'], queryFn: () => financeApi.categories() });
  return data ?? [];
}

// ─── 4.5 Прочее ──────────────────────────────────────────

function OtherExpenseList({ ym }: { ym: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'other', ym],
    queryFn: () => financeApi.expenseDetail('other', ym),
  });
  if (isLoading) return <FinLoading />;
  if (isError) return <FinLoadError onRetry={refetch} />;

  const rows: any[] = data?.rows ?? [];
  const total: number = data?.total ?? 0;

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Прочие расходы за месяц</div><div className="value neg">{money(total)}</div></div>
      </div>
      {rows.length === 0 ? (
        <div className="card empty"><div className="big"><FinIcon name="wallet" size={30} /></div>Нет прочих расходов за месяц</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Категория</th><th className="num">Сумма</th><th style={{ width: 200 }}>Доля</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.categoryId ?? 'none'}>
                  <td><span className="flex"><CatIcon icon={r.icon} color={r.color} size={24} /><b>{r.name ?? 'Без категории'}</b></span></td>
                  <td className="num">{money(r.total)}</td>
                  <td><div className="progress"><i style={{ width: (r.share ?? 0) + '%', background: r.color ?? '#94a3b8' }} /></div><span className="mini muted">{r.share ?? 0}%</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><b>Итого</b></td><td className="num"><b>{money(total)}</b></td><td /></tr></tfoot>
          </table>
        </div>
      )}
      <p className="mini muted fin-table-note">
        Сюда попадают расходы с категориями вне ЗП / Аренда+Подписки / Долги. Заводи такие операции на странице «Транзакции».
      </p>
    </>
  );
}

// ─── 4.2 Зарплата ────────────────────────────────────────

function SalaryList({ ym, onYmChange }: { ym: string; onYmChange?: (ym: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'salary', ym],
    queryFn: () => financeApi.expenseDetail('salary', ym),
  });
  const { data: fullEmployees } = useQuery({ queryKey: ['finref', 'employees'], queryFn: () => financeApi.employees() });
  const accounts = useFinAccounts();
  const [payFor, setPayFor] = useState<any | null>(null);
  const [payoutFor, setPayoutFor] = useState<{ row: any; kind: 'advance' | 'bonus'; amount?: number } | null>(null);
  const [empFor, setEmpFor] = useState<any | 'new' | null>(null);
  const [showFired, setShowFired] = useState(false);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const navigate = useNavigate();
  const historyYm = useRef(ym);
  const historyFocusTarget = useRef<string | null>(null);

  const cards = data?.cards ?? { fund: 0, advances: 0, bonuses: 0, fines: 0, paid: 0, toPay: 0 };
  const rows: any[] = data?.rows ?? [];
  // В историческом месяце уже уволенный сотрудник остаётся в основной
  // ведомости. Не дублируем его второй раз в раскрываемом списке уволенных.
  const visibleIds = new Set(rows.map(employee => employee.id));
  const fired: any[] = (data?.fired ?? []).filter((employee: any) => !visibleIds.has(employee.id));

  useEffect(() => {
    if (historyYm.current === ym) return;
    historyYm.current = ym;
    setExpandedEmployeeId(null);
  }, [ym]);
  useEffect(() => {
    if (expandedEmployeeId !== null || !historyFocusTarget.current) return;
    document.getElementById(`employee-history-row-${historyFocusTarget.current}`)?.focus();
    historyFocusTarget.current = null;
  }, [expandedEmployeeId]);

  // Группировка по категориям: именованные по алфавиту, «Без категории» последней.
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const e of rows) {
      const key = (e.category ?? '').trim() || 'Без категории';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    const salarySum = (list: any[]) => list.reduce((s, e) => s + (Number(e.salary) || 0), 0);
    // Отделы — по суммарной ЗП по убыванию; «Без категории» всегда в конце.
    return [...map.entries()].sort((a, b) => {
      const aUn = a[0] === 'Без категории' ? 1 : 0;
      const bUn = b[0] === 'Без категории' ? 1 : 0;
      if (aUn !== bUn) return aUn - bUn;
      return salarySum(b[1]) - salarySum(a[1]);
    });
  }, [rows]);
  const knownCategories = useMemo(
    () => [...new Set(rows.map((e) => (e.category ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [rows],
  );

  if (isLoading) return <FinLoading cards={4} />;
  if (isError) return <FinLoadError onRetry={refetch} />;
  const period = data?.period ?? { ym, status: 'open', latestOpenYm: ym };
  const periodClosed = period.status === 'closed';

  const openEmp = (row: any) => {
    const full = (fullEmployees ?? []).find((x: any) => x.id === row.id);
    setEmpFor(full ?? row);
  };
  const toggleEmployeeHistory = (id: string) => {
    setExpandedEmployeeId(current => current === id ? null : id);
  };
  const closeEmployeeHistory = (id: string) => {
    historyFocusTarget.current = id;
    setExpandedEmployeeId(null);
  };
  const toggleEmployeeHistoryFromRow = (
    event: ReactMouseEvent<HTMLTableRowElement>,
    id: string,
  ) => {
    if (isSalaryRowControl(event.target)) return;
    toggleEmployeeHistory(id);
  };
  const toggleEmployeeHistoryFromKeyboard = (
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    id: string,
  ) => {
    // Enter/Space внутри кнопки или поля принадлежат самому контролу.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleEmployeeHistory(id);
  };

  async function cancelSalaryMonth(e: any) {
    if (!(await finConfirm('Отменить выплату? Зарплатные операции сотрудника за месяц будут удалены.', { danger: true, confirmLabel: 'Отменить выплату' }))) return;
    try {
      const res: any = await financeApi.removeMonthExpenses({ ym, employeeId: e.id });
      invalidateFinance(qc);
      // Молчать тут нельзя: если операций не было, на экране ничего не
      // изменится, и кнопка выглядит сломанной.
      if (!res?.removed) toast('Зарплатных операций за этот месяц нет — отменять нечего');
      else toast.success(`Отменено операций: ${res.removed}`);
    } catch (err) { toast.error(apiErr(err)); }
  }

  function exportCsv() {
    const header = ['Сотрудник', 'Группа', 'Должность', 'Оклад', 'Бонус', 'Аванс', 'Штраф', 'Рассрочка', 'Отпускные', 'Выплачено', 'К выплате'];
    const body = rows.map((e) => [e.name, e.category, e.role, e.salary, e.bonus, e.advance, e.fine ?? 0, e.installment ?? 0, e.vacation ?? 0, e.paid, e.toPay]);
    downloadCsv(`salary-${ym}.csv`, [header, ...body]);
  }

  return (
    <>
      <div className="cards grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Фонд ЗП / мес</div><div className="value">{money(cards.fund)}</div>
          {(cards.bonuses ?? 0) > 0 && <div className="sub">+ бонусы {money(cards.bonuses)}</div>}
          {(cards.fines ?? 0) > 0 && <div className="sub">− штрафы {money(cards.fines)}</div>}
          {(cards.installments ?? 0) > 0 && <div className="sub">− рассрочки {money(cards.installments)}</div>}
        </div>
        <div className="card stat"><div className="label">Авансы (выдано)</div><div className="value">{money(cards.advances)}</div></div>
        <div className="card stat"><div className="label">Выплачено за месяц</div><div className="value pos">{money(cards.paid)}</div></div>
        <div className="card stat"><div className="label">К выплате за месяц</div><div className="value neg">{money(cards.toPay)}</div></div>
      </div>

      <div className="toolbar">
        <span className="chip"><FinIcon name="receipt" size={14} /> Выплата ЗП — каждое 10-е число месяца</span>
        <span className={`badge ${periodClosed ? 'ok' : 'warn'}`}>
          {periodClosed ? 'период закрыт' : 'период открыт'}
        </span>
        <div className="grow" />
        {periodClosed ? (
          <button className="btn sm" onClick={async () => {
            if (!(await finConfirm('Переоткрыть месяц? Заморозка снимется, можно будет править авансы/бонусы/штрафы. Выплаты НЕ удаляются, деньги со счетов НЕ трогаются.', { confirmLabel: 'Переоткрыть' }))) return;
            try {
              await financeApi.reopenSalaryMonth(ym);
              invalidateFinance(qc);
              toast.success('Месяц переоткрыт — можно вносить правки');
            } catch (err) { toast.error(apiErr(err)); }
          }}><FinIcon name="undo" size={14} /> Переоткрыть месяц</button>
        ) : (
          <button className="btn sm" disabled={!data?.allPaid} title={data?.allPaid ? 'Зафиксировать выплаченный период' : 'Сначала проведите все выплаты'} onClick={async () => {
            if (!(await finConfirm('Закрыть зарплатный период? После закрытия операции, авансы, бонусы и штрафы этого месяца нельзя будет менять до переоткрытия.', { confirmLabel: 'Закрыть период' }))) return;
            try {
              const result = await financeApi.closeSalaryMonth(ym);
              invalidateFinance(qc);
              toast.success('Зарплатный период закрыт');
              if (onYmChange && result?.latestOpenYm) onYmChange(result.latestOpenYm);
            } catch (err) { toast.error(apiErr(err)); }
          }}><FinIcon name="check" size={14} /> Закрыть период</button>
        )}
        <button className="btn sm" onClick={exportCsv}>Экспорт CSV</button>
        <button className="btn primary" onClick={() => setEmpFor('new')}><FinIcon name="plus" size={16} /> Сотрудник</button>
      </div>

      {groups.map(([cat, listRaw]) => {
        // Сортируем сотрудников по ЗП — с самой высокой сверху.
        const list = [...listRaw].sort((a, b) => (Number(b.salary) || 0) - (Number(a.salary) || 0));
        const sum = (f: (e: any) => number) => list.reduce((s, e) => s + (f(e) || 0), 0);
        const isPaidRow = (e: any) => {
          const g = Math.round(((Number(e.salary) || 0) + (Number(e.bonus) || 0)) * 100) / 100;
          // Ноль «к выплате» бывает по двум причинам: человеку заплатили либо
          // весь оклад съели удержания. Вторую считать выплатой нельзя — денег
          // не было, и отменять потом нечего.
          return e.frozen || (g > 0 && Number(e.toPay) <= 0.005 && Number(e.paid) > 0);
        };
        const paidCount = list.filter(isPaidRow).length;
        return (
          <div key={cat}>
            {!(groups.length === 1 && cat === 'Без категории') && (
              <div className="section-title" style={{ margin: '18px 0 10px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span>{cat} · {list.length} чел.</span>
                <span className="mini muted nowrap" style={{ marginLeft: 'auto' }}>{paidCount} / {list.length} выплачено</span>
              </div>
            )}
            {/* На телефоне ведомость превращается в карточки: десять колонок
                в 390 px не помещаются. Итог по категории и история месяца
                остаются видимыми — их правила ниже в finance.css. */}
            <div className="table-wrap fin-wide-table fin-mobile-cards fin-salary-table">
              <table style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '18%' }} />{/* ФИО */}
                  <col style={{ width: '12%' }} />{/* Должность */}
                  <col style={{ width: '8%' }} />{/* ЗП */}
                  <col style={{ width: '8%' }} />{/* Аванс */}
                  <col style={{ width: '7%' }} />{/* Бонус */}
                  <col style={{ width: '7%' }} />{/* Штраф */}
                  <col style={{ width: '8%' }} />{/* Рассрочка */}
                  <col style={{ width: '8%' }} />{/* Отпускные */}
                  <col style={{ width: '9%' }} />{/* К выплате */}
                  <col style={{ width: '12%' }} />{/* Статус */}
                  <col style={{ width: '3%' }} />{/* ред. */}
                </colgroup>
                <thead>
                  <tr>
                    <th>ФИО</th><th>Должность</th>
                    <th className="num">ЗП</th><th className="num">Аванс</th>
                    <th className="num">Бонус</th>
                    <th className="num">Штраф</th>
                    <th className="num">Рассрочка</th>
                    <th className="num">Отпускные</th>
                    <th className="num">К выплате</th>
                    <th>Статус</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => {
                    // Выплаченный месяц заморожен снапшотом (frozen с бэка) —
                    // суммы зафиксированы, правки недоступны. Для «живого»
                    // месяца — остаток «оклад + бонус − аванс − штраф».
                    const gross = Math.round(((Number(e.salary) || 0) + (Number(e.bonus) || 0)) * 100) / 100;
                    // «Выплачено» — ТОЛЬКО когда закрыта вся зарплата месяца.
                    // Берём toPay с бэка (оклад + бонус − штраф − выплачено;
                    // аванс уже входит в «выплачено»). Раньше аванс считался
                    // дважды (в paid и вычетом из остатка) — одна выдача
                    // аванса ошибочно помечала сотрудника «выплачено».
                    const isPaid = e.frozen || (gross > 0 && Number(e.toPay) <= 0.005 && Number(e.paid) > 0);
                    // Оклад полностью закрыт удержаниями: платить нечего, но и
                    // «выплачено» писать неправда — раньше строка выглядела
                    // выплаченной, а кнопка отмены молча ничего не делала.
                    const nothingToPay = !isPaid && gross > 0 && Number(e.toPay) <= 0.005;
                    const historyOpen = expandedEmployeeId === e.id;
                    // Отпуск в месяце: «за свой счёт» ждёт решения — «проверить».
                    const vacHints: any[] = isPaid ? [] : (e.vacationHints || []);
                    const vacPending = vacHints.some((h) => h.state === 'pending');
                    return (
                      <Fragment key={e.id}>
                      <tr
                        id={`employee-history-row-${e.id}`}
                        className={historyOpen ? 'fin-salary-employee-row expanded' : 'fin-salary-employee-row'}
                        tabIndex={0}
                        aria-label={`${historyOpen ? 'Свернуть' : 'Открыть'} историю зарплаты — ${e.name}`}
                        aria-expanded={historyOpen}
                        aria-controls={historyOpen ? `employee-history-${e.id}` : undefined}
                        onClick={(event) => toggleEmployeeHistoryFromRow(event, e.id)}
                        onKeyDown={(event) => toggleEmployeeHistoryFromKeyboard(event, e.id)}
                      >
                        <td data-label="" className="fin-name-cell">
                          <b className="fin-employee-name" title={e.name}>{shortName(e.name)}</b>
                          {vacHints.length > 0 && <span className="fin-vac-chip">{vacationChip(vacHints[vacHints.length - 1])}</span>}
                        </td>
                        <td data-label="Должность" className="muted fin-role-cell">{e.role ?? '—'}</td>
                        <td data-label="ЗП" className="num">{money(e.salary)}</td>
                        <td data-label="Аванс" className="num">{Number(e.advance) ? money(e.advance) : <span className="muted">—</span>}</td>
                        <td data-label="Бонус" className="num">{Number(e.bonus) ? money(e.bonus) : <span className="muted">—</span>}</td>
                        <td data-label="Штраф" className="num">{Number(e.fine) ? <span style={{ color: 'var(--red)' }}>{money(e.fine)}</span> : <span className="muted">—</span>}</td>
                        <td data-label="Рассрочка" className="num">{Number(e.installment) ? <span style={{ color: INSTALLMENT_COLOR }} title={(e.installmentParts || []).filter((p: any) => p.amount > 0).map((p: any) => p.name).join(', ')}>{money(e.installment)}</span> : <span className="muted">—</span>}</td>
                        <td data-label="Отпускные" className="num">
                          {Number(e.vacation) ? <span style={{ color: 'var(--red)' }}>{money(e.vacation)}</span> : !vacPending && <span className="muted">—</span>}
                          {vacPending && <span className="fin-vac-check" title="Отпуск за свой счёт — решите, удерживать ли"><i />проверить</span>}
                        </td>
                        <td data-label="К выплате" className="num">{isPaid ? <span className="muted">—</span> : <b style={{ color: 'var(--accent)' }}>{money(e.toPay)}</b>}</td>
                        <td data-label="" className="fin-pay-cell">
                          {isPaid
                            ? <span className="flex"><span className="badge ok" title={e.paidAt ? `Выплачено ${formatDate(e.paidAt)} — месяц зафиксирован` : 'Месяц закрыт'}><FinIcon name="check" size={13} /> выплачено</span><button className="btn ghost sm" title="Отменить выплату" onClick={() => cancelSalaryMonth(e)}><FinIcon name="undo" size={15} /></button></span>
                            : nothingToPay
                              ? <span className="badge" title={`Оклад ${money(e.salary)} полностью закрыт удержаниями — выплачивать нечего`}>к выплате 0</span>
                              : <button className="btn primary sm" onClick={() => setPayFor(e)}>Выплатить</button>}
                        </td>
                        <td data-label="" className="num fin-edit-cell"><button className="btn ghost sm" title="Редактировать" onClick={() => openEmp(e)}><FinIcon name="edit" size={15} /></button></td>
                      </tr>
                      {historyOpen && (
                        <tr className="fin-employee-history-row">
                          <td colSpan={11}>
                            <div className="fin-emp-month">
                              <div className="fin-emp-month-head">
                                <span style={{ textTransform: 'capitalize' }}>{monthLabel(ym, true)}</span>
                                {!isPaid && <span>К выплате <b>{money(e.toPay)}</b></span>}
                                <div className="grow" />
                                <button className="btn sm" onClick={(ev) => { ev.stopPropagation(); navigate(`/finance/salary/${e.id}`, { state: { name: e.name } }); }}>
                                  Детальная информация <FinIcon name="arrowRight" size={15} />
                                </button>
                              </div>
                              {isPaid ? (
                                <>
                                  <p className="mini muted" style={{ margin: '0 0 12px' }}>Месяц выплачен и зафиксирован — правки недоступны, история только для просмотра.</p>
                                  <div className="fin-emp-month-form">
                                    <ReadonlyField label="Аванс" kind="advance" total={Number(e.advance) || 0} entries={e.advanceEntries || []} accounts={accounts} />
                                    <ReadonlyField label="Бонус" total={Number(e.bonus) || 0} entries={e.bonusEntries || []} />
                                    <ReadonlyField label="Штраф" total={Number(e.fine) || 0} entries={e.fineEntries || []} deduction />
                                    <ReadonlyField label="Отпускные / нерабочие" total={Number(e.vacation) || 0} entries={e.vacationEntries || []} deduction />
                                    <InstallmentSalaryField row={e} ym={ym} frozen />
                                  </div>
                                </>
                              ) : (
                                <div className="fin-emp-month-form">
                                  <IssueField label="Аванс" kind="advance" row={e} ym={ym} total={Number(e.advance) || 0} entries={e.advanceEntries || []} accounts={accounts} onIssue={(amt) => setPayoutFor({ row: e, kind: 'advance', amount: amt })} />
                                  <DeductionField row={e} ym={ym} field="bonus" label="Бонус" total={Number(e.bonus) || 0} entries={e.bonusEntries || []} />
                                  <DeductionField row={e} ym={ym} field="fine" label="Штраф" total={Number(e.fine) || 0} entries={e.fineEntries || []} />
                                  <VacationField row={e} ym={ym} total={Number(e.vacation) || 0} entries={e.vacationEntries || []} hints={vacHints} />
                                  <InstallmentSalaryField row={e} ym={ym} frozen={false} />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><b>Итого · {cat}</b></td>
                    <td className="num"><b>{money(sum(e => Number(e.salary)))}</b></td>
                    <td className="num" /><td className="num" /><td className="num" /><td className="num" /><td className="num" />
                    <td className="num"><b style={{ color: 'var(--accent)' }}>{money(sum(e => Number(e.toPay)))}</b></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="card empty">Нет активных сотрудников</div>}

      {/* Общий итог по всем категориям. */}
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: '8px 22px', alignItems: 'center' }}>
          <b>Итого по всем сотрудникам ({rows.length})</b>
          <span className="mini muted nowrap">Фонд ЗП <b style={{ color: 'var(--text)' }}>{money(cards.fund)}</b></span>
          <span className="mini muted nowrap">Авансы <b style={{ color: 'var(--text)' }}>{money(cards.advances)}</b></span>
          <span className="mini muted nowrap">Бонусы <b style={{ color: 'var(--text)' }}>{money(cards.bonuses ?? 0)}</b></span>
          <span className="mini muted nowrap">Штрафы <b style={{ color: 'var(--text)' }}>{money(cards.fines ?? 0)}</b></span>
          {(cards.installments ?? 0) > 0 && <span className="mini muted nowrap">Рассрочки <b style={{ color: 'var(--text)' }}>{money(cards.installments)}</b></span>}
          <span className="mini muted nowrap">Выплачено <b className="pos">{money(cards.paid)}</b></span>
          <span className="mini muted nowrap">К выплате <b className="neg">{money(cards.toPay)}</b></span>
        </div>
      )}

      {fired.length > 0 && (
        <section className="fin-secondary-table-section" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn ghost sm fin-secondary-table-toggle"
            onClick={() => setShowFired((v) => !v)}
            aria-expanded={showFired}
            aria-controls="fired-employees-table"
          >
            <FinIcon name={showFired ? 'chevronLeft' : 'chevronRight'} size={14} /> Уволенные сотрудники ({fired.length})
          </button>
          {showFired && (
            <div id="fired-employees-table" className="table-wrap">
              <table>
                <thead><tr><th>ФИО</th><th>Должность</th><th>Дата приёма</th><th className="num">ЗП</th><th /></tr></thead>
                <tbody>
                  {fired.map((e) => {
                    const historyOpen = expandedEmployeeId === e.id;
                    return <Fragment key={e.id}>
                    <tr
                      id={`employee-history-row-${e.id}`}
                      className={historyOpen ? 'fin-salary-employee-row expanded' : 'fin-salary-employee-row'}
                      style={{ opacity: historyOpen ? 1 : 0.7 }}
                      tabIndex={0}
                      aria-label={`${historyOpen ? 'Свернуть' : 'Открыть'} историю зарплаты — ${e.name}`}
                      aria-expanded={historyOpen}
                      aria-controls={historyOpen ? `employee-history-${e.id}` : undefined}
                      onClick={(event) => toggleEmployeeHistoryFromRow(event, e.id)}
                      onKeyDown={(event) => toggleEmployeeHistoryFromKeyboard(event, e.id)}
                    >
                      <td>
                        <b className="fin-employee-name" title={e.name}>{shortName(e.name)}</b>
                      </td>
                      <td className="muted">{e.role ?? '—'}</td>
                      <td className="muted nowrap">{e.hireDate ? formatDate(e.hireDate) : '—'}</td>
                      <td className="num muted">{money(e.salary)}</td>
                      <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => openEmp(e)}><FinIcon name="edit" size={15} /></button></td>
                    </tr>
                    {historyOpen && (
                      <tr className="fin-employee-history-row">
                        <td colSpan={5}>
                          <EmployeeSalaryHistory employeeId={e.id} name={e.name}
                            onClose={() => closeEmployeeHistory(e.id)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {payFor && <SalaryPayModal row={payFor} ym={ym} onClose={() => setPayFor(null)} />}
      {payoutFor && <PayoutModal row={payoutFor.row} kind={payoutFor.kind} ym={ym} defaultAmount={payoutFor.amount} onClose={() => setPayoutFor(null)} />}
      {empFor && <EmployeeFormModal employee={empFor === 'new' ? undefined : empFor} categories={knownCategories} onClose={() => setEmpFor(null)} />}
    </>
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Короткая дата записи: «2 сен». */
function shortDay(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace(/\.$/, '');
}

/** Комментарий операции без маркера типа («Аванс — X» → «X»). */
function stripMarker(c?: string | null): string {
  return c ? c.replace(/^(Аванс|Бонус|Зарплата)\s*(—\s*)?/, '').trim() : '';
}

/** Метка даты записи: период «1 – 7 сен» для отпускных, иначе одна дата. */
function entryDateLabel(e: any): string {
  if (e.dateFrom && e.dateTo) {
    return e.dateFrom === e.dateTo ? shortDay(e.dateFrom) : `${shortDay(e.dateFrom)} – ${shortDay(e.dateTo)}`;
  }
  return shortDay(e.date);
}

/** Полный период записи для деталей: «1 сентября – 7 сентября 2026». */
function fullRange(e: any): string {
  if (e.dateFrom && e.dateTo) {
    return e.dateFrom === e.dateTo ? formatDate(e.dateFrom) : `${formatDate(e.dateFrom)} – ${formatDate(e.dateTo)}`;
  }
  return formatDate(e.date);
}

/** Точечный оптимистичный патч зарплатного кэша: меняем одну строку через
 *  mutate(), пересчитываем её «к выплате» и все сводные карточки. */
function patchSalaryRow(qc: any, ym: string, rowId: string, mutate: (r: any) => any) {
  const key = ['finance', 'expenseDetail', 'salary', ym];
  // Отменяем незавершённый рефетч, чтобы он не пришёл ПОСЛЕ и не перетёр
  // оптимистичную правку (гонка при быстрых последовательных изменениях).
  void qc.cancelQueries({ queryKey: key });
  qc.setQueryData(key, (old: any) => {
    if (!old?.rows) return old;
    const rows = old.rows.map((r: any) => {
      if (r.id !== rowId) return r;
      const nr = mutate({ ...r });
      if (!nr.frozen) {
        // Рассрочку держим как пришла с сервера: она зависит от остатка,
        // а точную сумму после правки вернёт перезапрос.
        const owed = Math.max(0, (Number(nr.salary) || 0) + (Number(nr.bonus) || 0) - (Number(nr.fine) || 0) - (Number(nr.vacation) || 0));
        const inst = Math.min(Number(nr.installment) || 0, owed);
        nr.toPay = r2(Math.max(0, owed - inst - (Number(nr.paid) || 0)));
      }
      return nr;
    });
    const sum = (f: (r: any) => number) => r2(rows.reduce((s: number, r: any) => s + (Number(f(r)) || 0), 0));
    const cards = { ...(old.cards || {}),
      fund: sum((r) => r.salary), advances: sum((r) => r.advance), bonuses: sum((r) => r.bonus),
      fines: sum((r) => r.fine), vacations: sum((r) => r.vacation), installments: sum((r) => r.installment),
      paid: sum((r) => r.paid), toPay: sum((r) => r.toPay),
    };
    return { ...old, rows, cards };
  });
}

/** Одна запись истории столбца: строка «дата · сумма · ✕» + раскрываемые
 *  по клику детали (счёт/комментарий). readOnly — без ✕ (замороженный месяц). */
function HistoryEntry({ entry, deduction, cancelTitle, onCancel, readOnly, children }: {
  entry: any; deduction?: boolean; cancelTitle?: string; onCancel?: () => void; readOnly?: boolean; children?: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'fin-log-entry open' : 'fin-log-entry'}>
      <div className="fin-log-item" onClick={() => setOpen((o) => !o)}>
        <FinIcon name="chevronRight" size={13} className="chev" />
        <span className="d">{entryDateLabel(entry)}</span>
        <span className={deduction ? 'a red' : 'a'}>{money(entry.amount)}</span>
        {!readOnly && <button type="button" className="x" title={cancelTitle}
          onClick={(ev) => { ev.stopPropagation(); onCancel?.(); }}><FinIcon name="close" size={13} /></button>}
      </div>
      {open && <div className="fin-log-detail">{children}</div>}
    </div>
  );
}

/** Поле-история столбца ТОЛЬКО ДЛЯ ЧТЕНИЯ (выплаченный/замороженный месяц):
 *  метка + итог + список записей без ✕ и без ввода. kind='advance' → детали
 *  со счётом/комментарием, иначе — период (отпускные) и комментарий. */
function ReadonlyField({ label, total, entries, deduction, kind, accounts }: {
  label: string; total: number; entries: any[]; deduction?: boolean; kind?: 'advance'; accounts?: any[];
}) {
  if (!(total > 0) && !(entries && entries.length)) return null;
  const accName = (id: string) => (accounts || []).find((a) => a.id === id)?.name || 'счёт';
  return (
    <div className="fld">
      <div className="cap"><span className="lbl">{label}</span>{total > 0 && <span className={deduction ? 'tot red' : 'tot'}>{money(total)}</span>}</div>
      {entries && entries.length > 0 ? (
        <div className="fin-log">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} deduction={deduction} readOnly>
              {kind === 'advance' ? (
                <>
                  <div className="dline"><span className="val">{accName(entry.accountId)}</span></div>
                  {stripMarker(entry.comment) && <div className="dline"><span className="val">{stripMarker(entry.comment)}</span></div>}
                </>
              ) : (
                <>
                  {(entry.dateFrom || entry.dateTo) && <div className="dline"><span className="val">{fullRange(entry)}</span></div>}
                  {entry.note && <div className="dline"><span className="val">{entry.note}</span></div>}
                </>
              )}
            </HistoryEntry>
          ))}
        </div>
      ) : (
        <div className="mini muted" style={{ padding: '4px 2px' }}>—</div>
      )}
    </div>
  );
}

/** Поле комментария к записи удержания — сохраняется на blur/Enter. */
function NoteInput({ entry, onSave }: { entry: any; onSave: (entry: any, note: string) => void }) {
  const [v, setV] = useState(entry.note || '');
  return (
    <input className="cin" placeholder="комментарий — за что" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(entry, v.trim())}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
  );
}

/** Поле «выдать» аванс/бонус: сумма → «→» открывает окно выдачи (счёт/дата).
 *  Ниже — журнал операций месяца: дата · сумма · ✕ (отмена = возврат на счёт);
 *  клик по записи раскрывает счёт и комментарий. */
function IssueField({ label, kind, row, ym, total, entries, accounts, onIssue }: {
  label: string; kind: 'advance' | 'bonus'; row: any; ym: string; total: number;
  entries: any[]; accounts: any[]; onIssue: (amount: number) => void;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState('');
  const go = () => { const n = Math.max(0, parseFloat(v.replace(',', '.')) || 0); if (n > 0) { onIssue(n); setV(''); } };
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name || 'счёт';
  const listKey = kind === 'advance' ? 'advanceEntries' : 'bonusEntries';

  const cancel = async (entry: any) => {
    patchSalaryRow(qc, ym, row.id, (r) => {
      r[listKey] = (r[listKey] || []).filter((x: any) => x.id !== entry.id);
      r[kind] = r2((r[listKey] || []).reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));
      r.paid = r2((Number(r.paid) || 0) - (Number(entry.amount) || 0));
      return r;
    });
    try { await financeApi.removeTransaction(entry.id); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  return (
    <div className="fld">
      <div className="cap"><span className="lbl">{label}</span>{total > 0 && <span className="tot">{money(total)}</span>}</div>
      <div className="in">
        <input inputMode="decimal" placeholder="—" value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }} />
        <button type="button" className="issue" title="Выдать — откроется выбор счёта" onClick={go}><FinIcon name="arrowRight" size={15} /></button>
      </div>
      {entries.length > 0 && (
        <div className="fin-log">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} cancelTitle="Отменить операцию — вернуть деньги на счёт" onCancel={() => cancel(entry)}>
              <div className="dline"><span className="val">{accName(entry.accountId)}</span></div>
              {stripMarker(entry.comment) && <div className="dline"><span className="val">{stripMarker(entry.comment)}</span></div>}
            </HistoryEntry>
          ))}
        </div>
      )}
    </div>
  );
}

/** Поле-журнал суммы (штраф/отпускные — удержания в минус; бонус — накопительный
 *  в плюс): сумма → «→»/Enter добавляет запись с сегодняшней датой (счёт не
 *  трогает, бонус выдаётся вместе с зарплатой). Ниже — журнал: дата · сумма · ✕;
 *  клик раскрывает комментарий. «К выплате» пересчитывается мгновенно. */
function DeductionField({ row, ym, field, label, total, entries }: {
  row: any; ym: string; field: 'fine' | 'vacation' | 'bonus'; label: string; total: number; entries: any[];
}) {
  const qc = useQueryClient();
  const [v, setV] = useState('');
  const isBonus = field === 'bonus';
  const listKey = field === 'fine' ? 'fineEntries' : field === 'vacation' ? 'vacationEntries' : 'bonusEntries';

  const add = async () => {
    const n = Math.max(0, parseFloat(v.replace(',', '.')) || 0);
    if (!(n > 0)) return;
    setV('');
    const entry = { id: `tmp-${Date.now()}`, date: todayISO(), amount: n, note: null };
    patchSalaryRow(qc, ym, row.id, (r) => {
      r[listKey] = [...(r[listKey] || []), entry];
      r[field] = r2(r[listKey].reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));
      return r;
    });
    try { await financeApi.addEmployeeDeduction(row.id, { kind: field, ym, amount: n }); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  const remove = async (entry: any) => {
    patchSalaryRow(qc, ym, row.id, (r) => {
      r[listKey] = (r[listKey] || []).filter((x: any) => x.id !== entry.id);
      r[field] = r2((r[listKey] || []).reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));
      return r;
    });
    try { await financeApi.removeEmployeeDeduction(row.id, entry.id, { kind: field, ym }); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  const saveNote = async (entry: any, note: string) => {
    if ((entry.note || '') === note) return;
    patchSalaryRow(qc, ym, row.id, (r) => {
      r[listKey] = (r[listKey] || []).map((x: any) => x.id === entry.id ? { ...x, note } : x);
      return r;
    });
    try { await financeApi.updateEmployeeDeduction(row.id, entry.id, { kind: field, ym, note }); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  return (
    <div className="fld">
      <div className="cap"><span className="lbl">{label}</span>{total > 0 && <span className={isBonus ? 'tot' : 'tot red'}>{money(total)}</span>}</div>
      <div className="in">
        <input inputMode="decimal" placeholder="—" value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="issue" title={isBonus ? 'Добавить бонус' : 'Добавить удержание'} onClick={add}><FinIcon name="arrowRight" size={15} /></button>
      </div>
      {entries.length > 0 && (
        <div className="fin-log">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} deduction={!isBonus} cancelTitle="Удалить запись" onCancel={() => remove(entry)}>
              <div className="dline"><NoteInput entry={entry} onSave={saveNote} /></div>
            </HistoryEntry>
          ))}
        </div>
      )}
    </div>
  );
}

/** Поле «Отпускные / нерабочие»: каждая запись — период «от–до» с суммой
 *  удержания (кнопка открывает окно с датами и суммой). Ниже — журнал
 *  периодов: «1 – 7 сен · 1000 с.» · ✕; клик раскрывает даты и комментарий. */
function VacationField({ row, ym, total, entries, hints = [] }: { row: any; ym: string; total: number; entries: any[]; hints?: any[] }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const shown = hints.filter((h) => h.state === 'pending' || h.state === 'paid');

  const remove = async (entry: any) => {
    patchSalaryRow(qc, ym, row.id, (r) => {
      r.vacationEntries = (r.vacationEntries || []).filter((x: any) => x.id !== entry.id);
      r.vacation = r2((r.vacationEntries || []).reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));
      return r;
    });
    try { await financeApi.removeEmployeeDeduction(row.id, entry.id, { kind: 'vacation', ym }); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  const saveNote = async (entry: any, note: string) => {
    if ((entry.note || '') === note) return;
    patchSalaryRow(qc, ym, row.id, (r) => {
      r.vacationEntries = (r.vacationEntries || []).map((x: any) => x.id === entry.id ? { ...x, note } : x);
      return r;
    });
    try { await financeApi.updateEmployeeDeduction(row.id, entry.id, { kind: 'vacation', ym, note }); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  return (
    <div className={shown.some((h) => h.state === 'pending') ? 'fld wide' : 'fld'}>
      <div className="cap"><span className="lbl">Отпускные / нерабочие</span>{total > 0 && <span className="tot red">{money(total)}</span>}</div>
      {shown.map((h) => <VacationHintCard key={h.vacationId} row={row} ym={ym} hint={h} />)}
      <button type="button" className="fin-vac-add" onClick={() => setModal(true)}><FinIcon name="plus" size={14} /> Добавить период</button>
      {entries.length > 0 && (
        <div className="fin-log">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} deduction cancelTitle="Удалить период" onCancel={() => remove(entry)}>
              {(entry.dateFrom || entry.dateTo) && <div className="dline"><span className="val">{fullRange(entry)}</span></div>}
              <div className="dline"><NoteInput entry={entry} onSave={saveNote} /></div>
            </HistoryEntry>
          ))}
        </div>
      )}
      {modal && <VacationModal row={row} ym={ym} onClose={() => setModal(false)} />}
    </div>
  );
}

const ruDay = (iso: string, month: 'short' | 'long') =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month });

/** «26–31 октября» / «26 окт. – 9 нояб.» */
function vacRange(from: string, until: string, month: 'short' | 'long') {
  if (from === until) return ruDay(from, month);
  if (from.slice(0, 7) === until.slice(0, 7)) return `${Number(from.slice(8, 10))}–${ruDay(until, month)}`;
  return `${ruDay(from, month)} – ${ruDay(until, month)}`;
}

/** Пометка под именем: «в отпуске до 9 нояб.» или «отпуск 3–7 окт.». */
function vacationChip(h: any) {
  const today = todayISO();
  const base = h.from <= today && today <= h.until ? `в отпуске до ${ruDay(h.until, 'short')}` : `отпуск ${vacRange(h.from, h.until, 'short')}`;
  return h.paid ? `${base} · оплачиваемый` : base;
}

function workdaysLabel(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'рабочий день';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'рабочих дня';
  return 'рабочих дней';
}

/** Отпуск в зарплате (вариант Б): за свой счёт — подсказка «Удержать N?»,
 *  решает владелец; оплачиваемый — только виден, зарплата не меняется. */
function VacationHintCard({ row, ym, hint }: { row: any; ym: string; hint: any }) {
  const qc = useQueryClient();
  const [custom, setCustom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const customAmt = custom === null ? NaN : parseFloat(custom.replace(',', '.'));

  const send = async (action: 'withhold' | 'dismiss', amount?: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await financeApi.decideVacationHint(row.id, { vacationId: hint.vacationId, ym, action, ...(amount !== undefined ? { amount } : {}) });
      invalidateFinance(qc);
      toast.success(action === 'withhold' ? `Удержано ${money(amount ?? hint.amount)}` : 'Отпуск не удерживаем');
    } catch (err) { toast.error(apiErr(err)); }
    finally { setBusy(false); }
  };

  if (hint.state === 'paid') {
    return (
      <div className="fin-vac-hint paid">
        <div className="row"><b>Отпуск {vacRange(hint.monthFrom, hint.monthUntil, 'short')}</b><span>{hint.days} {workdaysLabel(hint.days)}</span></div>
        <span className="txt">Оплачиваемый — из зарплаты не вычитаем.</span>
      </div>
    );
  }

  return (
    <div className="fin-vac-hint">
      <span className="lead">В отпуске <b>{vacRange(hint.monthFrom, hint.monthUntil, 'long')}</b> — {hint.days} {workdaysLabel(hint.days)} из {hint.monthWorkdays}, за свой счёт.</span>
      {custom === null ? (
        <>
          <div className="sum"><span>Удержать</span><b>{money(hint.amount)}?</b></div>
          <span className="calc">{money(hint.salary)} ÷ {hint.monthWorkdays} × {hint.days}</span>
        </>
      ) : (
        <div className="in">
          <input autoFocus inputMode="decimal" placeholder="своя сумма" value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && customAmt > 0) { e.preventDefault(); send('withhold', customAmt); } if (e.key === 'Escape') setCustom(null); }} />
        </div>
      )}
      {hint.previousAmount != null && <span className="calc">Даты отпуска поменялись. Раньше удержали {money(hint.previousAmount)} — эту запись заменим.</span>}
      <div className="acts">
        {custom === null ? (
          <>
            <button type="button" className="btn warn" disabled={busy} onClick={() => send('withhold')}>Удержать {money(hint.amount)}</button>
            <button type="button" className="btn" onClick={() => setCustom('')}>Своя сумма</button>
            <button type="button" className="btn" disabled={busy} onClick={() => send('dismiss')}>Не удерживать</button>
          </>
        ) : (
          <>
            <button type="button" className="btn warn" disabled={busy || !(customAmt > 0)} onClick={() => send('withhold', customAmt)}>{customAmt > 0 ? `Удержать ${money(customAmt)}` : 'Удержать'}</button>
            <button type="button" className="btn" onClick={() => setCustom(null)}>Отмена</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Окно добавления периода нерабочих: даты «от–до» + сумма удержания. */
function VacationModal({ row, ym, onClose }: { row: any; ym: string; onClose: () => void }) {
  useModalKeys(onClose);
  const qc = useQueryClient();
  const [from, setFrom] = useState(`${ym}-01`);
  const [to, setTo] = useState(`${ym}-01`);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const amt = parseFloat(amount.replace(',', '.'));
  const valid = amt > 0 && !!from && !!to && from <= to;

  const save = async () => {
    if (!valid) return;
    const entry = { id: `tmp-${Date.now()}`, date: from, dateFrom: from, dateTo: to, amount: amt, note: note.trim() || null };
    patchSalaryRow(qc, ym, row.id, (r) => {
      r.vacationEntries = [...(r.vacationEntries || []), entry];
      r.vacation = r2(r.vacationEntries.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));
      return r;
    });
    onClose();
    try { await financeApi.addEmployeeDeduction(row.id, { kind: 'vacation', ym, amount: amt, dateFrom: from, dateTo: to, note: note.trim() || undefined }); invalidateFinance(qc); }
    catch (err) { toast.error(apiErr(err)); invalidateFinance(qc); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-head"><h3>Период нерабочих · {row.name}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Дата от</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field"><label>Дата до</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="field"><label>Сумма удержания, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="за нерабочие дни" /></div>
          <div className="field"><label>Комментарий</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно — например «отпуск за свой счёт»" /></div>
          {from && to && from > to && <p className="mini neg" style={{ margin: 0 }}>«Дата до» раньше «даты от».</p>}
          <p className="mini muted" style={{ margin: 0 }}>Удержание за нерабочие дни периода — уменьшает «к выплате». Счёт не затрагивается.</p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid} onClick={save}>Добавить</button>
        </div>
      </div>
    </div>
  );
}

/** Выдача аванса/бонуса: создаёт расходную операцию СРАЗУ (деньги выходят
 *  со счёта в момент выдачи). Комментарий «Аванс»/«Бонус» — по нему колонка
 *  и математика узнают тип выплаты. */
function PayoutModal({ row, kind, ym, defaultAmount, onClose }: { row: any; kind: 'advance' | 'bonus'; ym: string; defaultAmount?: number; onClose: () => void }) {
  useModalKeys(onClose);
  const qc = useQueryClient();
  const accounts = useFinAccounts();
  const categories = useFinCategories();
  const [amount, setAmount] = useState(defaultAmount && defaultAmount > 0 ? String(defaultAmount) : '');
  // Дата платежа — реальная (по умолчанию сегодня), месяц начисления — из таблицы.
  const [date, setDate] = useState(todayISO());
  const [salaryYm, setSalaryYm] = useState(ym);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const title = kind === 'advance' ? 'Выдать аванс' : 'Выплатить бонус';
  const comment = kind === 'advance' ? 'Аванс' : 'Бонус';
  const amt = parseFloat(amount.replace(',', '.'));
  async function save() {
    if (!(amt > 0) || !accountId || busy) return;
    setBusy(true);
    const salaryCat = categories.find((c: any) => c.key === 'salary');
    try {
      await financeApi.createOperation({
        type: 'expense', amount: amt, date, accountId, salaryYm: salaryYm || undefined,
        // Заметка дописывается к маркеру типа — см. пояснение в SalaryPayModal.
        categoryId: salaryCat?.id, employeeId: row.id, comment: salaryComment(comment, note),
      });
      invalidateFinance(qc);
      toast.success(`${title}: ${money(amt)} — операция создана`);
      onClose();
    } catch (err) { toast.error(apiErr(err)); } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{title} · {row.name}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата выплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Месяц начисления (за какой месяц)</label><input type="month" value={salaryYm} onChange={(e) => setSalaryYm(e.target.value)} /></div>
            <div className="field"><label>Со счёта</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Комментарий</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="за что / как выдали — например «на лечение»" />
          </div>
          <p className="mini muted" style={{ margin: 0 }}>
            «Дата выплаты» — когда деньги ушли со счёта; «Месяц начисления» — за какой месяц.{' '}
            {kind === 'advance' ? 'Аванс уменьшит остаток финальной выплаты того же месяца.' : 'Бонус — сверх оклада.'}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!(amt > 0) || !accountId || busy} onClick={save}>{title}</button>
        </div>
      </div>
    </div>
  );
}

function SalaryPayModal({ row, ym, onClose }: { row: any; ym: string; onClose: () => void }) {
  useModalKeys(onClose);
  const qc = useQueryClient();
  const accounts = useFinAccounts();
  const categories = useFinCategories();
  const remaining = Math.max(0, row.toPay ?? 0);
  const [amount, setAmount] = useState(String(remaining || row.salary || ''));
  // Дата платежа — реальная (когда деньги ушли со счёта), по умолчанию сегодня.
  const [date, setDate] = useState(todayISO());
  // Месяц начисления — за какой месяц эта зарплата (по умолчанию — таблица).
  const [salaryYm, setSalaryYm] = useState(ym);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  async function save() {
    if (!(amt > 0) || !accountId || busy) return;
    setBusy(true);
    const salaryCat = categories.find((c: any) => c.key === 'salary');
    try {
      await financeApi.createOperation({
        type: 'expense', amount: amt, date, accountId, salaryYm: salaryYm || undefined,
        // Тип операции распознаётся по началу комментария («Зарплата»/«Аванс»/
        // «Бонус»), поэтому заметку ДОПИСЫВАЕМ, а не заменяем ею комментарий —
        // иначе выплата перестала бы считаться зарплатой.
        categoryId: salaryCat?.id, employeeId: row.id, comment: salaryComment('Зарплата', note),
      });
      invalidateFinance(qc);
      onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Выплата ЗП · {row.name}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата выплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Месяц начисления (за какой месяц)</label><input type="month" value={salaryYm} onChange={(e) => setSalaryYm(e.target.value)} /></div>
            <div className="field"><label>Со счёта</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Комментарий</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="за что / как выдали — например «наличными на руки»" />
          </div>
          <p className="mini muted" style={{ margin: 0 }}>
            «Дата выплаты» — когда деньги ушли (влияет на баланс счёта). «Месяц начисления» —
            за какой месяц зарплата (в этот месяц она попадёт в таблицу). Остаток к выплате: {money(remaining)}
            {(Number(row.bonus) || 0) > 0 ? <> (оклад {money(row.salary)} + бонус {money(row.bonus)})</> : null}.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy || !(amt > 0) || !accountId} onClick={save}>Выплатить</button>
        </div>
      </div>
    </div>
  );
}

// ─── 4.3 Аренда и подписки ───────────────────────────────

function SubsList({ ym }: { ym: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'subscriptions', ym],
    queryFn: () => financeApi.expenseDetail('subscriptions', ym),
  });
  const accounts = useFinAccounts();
  const [editFor, setEditFor] = useState<any | 'new' | null>(null);
  const [payFor, setPayFor] = useState<any | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (isLoading) return <FinLoading />;
  if (isError) return <FinLoadError onRetry={refetch} />;

  const rows: any[] = data?.rows ?? [];
  const monthly: number = data?.monthly ?? 0;
  const hidden: number = data?.hiddenCount ?? 0;

  /** Отметить оплаченным без операции: денег по счетам не двигает. */
  async function markPaid(s: any) {
    if (busyId) return;
    setBusyId(s.id);
    try {
      await financeApi.markSubPaid(s.id, { ym, date: todayISO() });
      invalidateFinance(qc);
    } catch (e) { toast.error(apiErr(e)); }
    finally { setBusyId(null); }
  }

  async function cancelMonth(s: any) {
    if (busyId) return;
    if (!(await finConfirm('Отменить оплату? Оплаты позиции за месяц будут удалены.', { danger: true, confirmLabel: 'Отменить оплату' }))) return;
    setBusyId(s.id);
    try {
      await financeApi.removeMonthExpenses({ ym, subscriptionId: s.id });
      if (s.paidMark) await financeApi.unmarkSubPaid(s.id, { ym });
    } catch (e) { toast.error(apiErr(e)); }
    finally { setBusyId(null); invalidateFinance(qc); }
  }

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Аренда + подписки / мес</div><div className="value">{money(monthly)}</div></div>
      </div>
      <div className="toolbar">
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditFor('new')}><FinIcon name="plus" size={16} /> Добавить расход</button>
      </div>

      {/* На телефоне таблица превращается в карточки (fin-mobile-cards, ≤720px):
          шесть колонок в 390 px не помещаются, и строку листали вбок. */}
      <div className="table-wrap fin-wide-table fin-mobile-cards fin-subs-table">
        <table>
          {/* Колонка действий держит до трёх кнопок («оплатить» — с подписью). */}
          <thead><tr><th style={{ minWidth: 170 }}>Позиция</th><th>Тип</th><th className="num" style={{ width: 110 }}>Сумма/мес</th><th style={{ width: 110 }}>День оплаты</th><th style={{ minWidth: 200 }}>Статус месяца</th><th style={{ width: 190 }} /></tr></thead>
          <tbody>
            {rows.map((s) => {
              const paidAmount = Number(s.paidMonth) || 0;
              const remaining = Math.max(0, (Number(s.amount) || 0) - paidAmount);
              const isPaid = !!s.paidMark || remaining <= 0.005;
              const isPartial = !isPaid && paidAmount > 0.005;
              const paidDate = s.lastPaidDate ?? s.paidMark;
              return (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }} onDoubleClick={() => setEditFor(s)}>
                  <td data-label="Позиция"><b>{s.name}</b></td>
                  <td data-label="Тип" className="muted">{s.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
                  <td data-label="Сумма/мес" className="num">{money(s.amount)}</td>
                  <td data-label="День оплаты" className="muted nowrap">{(() => {
                    if (s.dueDate) {
                      const day = Number(String(s.dueDate).slice(8, 10));
                      const [yy, mm] = ym.split('-').map(Number);
                      const last = new Date(yy, mm, 0).getDate();
                      return formatDate(`${ym}-${String(Math.min(day, last)).padStart(2, '0')}`);
                    }
                    return s.dueDay ? `до ${s.dueDay}-го` : '—';
                  })()}</td>
                  <td data-label="Статус месяца">
                    {isPaid ? (
                      <span className="flex">
                        <span className="badge ok"><FinIcon name="check" size={13} /> оплачено</span>
                        {paidDate && <span className="mini muted">{formatDate(paidDate)}</span>}
                        {!s.paidMonth && <span className="mini muted">· без списания</span>}
                      </span>
                    ) : isPartial ? (
                      <span className="flex">
                        <span className="badge wait">частично · {money(paidAmount)}</span>
                        <span className="mini muted">осталось {money(remaining)}</span>
                      </span>
                    ) : <span className="badge wait">не оплачено</span>}
                  </td>
                  <td data-label="" className="num">
                    <span className="flex" style={{ justifyContent: 'flex-end' }}>
                      {isPaid
                        ? <button className="btn ghost sm" disabled={busyId === s.id} title="Отменить оплату" onClick={() => cancelMonth(s)}><FinIcon name="undo" size={15} /></button>
                        : <>
                            <button className="btn ghost sm" disabled={busyId === s.id || !accounts.length}
                              title="Выбрать сумму, дату и счёт" onClick={() => setPayFor(s)}>
                              <FinIcon name="check" size={14} /> {isPartial ? 'доплатить' : 'оплатить'}
                            </button>
                            <button className="btn ghost sm" disabled={busyId === s.id} title="Отметить оплаченным без списания со счёта" onClick={() => markPaid(s)}><FinIcon name="checkCircle" size={15} /></button>
                          </>}
                      <button className="btn ghost sm row-actions" title="Редактировать" onClick={() => setEditFor(s)}><FinIcon name="edit" size={15} /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><b>Итого</b></td>
              <td className="num"><b>{money(rows.reduce((sum, x) => sum + (x.amount || 0), 0))}</b></td>
              <td />
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {hidden > 0 && (
        <p className="mini muted" style={{ marginTop: 8 }}>
          Ещё {hidden} {hidden === 1 ? 'позиция не действует' : 'позиции не действуют'} в этом месяце —
          вне срока «с даты начала по дату окончания». Они не попадают ни сюда, ни в Планирование.
        </p>
      )}

      {editFor && <SubFormModal sub={editFor === 'new' ? undefined : editFor} onClose={() => setEditFor(null)} />}
      {payFor && <SubscriptionPaymentModal sub={payFor} ym={ym} onClose={() => setPayFor(null)} />}
    </>
  );
}

/** Оплата подписки/аренды всегда подтверждает сумму, дату и счёт.
 *  Это исключает случайное списание с первого счёта и поддерживает доплату. */
function SubscriptionPaymentModal({ sub, ym, onClose }: { sub: any; ym: string; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useFinAccounts();
  const categories = useFinCategories();
  const paid = Number(sub.paidMonth) || 0;
  const remaining = Math.max(0, (Number(sub.amount) || 0) - paid);
  const [amount, setAmount] = useState(String(remaining || sub.amount || ''));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  const valid = amt > 0 && amt <= remaining + 0.005 && !!accountId;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    const category = categories.find((c: any) => c.key === (sub.kind === 'rent' ? 'rent' : 'subscription'));
    try {
      await financeApi.createOperation({
        type: 'expense', amount: amt, date, accountId,
        categoryId: category?.id, subscriptionId: sub.id,
        comment: note.trim() ? `${sub.name} — ${note.trim()}` : sub.name,
      });
      invalidateFinance(qc);
      toast.success(`${sub.name}: оплачено ${money(amt)}`);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={`${paid > 0 ? 'Доплата' : 'Оплата'} · ${sub.name}`} onClose={onClose} width={460}
      footer={<>
        <button className="btn ghost" disabled={busy} onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!valid || busy} onClick={save}>
          {busy ? 'Провожу…' : `Оплатить ${valid ? money(amt) : ''}`}
        </button>
      </>}>
      <div className="fin-payment-summary">
        <span>Начислено за {monthLabel(ym, true)}</span><strong>{money(sub.amount)}</strong>
        {paid > 0 && <><span>Уже оплачено</span><strong>{money(paid)}</strong></>}
        <span>Осталось</span><strong>{money(remaining)}</strong>
      </div>
      <div className="form-grid">
        <div className="field"><label>Сумма, сомони</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field"><label>Дата списания</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field"><label>Со счёта</label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">— выбрать счёт —</option>
          {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="field"><label>Комментарий</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
      </div>
      {amt > remaining + 0.005 && <p className="mini neg" style={{ margin: 0 }}>Сумма больше остатка {money(remaining)}.</p>}
      <p className="mini muted" style={{ margin: 0 }}>Дата списания определяет месяц фактического расхода и влияет на баланс выбранного счёта.</p>
    </FinModal>
  );
}

