import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAccounts, useTransactions, useCategories, useClients,
  usePlannedPayments, useEmployees, useDebts, useSubscriptions, deleteTransaction,
} from '../state/data';
import {
  accountBalance, monthTxns, sumByType, sumByGroup, byCategory, debtRemaining, receivedMonthByGroup,
} from '../lib/calc';
import { INCOME_GROUPS, EXPENSE_GROUPS } from '../lib/constants';
import { money, currentYm } from '../lib/format';
import MonthNav from '../components/MonthNav';
import TransactionModal from '../components/TransactionModal';
import TxTable from '../components/TxTable';
import Icon from '../components/Icon';
import type { Transaction } from '../db/types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export default function Dashboard() {
  const accounts = useAccounts();
  const txns = useTransactions();
  const categories = useCategories();
  const clients = useClients();
  const [ym, setYm] = useState(currentYm());
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<Transaction | null>(null);
  const navigate = useNavigate();

  const planned = usePlannedPayments();
  const employees = useEmployees();
  const debts = useDebts();
  const subs = useSubscriptions();

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const mtx = useMemo(() => monthTxns(txns, ym), [txns, ym]);
  const income = sumByType(mtx, 'income');
  const expense = sumByType(mtx, 'expense');
  const profit = income - expense;
  const incCats = useMemo(() => byCategory(mtx, 'income'), [mtx]);
  const expCats = useMemo(() => byCategory(mtx, 'expense'), [mtx]);

  // Доход по направлениям: план = возможный доход (тарифы активных клиентов), факт = операции месяца
  const incomeRows = INCOME_GROUPS.map((g) => ({
    ...g,
    plan: clients.filter((c) => c.group === g.key && c.status !== 'lead' && c.status !== 'archived').reduce((s, c) => s + c.tariff, 0),
    fact: receivedMonthByGroup(planned, clients, g.key, ym),
  }));
  const incomePlanTotal = incomeRows.reduce((s, r) => s + r.plan, 0);
  const incomeReceivedTotal = incomeRows.reduce((s, r) => s + r.fact, 0);

  // Сводка из всех таблиц
  const expectedIncome = planned.filter((p) => p.clientId && p.status === 'expected').reduce((s, p) => s + p.amount, 0);
  const activeEmp = employees.filter((e) => e.status === 'active');
  const salaryFund = activeEmp.reduce((s, e) => s + e.salary, 0);
  const advances = activeEmp.reduce((s, e) => s + e.advance, 0);
  const salaryPaid = mtx.filter((t) => t.type === 'expense' && t.group === 'salary').reduce((s, t) => s + t.amount, 0);
  const salaryToPay = Math.max(0, salaryFund - advances - salaryPaid);
  const debtsRemaining = debts.reduce((s, d) => s + debtRemaining(d, txns), 0);
  const subsMonthly = subs.filter((s) => s.active).reduce((sum, x) => sum + x.amount, 0);

  // Расход по статьям: план = обязательства месяца, факт = операции месяца
  const debtsMonthly = debts.reduce((s, d) => s + Math.min(d.monthlyPayment ?? 0, debtRemaining(d, txns)), 0);
  const expensePlan: Record<string, number> = { salary: salaryToPay, rent_subs: subsMonthly, debts: debtsMonthly };
  const expenseRows = EXPENSE_GROUPS.map((g) => ({ ...g, plan: expensePlan[g.key] ?? 0, fact: sumByGroup(mtx, g.key) }));
  const expensePlanTotal = expenseRows.reduce((s, r) => s + r.plan, 0);

  const pie = [
    { name: 'Доход', value: income, color: '#16a34a' },
    { name: 'Расход', value: expense, color: '#e11d48' },
  ].filter((p) => p.value > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>Доход, расход и баланс за выбранный месяц</p>
        </div>
        <div className="flex">
          <MonthNav ym={ym} onChange={setYm} />
          <button className="btn primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={16} /> Операция</button>
        </div>
      </div>

      <div className="cards grid-balances" style={{ marginBottom: 14 }}>
        {accounts.map((a) => (
          <div className="card stat" key={a.id}>
            <div className="label"><span className="dot" style={{ background: a.color }} /> {a.name}</div>
            <div className="value">{money(accountBalance(a, txns))}</div>
          </div>
        ))}
      </div>

      <div className="cards grid-overview" style={{ marginBottom: 22 }}>
        <SummaryContainer
          title="Доход" icon="income" color="var(--green)" total={income}
          rows={incCats} catMap={catMap} onClick={() => navigate('/income')}
        />
        <SummaryContainer
          title="Расход" icon="expense" color="var(--red)" total={expense}
          rows={expCats} catMap={catMap} onClick={() => navigate('/expense')}
        />
        <div className="card">
          <div className="summary-head"><span className="t">Overall</span></div>
          {pie.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>Нет данных</div>
          ) : (
            <div style={{ height: 150 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2}>
                    {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="between" style={{ marginTop: 6 }}>
            <span className="mini muted">Прибыль</span>
            <b className={profit >= 0 ? 'pos' : 'neg'}>{money(profit, true)}</b>
          </div>
        </div>
      </div>

      <div className="cards grid-2" style={{ marginBottom: 22 }}>
        <div className="card clickable" onClick={() => navigate('/income')}>
          <div className="summary-head">
            <span className="t" style={{ color: 'var(--green)' }}><Icon name="income" size={18} /> Доход</span>
            <span className="total" style={{ color: 'var(--green)' }}>{money(incomePlanTotal)}</span>
          </div>
          <div className="brk-legend"><span>Направление</span><span>получено / план</span></div>
          <div className="brk">
            {incomeRows.map((r) => (
              <div className="brk-row" key={r.key}>
                <span className="name" style={{ color: r.color }}><Icon name={r.icon} size={16} /><span style={{ color: 'var(--text)' }}>{r.label}</span></span>
                <span className="num"><span className="muted" style={{ fontWeight: 500 }}>{money(r.fact)}</span> / {money(r.plan)}</span>
              </div>
            ))}
          </div>
          <div className="between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <span className="mini muted">Получено за месяц</span>
            <b className="pos">{money(incomeReceivedTotal)}</b>
          </div>
        </div>

        <div className="card clickable" onClick={() => navigate('/expense')}>
          <div className="summary-head">
            <span className="t" style={{ color: 'var(--red)' }}><Icon name="expense" size={18} /> Расход</span>
            <span className="total" style={{ color: 'var(--red)' }}>{money(expensePlanTotal)}</span>
          </div>
          <div className="brk-legend"><span>Статья</span><span>потрачено / план</span></div>
          <div className="brk">
            {expenseRows.map((r) => (
              <div className="brk-row" key={r.key}>
                <span className="name" style={{ color: r.color }}><Icon name={r.icon} size={16} /><span style={{ color: 'var(--text)' }}>{r.label}</span></span>
                <span className="num"><span className="muted" style={{ fontWeight: 500 }}>{money(r.fact)}</span> / {money(r.plan)}</span>
              </div>
            ))}
          </div>
          <div className="between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <span className="mini muted">Потрачено за месяц</span>
            <b className="neg">{money(expense)}</b>
          </div>
        </div>
      </div>

      <div className="cards grid-4" style={{ marginBottom: 22 }}>
        <div className="card stat clickable" onClick={() => navigate('/income')}>
          <div className="label"><Icon name="income" size={15} /> Ожидается к получению</div>
          <div className="value pos">{money(expectedIncome)}</div>
          <div className="sub">план оплат по проектам</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/expense/salary')}>
          <div className="label"><Icon name="salary" size={15} /> К выплате ЗП за месяц</div>
          <div className="value">{money(salaryToPay)}</div>
          <div className="sub">фонд {money(salaryFund)} − авансы − выплачено</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/expense/debts')}>
          <div className="label"><Icon name="receipt" size={15} /> Всего должны</div>
          <div className="value neg">{money(debtsRemaining)}</div>
          <div className="sub">остаток по долгам</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/expense/rent_subs')}>
          <div className="label"><Icon name="transactions" size={15} /> Регулярные / мес</div>
          <div className="value">{money(subsMonthly)}</div>
          <div className="sub">аренда + подписки</div>
        </div>
      </div>

      <div className="between" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Транзакции за месяц</div>
        <button className="btn sm" onClick={() => navigate('/transactions')}>Все операции →</button>
      </div>
      <TxTable txns={mtx} onEdit={setEdit} onDelete={deleteTransaction} />

      {showAdd && <TransactionModal onClose={() => setShowAdd(false)} />}
      {edit && <TransactionModal initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SummaryContainer({ title, icon, color, total, rows, catMap, onClick }: {
  title: string; icon: string; color: string; total: number;
  rows: { categoryId: string | undefined; total: number }[];
  catMap: Map<string, { name: string; icon: string; color: string }>;
  onClick: () => void;
}) {
  return (
    <div className="card clickable" onClick={onClick}>
      <div className="summary-head">
        <span className="t" style={{ color }}><Icon name={icon} size={18} /> {title}</span>
        <span className="total" style={{ color }}>{money(total)}</span>
      </div>
      <div className="brk">
        {rows.length === 0 && <div className="mini muted" style={{ padding: '6px 0' }}>Нет операций</div>}
        {rows.map((r) => {
          const c = catMap.get(r.categoryId ?? '');
          return (
            <div className="brk-row" key={r.categoryId ?? 'none'}>
              <span className="name" style={{ color: c?.color }}>
                {c && <Icon name={c.icon} size={16} />}<span style={{ color: 'var(--text)' }}>{c?.name ?? 'Без категории'}</span>
              </span>
              <span className="num">{money(r.total)}</span>
            </div>
          );
        })}
      </div>
      <div className="mini muted" style={{ marginTop: 10 }}>Открыть детали →</div>
    </div>
  );
}
