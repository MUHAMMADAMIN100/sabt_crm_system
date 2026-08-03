// Статья расхода /finance/expense/:kind (salary | rent_subs | debts | other) —
// порт fin-webrand/src/pages/ExpenseGroup.tsx (ТЗ 4.2–4.5).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, currentYm, currentSalaryYm, todayISO, formatDate, monthLabel, shiftYm, apiErr, downloadCsv, EXPENSE_GROUPS, OTHER_GROUP, useYmParam, salaryComment, withYm } from './finlib';
import { FinLoading, FinLoadError, FinModal, useModalKeys, finConfirm, invalidateFinance } from './FinKit';
import { EmployeeFormModal, SubFormModal, DebtFormModal } from './FinForms';
import FinIcon, { CatIcon } from './FinIcon';
import MonthNav from './MonthNav';
import EmployeeSalaryHistory from './EmployeeSalaryHistory';
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

export default function FinanceExpenseGroupPage() {
  const { kind } = useParams<{ kind: string }>();
  const location = useLocation();
  // Зарплатная ведомость живёт циклами «10-е → 10-е» — по умолчанию
  // открываем текущий зарплатный период (для остальных статей — календарный).
  // Месяц приходит из адреса (?ym=…) — тот же, что был выбран в «Расходах».
  const [ym, setYm] = useYmParam(kind === 'salary' ? currentSalaryYm() : currentYm());
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
      <p className="mini muted" style={{ marginTop: 12 }}>
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
  const [payFor, setPayFor] = useState<any | null>(null);
  const [payoutFor, setPayoutFor] = useState<{ row: any; kind: 'advance' | 'bonus' } | null>(null);
  const [empFor, setEmpFor] = useState<any | 'new' | null>(null);
  const [showFired, setShowFired] = useState(false);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
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
    return [...map.entries()].sort((a, b) =>
      (a[0] === 'Без категории' ? 1 : 0) - (b[0] === 'Без категории' ? 1 : 0)
      || a[0].localeCompare(b[0], 'ru'));
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
      await financeApi.removeMonthExpenses({ ym, employeeId: e.id });
      invalidateFinance(qc);
    } catch (err) { toast.error(apiErr(err)); }
  }

  function exportCsv() {
    const header = ['Сотрудник', 'Группа', 'Должность', 'Оклад', 'Бонус', 'Аванс', 'Штраф', 'Выплачено', 'К выплате'];
    const body = rows.map((e) => [e.name, e.category, e.role, e.salary, e.bonus, e.advance, e.fine ?? 0, e.paid, e.toPay]);
    downloadCsv(`salary-${ym}.csv`, [header, ...body]);
  }

  return (
    <>
      <div className="cards grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Фонд ЗП / мес</div><div className="value">{money(cards.fund)}</div>
          {(cards.bonuses ?? 0) > 0 && <div className="sub">+ бонусы {money(cards.bonuses)}</div>}
          {(cards.fines ?? 0) > 0 && <div className="sub">− штрафы {money(cards.fines)}</div>}
        </div>
        <div className="card stat"><div className="label">Авансы (выдано)</div><div className="value">{money(cards.advances)}</div></div>
        <div className="card stat"><div className="label">Выплачено за месяц</div><div className="value pos">{money(cards.paid)}</div></div>
        <div className="card stat"><div className="label">К выплате за месяц</div><div className="value neg">{money(cards.toPay)}</div><div className="sub">фонд + бонусы − авансы − штрафы − выплачено</div></div>
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

      {groups.map(([cat, list]) => {
        const sum = (f: (e: any) => number) => list.reduce((s, e) => s + (f(e) || 0), 0);
        return (
          <div key={cat}>
            {!(groups.length === 1 && cat === 'Без категории') && (
              <div className="section-title" style={{ margin: '18px 0 10px' }}>{cat} · {list.length} чел.</div>
            )}
            <div className="table-wrap fin-wide-table">
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: 160 }}>ФИО</th><th>Должность</th><th>Дата приёма</th>
                    <th className="num" style={{ width: 96 }}>ЗП</th><th className="num" style={{ width: 100 }}>Аванс</th>
                    <th className="num" style={{ width: 100 }}>Бонус</th>
                    <th className="num" style={{ width: 100 }}>Штраф</th>
                    <th style={{ minWidth: 150 }}>Статус</th><th style={{ width: 60 }} />
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
                    const isPaid = e.frozen || (gross > 0 && Number(e.toPay) <= 0.005);
                    const historyOpen = expandedEmployeeId === e.id;
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
                        <td>
                          <b className="fin-employee-name">{e.name}</b>
                        </td>
                        <td className="muted">{e.role ?? '—'}</td>
                        <td className="muted nowrap">{e.hireDate ? formatDate(e.hireDate) : '—'}</td>
                        <td className="num">{money(e.salary)}</td>
                        <td className="num"><MonthAmountCell row={e} ym={ym} field="advance" onPayout={() => setPayoutFor({ row: e, kind: 'advance' })} /></td>
                        <td className="num"><MonthAmountCell row={e} ym={ym} field="bonus" onPayout={() => setPayoutFor({ row: e, kind: 'bonus' })} /></td>
                        <td className="num"><MonthAmountCell row={e} ym={ym} field="fine" /></td>
                        <td>
                          {isPaid
                            ? <span className="flex"><span className="badge ok" title={e.paidAt ? `Выплачено ${formatDate(e.paidAt)} — месяц зафиксирован` : 'Месяц закрыт'}><FinIcon name="check" size={13} /> выплачено</span><button className="btn ghost sm" title="Отменить выплату" onClick={() => cancelSalaryMonth(e)}><FinIcon name="undo" size={15} /></button></span>
                            : <button className="btn primary sm" onClick={() => setPayFor(e)}>Выплатить</button>}
                        </td>
                        <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => openEmp(e)}><FinIcon name="edit" size={15} /></button></td>
                      </tr>
                      {historyOpen && (
                        <tr className="fin-employee-history-row">
                          <td colSpan={9}>
                            <EmployeeSalaryHistory employeeId={e.id} name={e.name}
                              onClose={() => closeEmployeeHistory(e.id)} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}><b>Итого · {cat}</b></td>
                    <td className="num"><b>{money(sum(e => Number(e.salary)))}</b></td>
                    <td className="num"><b>{money(sum(e => Number(e.advance)))}</b></td>
                    <td className="num"><b>{money(sum(e => Number(e.bonus)))}</b></td>
                    <td className="num"><b>{money(sum(e => Number(e.fine)))}</b></td>
                    <td colSpan={2} className="num nowrap">к выплате <b>{money(sum(e => Number(e.toPay)))}</b></td>
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
          <span className="mini muted nowrap">Выплачено <b className="pos">{money(cards.paid)}</b></span>
          <span className="mini muted nowrap">К выплате <b className="neg">{money(cards.toPay)}</b></span>
        </div>
      )}

      {fired.length > 0 && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={() => setShowFired((v) => !v)}>
            <FinIcon name={showFired ? 'chevronLeft' : 'chevronRight'} size={14} /> Уволенные сотрудники ({fired.length})
          </button>
          {showFired && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
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
                        <b className="fin-employee-name">{e.name}</b>
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
        </>
      )}

      {payFor && <SalaryPayModal row={payFor} ym={ym} onClose={() => setPayFor(null)} />}
      {payoutFor && <PayoutModal row={payoutFor.row} kind={payoutFor.kind} ym={ym} onClose={() => setPayoutFor(null)} />}
      {empFor && <EmployeeFormModal employee={empFor === 'new' ? undefined : empFor} categories={knownCategories} onClose={() => setEmpFor(null)} />}
    </>
  );
}

/** Ячейка месяца в зарплатной таблице.
 *  Штраф — число (удерживается при финальной выплате, правится инлайн).
 *  Аванс/бонус — ФАКТИЧЕСКИЕ выдачи: деньги списываются со счёта сразу
 *  отдельной операцией («+» открывает мини-форму выдачи); в ячейке — сумма
 *  выданного за месяц. Выплаченный месяц заморожен — только чтение. */
function MonthAmountCell({ row, ym, field, onPayout }: {
  row: any; ym: string; field: 'advance' | 'bonus' | 'fine'; onPayout?: () => void;
}) {
  const qc = useQueryClient();
  const value = Number(row[field]) || 0;
  if (row.frozen) {
    return <span className={field === 'fine' && value ? 'neg' : 'muted'} title="Месяц выплачен и зафиксирован">{value ? money(value) : '—'}</span>;
  }
  if (field === 'fine') {
    return (
      <input
        key={`${row.id}-${ym}-fine-${value}`}
        className="cell-input" inputMode="decimal" placeholder="—"
        style={{ textAlign: 'right', minWidth: 70, ...(value ? { color: 'var(--red, #dc2626)' } : {}) }}
        defaultValue={value ? value : ''}
        title="Штраф за этот месяц — удерживается при финальной выплате ЗП"
        onBlur={async (e) => {
          const v = Math.max(0, parseFloat(e.target.value.replace(',', '.')) || 0);
          if (v === value) return;
          try {
            await financeApi.setEmployeeFine(row.id, { ym, amount: v });
            invalidateFinance(qc);
          } catch (err) { toast.error(apiErr(err)); }
        }}
      />
    );
  }
  const label = field === 'advance' ? 'Выдать аванс' : 'Выплатить бонус';
  async function removeIssued() {
    const word = field === 'advance' ? 'авансы' : 'бонусы';
    if (!(await finConfirm(`Удалить ${word} за этот месяц у «${row.name}»? Операции удалятся из журнала, деньги вернутся на счёт.`, { confirmLabel: 'Удалить', danger: true }))) return;
    try {
      // Сюда попадаем только для advance/bonus (у 'fine' — ранний return выше).
      await financeApi.removeMonthExpenses({ ym, employeeId: row.id, kind: field as 'advance' | 'bonus' });
      invalidateFinance(qc);
    } catch (err) { toast.error(apiErr(err)); }
  }
  return (
    <span className="flex" style={{ justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
      {value ? <span>{money(value)}</span> : <span className="muted">—</span>}
      {value > 0 && (
        <button className="btn ghost sm" title={`Удалить ${field === 'advance' ? 'авансы' : 'бонусы'} за месяц`} onClick={removeIssued}>
          <FinIcon name="close" size={13} />
        </button>
      )}
      <button className="btn ghost sm" title={`${label} — операция спишется со счёта сразу`} onClick={onPayout}>
        <FinIcon name="plus" size={13} />
      </button>
    </span>
  );
}

/** Выдача аванса/бонуса: создаёт расходную операцию СРАЗУ (деньги выходят
 *  со счёта в момент выдачи). Комментарий «Аванс»/«Бонус» — по нему колонка
 *  и математика узнают тип выплаты. */
function PayoutModal({ row, kind, ym, onClose }: { row: any; kind: 'advance' | 'bonus'; ym: string; onClose: () => void }) {
  useModalKeys(onClose);
  const qc = useQueryClient();
  const accounts = useFinAccounts();
  const categories = useFinCategories();
  const [amount, setAmount] = useState('');
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

      <div className="table-wrap fin-wide-table">
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
                  <td><b>{s.name}</b></td>
                  <td className="muted">{s.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
                  <td className="num">{money(s.amount)}</td>
                  <td className="muted nowrap">{s.dueDay ? `до ${s.dueDay}-го` : '—'}</td>
                  <td>
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
                  <td className="num">
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

// ─── 4.4 Долги ───────────────────────────────────────────

function DebtsList({ ym }: { ym: string }) {
  const [start, setStart] = useState<string | null>(null);
  const [cellFor, setCellFor] = useState<{ debt: any; ym: string; payment?: any } | null>(null);
  const [debtFor, setDebtFor] = useState<any | 'new' | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'debts', ym, start],
    queryFn: () => financeApi.expenseDetail('debts', ym, start ?? undefined),
  });

  if (isLoading) return <FinLoading />;
  if (isError) return <FinLoadError onRetry={refetch} />;

  const months: string[] = data?.months ?? [];
  const rows: any[] = data?.rows ?? [];
  const stats = data?.stats ?? { totalDebt: 0, dueMonth: 0, count: 0 };
  const totals = data?.totals ?? { total: 0, perMonth: [] };
  const perMonth = (m: string) => (totals.perMonth ?? []).find((x: any) => x.ym === m)?.total ?? 0;

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Всего должны</div><div className="value neg">{money(stats.totalDebt)}</div><div className="sub">из {money(totals.total)}</div></div>
        {/* Бэк считает dueMonth по текущему календарному месяцу — подпись синхронизируем с ним. */}
        <div className="card stat"><div className="label">Должны за месяц</div><div className="value">{money(stats.dueMonth)}</div><div className="sub" style={{ textTransform: 'capitalize' }}>{monthLabel(ym, true)}</div></div>
        <div className="card stat"><div className="label">Долгов</div><div className="value">{stats.count}</div></div>
      </div>

      <div className="toolbar">
        <div className="month-nav">
          <button onClick={() => months.length && setStart(shiftYm(months[0], -1))} title="Раньше">‹</button>
          <span className="label" style={{ minWidth: 170, textTransform: 'none' }}>{months.length ? `${monthLabel(months[0])} – ${monthLabel(months[5])}` : '…'}</span>
          <button onClick={() => months.length && setStart(shiftYm(months[0], 1))} title="Позже">›</button>
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setDebtFor('new')}><FinIcon name="plus" size={16} /> Долг</button>
      </div>

      {rows.length === 0 ? (
        <div className="card empty"><div className="big"><FinIcon name="checkCircle" size={30} /></div>Долгов нет — нажмите «＋ Долг»</div>
      ) : (
        <div className="table-wrap fin-wide-table">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 190 }}>Наименование</th>
                <th className="num" style={{ width: 96 }}>Сумма</th>
                {months.map((m) => <th key={m} className="num" style={{ textTransform: 'capitalize', minWidth: 84 }}>{monthLabel(m)}</th>)}
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.debt.id} onDoubleClick={() => setDebtFor(r.debt)}>
                  <td>
                    <b>{r.debt.name}</b>
                    <div className="progress" style={{ marginTop: 6 }}><i style={{ width: (r.progress ?? 0) + '%', background: 'var(--amber)' }} /></div>
                    <span className="mini muted">осталось {money(r.remaining)} из {money(r.debt.totalAmount)}</span>
                  </td>
                  <td className="num">{money(r.debt.totalAmount)}</td>
                  {r.cells.map((cell: any) => (
                    <td key={cell.ym} className="num">
                      {(cell.plans ?? []).length === 0 ? (
                        <button className="btn ghost sm" title="Добавить платёж" onClick={() => setCellFor({ debt: r.debt, ym: cell.ym })}><FinIcon name="plus" size={14} /></button>
                      ) : (
                        <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
                          {cell.plans.map((p: any) => (
                            <button key={p.id}
                              className={'badge ' + (p.status === 'received' ? 'ok' : 'wait')}
                              style={{ cursor: 'pointer' }}
                              title={p.status === 'received' ? 'Оплачено — нажмите для управления' : 'Запланировано — нажмите, чтобы погасить'}
                              onClick={() => setCellFor({ debt: r.debt, ym: cell.ym, payment: p })}>
                              {p.status === 'received' && <FinIcon name="check" size={12} />} {money(p.amount)}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => setDebtFor(r.debt)}><FinIcon name="edit" size={15} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Итого</b></td>
                <td className="num"><b>{money(totals.total)}</b></td>
                {months.map((m) => <td key={m} className="num"><b>{money(perMonth(m))}</b></td>)}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {cellFor && <DebtCellModal {...cellFor} onClose={() => setCellFor(null)} />}
      {debtFor && <DebtFormModal debt={debtFor === 'new' ? undefined : debtFor} onClose={() => setDebtFor(null)} />}
    </>
  );
}

function DebtCellModal({ debt, ym, payment, onClose }: { debt: any; ym: string; payment?: any; onClose: () => void }) {
  useModalKeys(onClose);
  const qc = useQueryClient();
  const accounts = useFinAccounts();
  const { data: planned } = useQuery({
    queryKey: ['finance', 'plannedPayments', 'debt', debt.id],
    queryFn: () => financeApi.plannedPayments({ debtId: debt.id }),
  });
  // Полная запись долга — ради «Погашено до старта» (в expenseDetail его нет).
  const { data: allDebts } = useQuery({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() });
  const [amount, setAmount] = useState(String(payment?.amount ?? debt.monthlyPayment ?? ''));
  const [paidNow, setPaidNow] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  const scheduled = (planned ?? []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const paidBefore = Number((allDebts ?? []).find((d: any) => d.id === debt.id)?.paidBefore) || 0;
  const remaining = (debt.totalAmount || 0) - paidBefore - scheduled;
  const overLimit = debt.totalAmount > 0 && amt > remaining;
  const monthName = monthLabel(ym, true);

  async function saveNew() {
    if (!(amt > 0) || overLimit || busy) return;
    setBusy(true);
    try {
      if (paidNow) {
        if (!accountId) { setBusy(false); return; }
        await financeApi.payNow({ debtId: debt.id, ym, amount: amt, accountId, date });
      } else {
        await financeApi.createPlanned({ debtId: debt.id, ym, amount: amt });
      }
      invalidateFinance(qc);
      onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }
  async function markPaid() {
    if (!payment || !accountId || busy) return;
    setBusy(true);
    try {
      await financeApi.receivePlanned(payment.id, { accountId, date });
      invalidateFinance(qc);
      onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }
  async function deletePlan() {
    if (!payment || busy) return;
    setBusy(true);
    try {
      await financeApi.removePlanned(payment.id);
      invalidateFinance(qc);
      onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }
  async function undo() {
    if (!payment || busy) return;
    setBusy(true);
    try {
      await financeApi.unreceivePlanned(payment.id);
      invalidateFinance(qc);
      onClose();
    } catch (e) { toast.error(apiErr(e)); setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{debt.name} · {monthName}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        {payment ? (
          <>
            <div className="modal-body">
              {payment.status === 'received' ? (
                <p style={{ margin: 0 }}>Платёж <b>{money(payment.amount)}</b> отмечен как оплаченный.</p>
              ) : (
                <>
                  <p style={{ margin: 0 }}>Запланировано <b>{money(payment.amount)}</b>. Отметить оплаченным?</p>
                  <div className="form-grid">
                    <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                    <div className="field"><label>Со счёта</label>
                      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              {payment.status === 'received'
                ? <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={undo}>Отменить оплату</button>
                : <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={deletePlan}>Удалить план</button>}
              <button className="btn ghost" onClick={onClose}>Закрыть</button>
              {payment.status === 'expected' && <button className="btn primary" disabled={busy} onClick={markPaid}>Отметить оплаченным</button>}
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <label className="flex" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} style={{ width: 'auto' }} />
                Уже оплачено (создать расход)
              </label>
              {paidNow && (
                <div className="form-grid">
                  <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div className="field"><label>Со счёта</label>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  </div>
                </div>
              )}
              {overLimit
                ? <p className="mini neg" style={{ margin: 0 }}>Больше остатка по долгу. Доступно ещё {money(Math.max(0, remaining))} из {money(debt.totalAmount)}.</p>
                : <p className="mini muted" style={{ margin: 0 }}>Без галочки — план на {monthName}. Остаток по долгу: {money(Math.max(0, remaining))}.</p>}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={onClose}>Отмена</button>
              <button className="btn primary" disabled={busy || !(amt > 0) || overLimit} onClick={saveNew}>{paidNow ? 'Записать оплату' : 'Добавить план'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
