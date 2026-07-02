import { useMemo, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useTransactions, useEmployees, useSubscriptions, useDebts, useAccounts, usePlannedPayments, useCategories,
  addTransaction, cancelSubscriptionMonth, cancelSalaryMonth, addDebtPlan, addPaidDebt, payDebtPlanned, unreceivePlanned, regenerateDebtSchedule,
} from '../state/data';
import type { ExpenseGroup as EG, Employee, Subscription, Debt, PlannedPayment } from '../db/types';
import { debtRemaining } from '../lib/calc';
import { groupMeta, CAT } from '../lib/constants';
import { money, currentYm, ymOf, todayISO, formatDate, monthLabel, shiftYm } from '../lib/format';
import { db, uid } from '../db/db';
import MonthNav from '../components/MonthNav';
import Icon from '../components/Icon';

export default function ExpenseGroupPage() {
  const { group } = useParams<{ group: string }>();
  const [ym, setYm] = useState(currentYm());

  if (group === 'other') {
    return (
      <>
        <Link to="/expense" className="back"><Icon name="chevronLeft" size={15} /> Расход</Link>
        <div className="page-head">
          <div><h1 className="flex" style={{ color: '#64748b' }}><Icon name="arrowRight" size={22} /> <span style={{ color: 'var(--text)' }}>Прочие расходы</span></h1><p>Реклама, транспорт, налоги и другие категории</p></div>
          <MonthNav ym={ym} onChange={setYm} />
        </div>
        <OtherExpenseList ym={ym} />
      </>
    );
  }

  const g = groupMeta(group as EG);
  if (!g || !group) return <div className="empty">Статья не найдена</div>;

  return (
    <>
      <Link to="/expense" className="back"><Icon name="chevronLeft" size={15} /> Расход</Link>
      <div className="page-head">
        <div><h1 className="flex" style={{ color: g.color }}><Icon name={g.icon} size={22} /> <span style={{ color: 'var(--text)' }}>{g.label}</span></h1><p>Детализация и быстрая оплата</p></div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>
      {group === 'salary' && <SalaryList ym={ym} />}
      {group === 'rent_subs' && <SubsList ym={ym} />}
      {group === 'debts' && <DebtsList />}
    </>
  );
}

function OtherExpenseList({ ym }: { ym: string }) {
  const txns = useTransactions();
  const categories = useCategories();
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // расходы за месяц вне 3 частей, сгруппированные по категории
  const rows = useMemo(() => {
    const map = new Map<string | undefined, number>();
    for (const t of txns) {
      if (t.type !== 'expense' || ymOf(t.date) !== ym) continue;
      if (['salary', 'rent_subs', 'debts'].includes(t.group ?? '')) continue;
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
    }
    return [...map.entries()].map(([categoryId, total]) => ({ categoryId, total })).sort((a, b) => b.total - a.total);
  }, [txns, ym, catMap]);

  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Прочие расходы за месяц</div><div className="value neg">{money(total)}</div></div>
      </div>
      {rows.length === 0 ? (
        <div className="card empty"><div className="big"><Icon name="wallet" size={30} /></div>Нет прочих расходов за месяц</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Категория</th><th className="num">Сумма</th><th style={{ width: 200 }}>Доля</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const c = catMap.get(r.categoryId ?? '');
                const pct = total ? Math.round((r.total / total) * 100) : 0;
                return (
                  <tr key={r.categoryId ?? 'none'}>
                    <td><span className="flex">{c && <span style={{ color: c.color, display: 'inline-flex' }}><Icon name={c.icon} size={16} /></span>}<b>{c?.name ?? 'Без категории'}</b></span></td>
                    <td className="num">{money(r.total)}</td>
                    <td><div className="progress"><i style={{ width: pct + '%', background: c?.color ?? '#94a3b8' }} /></div><span className="mini muted">{pct}%</span></td>
                  </tr>
                );
              })}
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

function useAccountId() {
  const accounts = useAccounts();
  return accounts[0]?.id;
}

function SalaryList({ ym }: { ym: string }) {
  const employees = useEmployees();
  const txns = useTransactions();
  const [payFor, setPayFor] = useState<Employee | null>(null);
  const [empFor, setEmpFor] = useState<Employee | 'new' | null>(null);
  const [showFired, setShowFired] = useState(false);

  const paidMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns) if (t.type === 'expense' && t.group === 'salary' && t.employeeId && ymOf(t.date) === ym)
      m.set(t.employeeId, (m.get(t.employeeId) ?? 0) + t.amount);
    return m;
  }, [txns, ym]);

  const active = employees.filter((e) => e.status === 'active');
  const fired = employees.filter((e) => e.status === 'fired');
  const fund = active.reduce((s, e) => s + e.salary, 0);
  const advancesTotal = active.reduce((s, e) => s + e.advance, 0);
  const paid = active.reduce((s, e) => s + (paidMap.get(e.id) ?? 0), 0);
  const toPay = Math.max(0, fund - advancesTotal - paid);

  return (
    <>
      <div className="cards grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Фонд ЗП / мес</div><div className="value">{money(fund)}</div></div>
        <div className="card stat"><div className="label">Авансы (выдано)</div><div className="value">{money(advancesTotal)}</div></div>
        <div className="card stat"><div className="label">Выплачено за месяц</div><div className="value pos">{money(paid)}</div></div>
        <div className="card stat"><div className="label">К выплате за месяц</div><div className="value neg">{money(toPay)}</div><div className="sub">фонд − авансы − выплачено</div></div>
      </div>

      <div className="toolbar">
        <span className="chip"><Icon name="receipt" size={14} /> Выплата ЗП — каждое 10-е число месяца</span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEmpFor('new')}><Icon name="plus" size={16} /> Сотрудник</button>
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
            {active.map((e) => {
              const p = paidMap.get(e.id) ?? 0;
              const isPaid = e.salary > 0 && p >= e.salary;
              return (
                <tr key={e.id} onDoubleClick={() => setEmpFor(e)}>
                  <td><b>{e.name}</b></td>
                  <td className="muted">{e.role ?? '—'}</td>
                  <td className="muted nowrap">{e.hireDate ? formatDate(e.hireDate) : '—'}</td>
                  <td className="num">{money(e.salary)}</td>
                  <td className="num muted">{e.advance ? money(e.advance) : '—'}</td>
                  <td>
                    {isPaid
                      ? <span className="flex"><span className="badge ok"><Icon name="check" size={13} /> выплачено</span><button className="btn ghost sm" title="Отменить выплату" onClick={() => cancelSalaryMonth(e.id, ym)}><Icon name="undo" size={15} /></button></span>
                      : <button className="btn primary sm" onClick={() => setPayFor(e)}>Выплатить</button>}
                  </td>
                  <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => setEmpFor(e)}><Icon name="edit" size={15} /></button></td>
                </tr>
              );
            })}
            {active.length === 0 && <tr><td colSpan={7} className="empty">Нет активных сотрудников</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><b>Итого</b></td>
              <td className="num"><b>{money(fund)}</b></td>
              <td className="num"><b>{money(advancesTotal)}</b></td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {fired.length > 0 && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={() => setShowFired((v) => !v)}>
            <Icon name={showFired ? 'chevronLeft' : 'chevronRight'} size={14} /> Уредшие сотрудники ({fired.length})
          </button>
          {showFired && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>ФИО</th><th>Должность</th><th>Дата приёма</th><th className="num">ЗП</th><th /></tr></thead>
                <tbody>
                  {fired.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.7 }} onDoubleClick={() => setEmpFor(e)}>
                      <td><b>{e.name}</b></td>
                      <td className="muted">{e.role ?? '—'}</td>
                      <td className="muted nowrap">{e.hireDate ? formatDate(e.hireDate) : '—'}</td>
                      <td className="num muted">{money(e.salary)}</td>
                      <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => setEmpFor(e)}><Icon name="edit" size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {payFor && <SalaryPayModal employee={payFor} ym={ym} alreadyPaid={paidMap.get(payFor.id) ?? 0} onClose={() => setPayFor(null)} />}
      {empFor && <EmployeeFormModal employee={empFor === 'new' ? undefined : empFor} onClose={() => setEmpFor(null)} />}
    </>
  );
}

function EmployeeFormModal({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const [name, setName] = useState(employee?.name ?? '');
  const [role, setRole] = useState(employee?.role ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '');
  const [salary, setSalary] = useState(employee ? String(employee.salary) : '');
  const [advance, setAdvance] = useState(employee ? String(employee.advance) : '');
  const [status, setStatus] = useState<Employee['status']>(employee?.status ?? 'active');

  async function save() {
    if (!name.trim()) return;
    const p = {
      name: name.trim(), role: role.trim() || undefined, hireDate: hireDate || undefined,
      salary: parseFloat(salary) || 0, advance: parseFloat(advance) || 0, status,
    };
    if (employee) await db.employees.update(employee.id, p);
    else await db.employees.add({ id: uid(), ...p });
    onClose();
  }
  async function remove() {
    if (employee && confirm('Удалить сотрудника? История выплат сохранится в транзакциях.')) { await db.employees.delete(employee.id); onClose(); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head"><h3>{employee ? 'Сотрудник' : 'Новый сотрудник'}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
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
            <select value={status} onChange={(e) => setStatus(e.target.value as Employee['status'])}>
              <option value="active">Работает</option><option value="fired">Ушёл</option>
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

function SalaryPayModal({ employee, ym, alreadyPaid, onClose }: { employee: Employee; ym: string; alreadyPaid: number; onClose: () => void }) {
  const accounts = useAccounts();
  const remaining = Math.max(0, employee.salary - alreadyPaid);
  const [amount, setAmount] = useState(String(remaining || employee.salary));
  const [date, setDate] = useState(`${ym}-10`); // выплата 10-го числа
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  async function save() {
    if (!(amt > 0) || !accountId) return;
    await addTransaction({ date, type: 'expense', amount: amt, group: 'salary', categoryId: CAT.salary, accountFrom: accountId, employeeId: employee.id, comment: 'Зарплата' });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Выплата ЗП · {employee.name}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата выплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>Со счёта</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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

function SubsList({ ym }: { ym: string }) {
  const subs = useSubscriptions();
  const txns = useTransactions();
  const acc = useAccountId();
  const [editFor, setEditFor] = useState<Subscription | 'new' | null>(null);

  const paidThis = useMemo(() => {
    const m = new Map<string, { sum: number; last: string }>();
    for (const t of txns) if (t.type === 'expense' && t.group === 'rent_subs' && t.subscriptionId && ymOf(t.date) === ym) {
      const cur = m.get(t.subscriptionId) ?? { sum: 0, last: '' };
      cur.sum += t.amount;
      if (t.date > cur.last) cur.last = t.date;
      m.set(t.subscriptionId, cur);
    }
    return m;
  }, [txns, ym]);

  async function pay(s: Subscription) {
    await addTransaction({ date: todayISO(), type: 'expense', amount: s.amount, group: 'rent_subs', categoryId: s.kind === 'rent' ? CAT.rent : CAT.subscription, accountFrom: s.accountId ?? acc, subscriptionId: s.id, comment: s.name });
  }

  const total = subs.filter((s) => s.active).reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Аренда + подписки / мес</div><div className="value">{money(total)}</div></div>
      </div>
      <div className="toolbar">
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditFor('new')}><Icon name="plus" size={16} /> Добавить расход</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Позиция</th><th>Тип</th><th className="num">Сумма/мес</th><th>Статус месяца</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {subs.map((s) => {
              const info = paidThis.get(s.id);
              const paid = (info?.sum ?? 0) >= s.amount;
              return (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }} onDoubleClick={() => setEditFor(s)}>
                  <td><b>{s.name}</b></td>
                  <td className="muted">{s.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
                  <td className="num">{money(s.amount)}</td>
                  <td>
                    {paid ? (
                      <span className="flex">
                        <span className="badge ok">оплачено</span>
                        {info?.last && <span className="mini muted">{formatDate(info.last)}</span>}
                      </span>
                    ) : <span className="badge wait">не оплачено</span>}
                  </td>
                  <td className="num">
                    <span className="flex" style={{ justifyContent: 'flex-end' }}>
                      {paid
                        ? <button className="btn ghost sm" title="Отменить оплату" onClick={() => cancelSubscriptionMonth(s.id, ym)}><Icon name="undo" size={15} /></button>
                        : <button className="btn ghost sm" onClick={() => pay(s)}><Icon name="check" size={14} /> оплатить</button>}
                      <button className="btn ghost sm row-actions" title="Редактировать" onClick={() => setEditFor(s)}><Icon name="edit" size={15} /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><b>Итого</b></td>
              <td className="num"><b>{money(subs.reduce((sum, x) => sum + x.amount, 0))}</b></td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {editFor && <SubFormModal sub={editFor === 'new' ? undefined : editFor} onClose={() => setEditFor(null)} />}
    </>
  );
}

function SubFormModal({ sub, onClose }: { sub?: Subscription; onClose: () => void }) {
  const [name, setName] = useState(sub?.name ?? '');
  const [kind, setKind] = useState<Subscription['kind']>(sub?.kind ?? 'subscription');
  const [amount, setAmount] = useState(sub ? String(sub.amount) : '');
  const amt = parseFloat(amount.replace(',', '.'));

  async function save() {
    if (!name.trim()) return;
    const p = { name: name.trim(), kind, amount: amt > 0 ? amt : 0, active: sub?.active ?? true, accountId: sub?.accountId };
    if (sub) await db.subscriptions.update(sub.id, p);
    else await db.subscriptions.add({ id: uid(), ...p });
    onClose();
  }
  async function remove() {
    if (sub && confirm('Удалить позицию?')) { await db.subscriptions.delete(sub.id); onClose(); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{sub ? 'Расход' : 'Новый расход'}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Аренда, Adobe, Server…" /></div>
          <div className="form-grid">
            <div className="field"><label>Тип</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as Subscription['kind'])}>
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

function DebtsList() {
  const debts = useDebts();
  const txns = useTransactions();
  const planned = usePlannedPayments();
  const [start, setStart] = useState<string | null>(null);
  const [cellFor, setCellFor] = useState<{ debt: Debt; ym: string; payment?: PlannedPayment } | null>(null);
  const [debtFor, setDebtFor] = useState<Debt | 'new' | null>(null);

  const debtIds = useMemo(() => new Set(debts.map((d) => d.id)), [debts]);
  const startDefault = useMemo(() => {
    const ms = [
      ...debts.map((d) => d.startDate?.slice(0, 7)).filter(Boolean) as string[],
      ...planned.filter((p) => p.debtId && debtIds.has(p.debtId)).map((p) => p.ym),
      currentYm(),
    ].sort();
    return ms[0] ?? currentYm();
  }, [debts, planned, debtIds]);
  const winStart = start ?? startDefault;
  const months = Array.from({ length: 6 }, (_, i) => shiftYm(winStart, i));

  const cellPlans = (debtId: string, ym: string) => planned.filter((p) => p.debtId === debtId && p.ym === ym);
  const monthTotal = (ym: string) => planned.filter((p) => p.debtId && debtIds.has(p.debtId) && p.ym === ym).reduce((s, p) => s + p.amount, 0);

  const totalRemaining = debts.reduce((s, d) => s + debtRemaining(d, txns), 0);
  const totalSum = debts.reduce((s, d) => s + d.totalAmount, 0);
  const cm = currentYm();
  const dueThisMonth = planned.filter((p) => p.debtId && debtIds.has(p.debtId) && p.ym === cm && p.status === 'expected').reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Всего должны</div><div className="value neg">{money(totalRemaining)}</div><div className="sub">из {money(totalSum)}</div></div>
        <div className="card stat"><div className="label">Должны за месяц</div><div className="value">{money(dueThisMonth)}</div><div className="sub" style={{ textTransform: 'capitalize' }}>{monthLabel(cm, true)}</div></div>
        <div className="card stat"><div className="label">Долгов</div><div className="value">{debts.filter((d) => debtRemaining(d, txns) > 0).length}</div></div>
      </div>

      <div className="toolbar">
        <div className="month-nav">
          <button onClick={() => setStart(shiftYm(winStart, -1))} title="Раньше">‹</button>
          <span className="label" style={{ minWidth: 170, textTransform: 'none' }}>{monthLabel(months[0])} – {monthLabel(months[5])}</span>
          <button onClick={() => setStart(shiftYm(winStart, 1))} title="Позже">›</button>
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setDebtFor('new')}><Icon name="plus" size={16} /> Долг</button>
      </div>

      {debts.length === 0 ? (
        <div className="card empty"><div className="big"><Icon name="checkCircle" size={30} /></div>Долгов нет — нажмите «＋ Долг»</div>
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
              {debts.map((d) => {
                const remaining = debtRemaining(d, txns);
                const pct = d.totalAmount ? Math.round(((d.totalAmount - remaining) / d.totalAmount) * 100) : 0;
                return (
                  <tr key={d.id} onDoubleClick={() => setDebtFor(d)}>
                    <td>
                      <b>{d.name}</b>
                      <div className="progress" style={{ marginTop: 6 }}><i style={{ width: pct + '%', background: 'var(--amber)' }} /></div>
                      <span className="mini muted">осталось {money(remaining)} из {money(d.totalAmount)}</span>
                    </td>
                    <td className="num">{money(d.totalAmount)}</td>
                    {months.map((m) => {
                      const ps = cellPlans(d.id, m);
                      return (
                        <td key={m} className="num">
                          {ps.length === 0 ? (
                            <button className="btn ghost sm" title="Добавить платёж" onClick={() => setCellFor({ debt: d, ym: m })}><Icon name="plus" size={14} /></button>
                          ) : (
                            <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
                              {ps.map((p) => (
                                <button key={p.id}
                                  className={'badge ' + (p.status === 'received' ? 'ok' : 'wait')}
                                  style={{ cursor: 'pointer' }}
                                  title={p.status === 'received' ? 'Оплачено — нажмите для управления' : 'Запланировано — нажмите, чтобы погасить'}
                                  onClick={() => setCellFor({ debt: d, ym: m, payment: p })}>
                                  {p.status === 'received' && <Icon name="check" size={12} />} {money(p.amount)}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="num"><button className="btn ghost sm" title="Редактировать" onClick={() => setDebtFor(d)}><Icon name="edit" size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Итого</b></td>
                <td className="num"><b>{money(totalSum)}</b></td>
                {months.map((m) => <td key={m} className="num"><b>{money(monthTotal(m))}</b></td>)}
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

function DebtCellModal({ debt, ym, payment, onClose }: { debt: Debt; ym: string; payment?: PlannedPayment; onClose: () => void }) {
  const accounts = useAccounts();
  const planned = usePlannedPayments();
  const [amount, setAmount] = useState(String(payment?.amount ?? debt.monthlyPayment ?? ''));
  const [paidNow, setPaidNow] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const amt = parseFloat(amount.replace(',', '.'));
  const scheduled = planned.filter((p) => p.debtId === debt.id).reduce((s, p) => s + p.amount, 0);
  const remaining = debt.totalAmount - scheduled;
  const overLimit = debt.totalAmount > 0 && amt > remaining;
  const monthName = monthLabel(ym, true);

  async function saveNew() {
    if (!(amt > 0) || overLimit) return;
    if (paidNow) { if (!accountId) return; await addPaidDebt(debt.id, ym, amt, accountId, date); }
    else await addDebtPlan(debt.id, ym, amt);
    onClose();
  }
  async function markPaid() { if (!payment || !accountId) return; await payDebtPlanned(payment, accountId, date); onClose(); }
  async function deletePlan() { if (payment) await db.plannedPayments.delete(payment.id); onClose(); }
  async function undo() { if (payment) await unreceivePlanned(payment); onClose(); }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{debt.name} · {monthName}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
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
                      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
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
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
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

function DebtFormModal({ debt, onClose }: { debt?: Debt; onClose: () => void }) {
  const [name, setName] = useState(debt?.name ?? '');
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? '');
  const [totalAmount, setTotalAmount] = useState(debt ? String(debt.totalAmount) : '');
  const [monthlyPayment, setMonthlyPayment] = useState(debt?.monthlyPayment ? String(debt.monthlyPayment) : '');
  const [paidBefore, setPaidBefore] = useState(String(debt?.paidBefore ?? 0));

  async function save() {
    if (!name.trim()) return;
    const p = {
      name: name.trim(), counterparty: counterparty.trim() || undefined,
      totalAmount: parseFloat(totalAmount) || 0, monthlyPayment: parseFloat(monthlyPayment) || undefined,
      paidBefore: parseFloat(paidBefore) || 0, accountId: debt?.accountId,
    };
    let id = debt?.id;
    if (debt) await db.debts.update(debt.id, p);
    else { id = uid(); await db.debts.add({ id, ...p }); }
    // авто-распределение остатка по месяцам, начиная с текущего
    if (id) await regenerateDebtSchedule(id);
    onClose();
  }
  async function remove() {
    if (debt && confirm('Удалить долг? График погашения тоже удалится.')) {
      const plans = await db.plannedPayments.filter((pp) => pp.debtId === debt.id).toArray();
      for (const pp of plans) await db.plannedPayments.delete(pp.id);
      await db.debts.delete(debt.id);
      onClose();
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{debt ? 'Долг' : 'Новый долг'}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
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
