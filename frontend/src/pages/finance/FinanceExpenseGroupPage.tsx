// Статья расхода /finance/expense/:kind (salary | rent_subs | debts | other) —
// порт fin-webrand/src/pages/ExpenseGroup.tsx (ТЗ 4.2–4.5).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, currentYm, todayISO, formatDate, monthLabel, shiftYm, EXPENSE_GROUPS, OTHER_GROUP } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import MonthNav from './MonthNav';
import './finance.css';

function apiError(e: any) {
  toast.error(e?.response?.data?.message || 'Ошибка');
}

export default function FinanceExpenseGroupPage() {
  const { kind } = useParams<{ kind: string }>();
  const [ym, setYm] = useState(currentYm());

  if (kind === 'other') {
    return (
      <div className="fin-root">
        <Link to="/finance/expense" className="back"><FinIcon name="chevronLeft" size={15} /> Расход</Link>
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
      <Link to="/finance/expense" className="back"><FinIcon name="chevronLeft" size={15} /> Расход</Link>
      <div className="page-head">
        <div><h1 className="flex" style={{ color: g.color }}><FinIcon name={g.icon} size={22} /> <span style={{ color: 'var(--text)' }}>{g.label}</span></h1><p>Детализация и быстрая оплата</p></div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>
      {kind === 'salary' && <SalaryList ym={ym} />}
      {kind === 'rent_subs' && <SubsList ym={ym} />}
      {kind === 'debts' && <DebtsList ym={ym} />}
    </div>
  );
}

// ─── Общие хуки ──────────────────────────────────────────

function useFinAccounts(): any[] {
  const { data } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => financeApi.accounts() });
  return data ?? [];
}

function useFinCategories(): any[] {
  const { data } = useQuery({ queryKey: ['finance', 'categories'], queryFn: () => financeApi.categories() });
  return data ?? [];
}

/** Удалить операции месяца, отфильтрованные предикатом (отмена оплат ЗП/подписок). */
async function removeMonthOps(ym: string, pred: (t: any) => boolean) {
  // Реальный последний день месяца: '2026-06-31' уронил бы Postgres date-колонку.
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const res = await financeApi.transactions({ from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, pageSize: 1000 });
  const ops = (res?.items ?? []).filter(pred);
  for (const t of ops) await financeApi.removeTransaction(t.id);
}

// ─── 4.5 Прочее ──────────────────────────────────────────

function OtherExpenseList({ ym }: { ym: string }) {
  const { data } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'other', ym],
    queryFn: () => financeApi.expenseDetail('other', ym),
  });
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

function SalaryList({ ym }: { ym: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'salary', ym],
    queryFn: () => financeApi.expenseDetail('salary', ym),
  });
  const { data: fullEmployees } = useQuery({ queryKey: ['finance', 'employees'], queryFn: () => financeApi.employees() });
  const [payFor, setPayFor] = useState<any | null>(null);
  const [empFor, setEmpFor] = useState<any | 'new' | null>(null);
  const [showFired, setShowFired] = useState(false);

  const cards = data?.cards ?? { fund: 0, advances: 0, paid: 0, toPay: 0 };
  const rows: any[] = data?.rows ?? [];
  const fired: any[] = data?.fired ?? [];

  const openEmp = (row: any) => {
    const full = (fullEmployees ?? []).find((x: any) => x.id === row.id);
    setEmpFor(full ?? row);
  };

  async function cancelSalaryMonth(e: any) {
    if (!confirm('Отменить выплату? Зарплатные операции сотрудника за месяц будут удалены.')) return;
    try {
      await removeMonthOps(ym, (t) => t.employeeId === e.id && t.group === 'salary');
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (err) { apiError(err); }
  }

  return (
    <>
      <div className="cards grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Фонд ЗП / мес</div><div className="value">{money(cards.fund)}</div></div>
        <div className="card stat"><div className="label">Авансы (выдано)</div><div className="value">{money(cards.advances)}</div></div>
        <div className="card stat"><div className="label">Выплачено за месяц</div><div className="value pos">{money(cards.paid)}</div></div>
        <div className="card stat"><div className="label">К выплате за месяц</div><div className="value neg">{money(cards.toPay)}</div><div className="sub">фонд − авансы − выплачено</div></div>
      </div>

      <div className="toolbar">
        <span className="chip"><FinIcon name="receipt" size={14} /> Выплата ЗП — каждое 10-е число месяца</span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEmpFor('new')}><FinIcon name="plus" size={16} /> Сотрудник</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ФИО</th><th>Должность</th><th>Дата приёма</th>
              <th className="num">ЗП</th><th className="num">Аванс</th><th>Статус</th><th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const isPaid = e.salary > 0 && e.paid >= e.salary;
              return (
                <tr key={e.id} onDoubleClick={() => openEmp(e)}>
                  <td><b>{e.name}</b></td>
                  <td className="muted">{e.role ?? '—'}</td>
                  <td className="muted nowrap">{e.hireDate ? formatDate(e.hireDate) : '—'}</td>
                  <td className="num">{money(e.salary)}</td>
                  <td className="num muted">{e.advance ? money(e.advance) : '—'}</td>
                  <td>
                    {isPaid
                      ? <span className="flex"><span className="badge ok"><FinIcon name="check" size={13} /> выплачено</span><button className="btn ghost sm" title="Отменить выплату" onClick={() => cancelSalaryMonth(e)}><FinIcon name="undo" size={15} /></button></span>
                      : <button className="btn primary sm" onClick={() => setPayFor(e)}>Выплатить</button>}
                  </td>
                  <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => openEmp(e)}><FinIcon name="edit" size={15} /></button></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">Нет активных сотрудников</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><b>Итого</b></td>
              <td className="num"><b>{money(cards.fund)}</b></td>
              <td className="num"><b>{money(cards.advances)}</b></td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

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
                  {fired.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.7 }} onDoubleClick={() => openEmp(e)}>
                      <td><b>{e.name}</b></td>
                      <td className="muted">{e.role ?? '—'}</td>
                      <td className="muted nowrap">{e.hireDate ? formatDate(e.hireDate) : '—'}</td>
                      <td className="num muted">{money(e.salary)}</td>
                      <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => openEmp(e)}><FinIcon name="edit" size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {payFor && <SalaryPayModal row={payFor} ym={ym} onClose={() => setPayFor(null)} />}
      {empFor && <EmployeeFormModal employee={empFor === 'new' ? undefined : empFor} onClose={() => setEmpFor(null)} />}
    </>
  );
}

function EmployeeFormModal({ employee, onClose }: { employee?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(employee?.name ?? '');
  const [role, setRole] = useState(employee?.role ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '');
  const [salary, setSalary] = useState(employee != null ? String(employee.salary ?? '') : '');
  const [advance, setAdvance] = useState(employee != null ? String(employee.advance ?? '') : '');
  const [status, setStatus] = useState<string>(employee?.status ?? 'active');

  async function save() {
    if (!name.trim()) return;
    const p = {
      name: name.trim(), role: role.trim() || undefined, hireDate: hireDate || undefined,
      salary: parseFloat(salary) || 0, advance: parseFloat(advance) || 0, status,
    };
    try {
      if (employee) await financeApi.updateEmployee(employee.id, p);
      else await financeApi.createEmployee(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }
  async function remove() {
    if (!employee || !confirm('Удалить сотрудника? История выплат сохранится в транзакциях.')) return;
    try {
      await financeApi.removeEmployee(employee.id);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head"><h3>{employee ? 'Сотрудник' : 'Новый сотрудник'}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>ФИО</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="form-grid">
            <div className="field"><label>Должность</label><input value={role} onChange={(e) => setRole(e.target.value)} /></div>
            <div className="field"><label>Дата приёма</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>ЗП / мес</label><input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
            <div className="field"><label>Аванс</label><input inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} /></div>
          </div>
          <div className="field"><label>Статус</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Работает</option><option value="fired">Уволен</option>
            </select>
          </div>
        </div>
        <div className="modal-foot">
          {employee && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>Удалить</button>}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{employee ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  );
}

function SalaryPayModal({ row, ym, onClose }: { row: any; ym: string; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useFinAccounts();
  const categories = useFinCategories();
  const remaining = Math.max(0, row.toPay ?? 0);
  const [amount, setAmount] = useState(String(remaining || row.salary || ''));
  const [date, setDate] = useState(`${ym}-10`); // выплата 10-го числа
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  async function save() {
    if (!(amt > 0) || !accountId) return;
    const salaryCat = categories.find((c: any) => c.key === 'salary');
    try {
      await financeApi.createOperation({
        type: 'expense', amount: amt, date, accountId,
        categoryId: salaryCat?.id, employeeId: row.id, comment: 'Зарплата',
      });
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
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
          <div className="field"><label>Со счёта</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <p className="mini muted" style={{ margin: 0 }}>По умолчанию — 10-е число месяца. Остаток к выплате: {money(remaining)}.</p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!(amt > 0) || !accountId} onClick={save}>Выплатить</button>
        </div>
      </div>
    </div>
  );
}

// ─── 4.3 Аренда и подписки ───────────────────────────────

function SubsList({ ym }: { ym: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'subscriptions', ym],
    queryFn: () => financeApi.expenseDetail('subscriptions', ym),
  });
  const accounts = useFinAccounts();
  const categories = useFinCategories();
  const [editFor, setEditFor] = useState<any | 'new' | null>(null);

  const rows: any[] = data?.rows ?? [];
  const monthly: number = data?.monthly ?? 0;

  async function pay(s: any) {
    const accountId = accounts[0]?.id;
    if (!accountId) { toast.error('Нет счетов'); return; }
    const cat = categories.find((c: any) => c.key === (s.kind === 'rent' ? 'rent' : 'subscription'));
    try {
      await financeApi.createOperation({
        type: 'expense', amount: s.amount, date: todayISO(), accountId,
        categoryId: cat?.id, subscriptionId: s.id, comment: s.name,
      });
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (e) { apiError(e); }
  }

  /** Отметить оплаченным без операции: денег по счетам не двигает. */
  async function markPaid(s: any) {
    try {
      await financeApi.markSubPaid(s.id, { ym, date: todayISO() });
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (e) { apiError(e); }
  }

  async function cancelMonth(s: any) {
    if (!confirm('Отменить оплату? Оплаты позиции за месяц будут удалены.')) return;
    try {
      await removeMonthOps(ym, (t) => t.subscriptionId === s.id);
      if (s.paidMark) await financeApi.unmarkSubPaid(s.id, { ym });
    } catch (e) { apiError(e); }
    finally { qc.invalidateQueries({ queryKey: ['finance'] }); }
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

      <div className="table-wrap">
        <table>
          <thead><tr><th>Позиция</th><th>Тип</th><th className="num">Сумма/мес</th><th>Статус месяца</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {rows.map((s) => {
              const isPaid = !!s.paidMonth || !!s.paidMark;
              const paidDate = s.lastPaidDate ?? s.paidMark;
              return (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }} onDoubleClick={() => setEditFor(s)}>
                  <td><b>{s.name}</b></td>
                  <td className="muted">{s.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
                  <td className="num">{money(s.amount)}</td>
                  <td>
                    {isPaid ? (
                      <span className="flex">
                        <span className="badge ok"><FinIcon name="check" size={13} /> оплачено</span>
                        {paidDate && <span className="mini muted">{formatDate(paidDate)}</span>}
                        {!s.paidMonth && <span className="mini muted">· без списания</span>}
                      </span>
                    ) : <span className="badge wait">не оплачено</span>}
                  </td>
                  <td className="num">
                    <span className="flex" style={{ justifyContent: 'flex-end' }}>
                      {isPaid
                        ? <button className="btn ghost sm" title="Отменить оплату" onClick={() => cancelMonth(s)}><FinIcon name="undo" size={15} /></button>
                        : <>
                            <button className="btn ghost sm" title="Оплатить — создаст расход со счёта" onClick={() => pay(s)}><FinIcon name="check" size={14} /> оплатить</button>
                            <button className="btn ghost sm" title="Отметить оплаченным без списания со счёта" onClick={() => markPaid(s)}><FinIcon name="checkCircle" size={15} /></button>
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
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {editFor && <SubFormModal sub={editFor === 'new' ? undefined : editFor} onClose={() => setEditFor(null)} />}
    </>
  );
}

function SubFormModal({ sub, onClose }: { sub?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(sub?.name ?? '');
  const [kind, setKind] = useState<string>(sub?.kind ?? 'subscription');
  const [amount, setAmount] = useState(sub != null ? String(sub.amount ?? '') : '');
  const amt = parseFloat(amount.replace(',', '.'));

  async function save() {
    if (!name.trim()) return;
    const p = { name: name.trim(), kind, amount: amt > 0 ? amt : 0, active: sub?.active ?? true };
    try {
      if (sub) await financeApi.updateSubscription(sub.id, p);
      else await financeApi.createSubscription(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }
  async function remove() {
    if (!sub || !confirm('Удалить позицию?')) return;
    try {
      await financeApi.removeSubscription(sub.id);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{sub ? 'Расход' : 'Новый расход'}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Аренда, Adobe, Server…" /></div>
          <div className="form-grid">
            <div className="field"><label>Тип</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="rent">Аренда</option><option value="subscription">Подписка</option>
              </select>
            </div>
            <div className="field"><label>Сумма / мес</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot">
          {sub && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>Удалить</button>}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{sub ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 4.4 Долги ───────────────────────────────────────────

function DebtsList({ ym }: { ym: string }) {
  const [start, setStart] = useState<string | null>(null);
  const [cellFor, setCellFor] = useState<{ debt: any; ym: string; payment?: any } | null>(null);
  const [debtFor, setDebtFor] = useState<any | 'new' | null>(null);

  const { data } = useQuery({
    queryKey: ['finance', 'expenseDetail', 'debts', ym, start],
    queryFn: () => financeApi.expenseDetail('debts', ym, start ?? undefined),
  });

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
        <div className="card stat"><div className="label">Должны за месяц</div><div className="value">{money(stats.dueMonth)}</div><div className="sub" style={{ textTransform: 'capitalize' }}>{monthLabel(currentYm(), true)}</div></div>
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
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Наименование</th>
                <th className="num">Сумма</th>
                {months.map((m) => <th key={m} className="num" style={{ textTransform: 'capitalize' }}>{monthLabel(m)}</th>)}
                <th style={{ width: 44 }} />
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
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  const scheduled = (planned ?? []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const paidBefore = Number((allDebts ?? []).find((d: any) => d.id === debt.id)?.paidBefore) || 0;
  const remaining = (debt.totalAmount || 0) - paidBefore - scheduled;
  const overLimit = debt.totalAmount > 0 && amt > remaining;
  const monthName = monthLabel(ym, true);

  async function saveNew() {
    if (!(amt > 0) || overLimit) return;
    try {
      if (paidNow) {
        if (!accountId) return;
        await financeApi.payNow({ debtId: debt.id, ym, amount: amt, accountId, date });
      } else {
        await financeApi.createPlanned({ debtId: debt.id, ym, amount: amt });
      }
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }
  async function markPaid() {
    if (!payment || !accountId) return;
    try {
      await financeApi.receivePlanned(payment.id, { accountId, date });
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }
  async function deletePlan() {
    if (!payment) return;
    try {
      await financeApi.removePlanned(payment.id);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }
  async function undo() {
    if (!payment) return;
    try {
      await financeApi.unreceivePlanned(payment.id);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
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
                ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={undo}>Отменить оплату</button>
                : <button className="btn danger" style={{ marginRight: 'auto' }} onClick={deletePlan}>Удалить план</button>}
              <button className="btn ghost" onClick={onClose}>Закрыть</button>
              {payment.status === 'expected' && <button className="btn primary" onClick={markPaid}>Отметить оплаченным</button>}
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
              <button className="btn primary" disabled={!(amt > 0) || overLimit} onClick={saveNew}>{paidNow ? 'Записать оплату' : 'Добавить план'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DebtFormModal({ debt, onClose }: { debt?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(debt?.name ?? '');
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? '');
  const [totalAmount, setTotalAmount] = useState(debt != null ? String(debt.totalAmount ?? '') : '');
  const [monthlyPayment, setMonthlyPayment] = useState(debt?.monthlyPayment ? String(debt.monthlyPayment) : '');
  const [paidBefore, setPaidBefore] = useState(String(debt?.paidBefore ?? 0));

  async function save() {
    if (!name.trim()) return;
    const p = {
      name: name.trim(), counterparty: counterparty.trim() || undefined,
      totalAmount: parseFloat(totalAmount) || 0, monthlyPayment: parseFloat(monthlyPayment) || undefined,
      paidBefore: parseFloat(paidBefore) || 0,
    };
    try {
      // Бэк сам перегенерирует график погашения после create/update.
      if (debt) await financeApi.updateDebt(debt.id, p);
      else await financeApi.createDebt(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }
  async function remove() {
    if (!debt || !confirm('Удалить долг? График погашения тоже удалится.')) return;
    try {
      await financeApi.removeDebt(debt.id);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { apiError(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{debt ? 'Долг' : 'Новый долг'}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Наименование</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Камера в рассрочку…" /></div>
          <div className="form-grid">
            <div className="field"><label>Контрагент</label><input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></div>
            <div className="field"><label>Платёж / мес</label><input inputMode="decimal" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Сумма долга</label><input inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} /></div>
            <div className="field"><label>Погашено до старта</label><input inputMode="decimal" value={paidBefore} onChange={(e) => setPaidBefore(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot">
          {debt && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>Удалить</button>}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{debt ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  );
}
