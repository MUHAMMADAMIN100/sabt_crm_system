// Обзор (дашборд) раздела «Финансы». Порт fin-webrand/src/pages/Dashboard.tsx (Этап 1 ТЗ).
// Данные: financeApi.overview(ym) через react-query вместо Dexie-хуков эталона.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import './finance.css';
import { money, currentYm, INCOME_GROUPS, EXPENSE_GROUPS } from './finlib';
import FinIcon from './FinIcon';
import MonthNav from './MonthNav';
import TxTable from './TxTable';
import TransactionModal from './TransactionModal';
import { financeApi } from '@/services/api.service';

export default function FinanceOverviewPage() {
  const [ym, setYm] = useState(currentYm());
  const [modal, setModal] = useState<{ open: boolean; initial?: any }>({ open: false });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['finance', 'overview', ym],
    queryFn: () => financeApi.overview(ym),
  });

  const ov: any = data || {};
  const balances: any[] = ov.balances || [];
  const income: number = ov.income || 0;
  const expense: number = ov.expense || 0;
  const profit: number = ov.profit ?? income - expense;
  const incCats: any[] = ov.incomeByCategory || [];
  const expCats: any[] = ov.expenseByCategory || [];
  const txns: any[] = ov.transactions || [];
  const stats: any = ov.stats || {};

  // Доход по направлениям: план/факт из бэка (incomePlan), метаданные из INCOME_GROUPS
  const incomeRows = useMemo(() => INCOME_GROUPS.map((g) => {
    const p = (ov.incomePlan || []).find((x: any) => x.direction === g.key);
    return { ...g, plan: p?.plan || 0, fact: p?.fact || 0 };
  }), [ov.incomePlan]);
  const incomePlanTotal = incomeRows.reduce((s, r) => s + r.plan, 0);
  const incomeReceivedTotal = incomeRows.reduce((s, r) => s + r.fact, 0);

  // Расход по статьям: план/факт из бэка (expensePlan), метаданные из EXPENSE_GROUPS
  const expenseRows = useMemo(() => EXPENSE_GROUPS.map((g) => {
    const p = (ov.expensePlan || []).find((x: any) => x.group === g.key);
    return { ...g, plan: p?.plan || 0, fact: p?.fact || 0 };
  }), [ov.expensePlan]);
  const expensePlanTotal = expenseRows.reduce((s, r) => s + r.plan, 0);

  const pie = [
    { name: 'Доход', value: income, color: '#16a34a' },
    { name: 'Расход', value: expense, color: '#e11d48' },
  ].filter((p) => p.value > 0);

  const handleDelete = async (t: any) => {
    const id = typeof t === 'string' || typeof t === 'number' ? t : t?.id;
    try {
      await financeApi.removeTransaction(id);
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка');
    }
  };

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>Доход, расход и баланс за выбранный месяц</p>
        </div>
        <div className="flex">
          <MonthNav ym={ym} onChange={setYm} />
          <button className="btn primary" onClick={() => setModal({ open: true })}><FinIcon name="plus" size={16} /> Операция</button>
        </div>
      </div>

      <div className="cards grid-balances" style={{ marginBottom: 14 }}>
        {balances.map((a) => (
          <div className="card stat" key={a.accountId}>
            <div className="label"><span className="dot" style={{ background: a.color }} /> {a.name}</div>
            <div className="value">{money(a.balance)}</div>
          </div>
        ))}
      </div>

      <div className="cards grid-overview" style={{ marginBottom: 22 }}>
        <SummaryContainer
          title="Доход" icon="income" color="var(--green)" total={income}
          rows={incCats} onClick={() => navigate('/finance/income')}
        />
        <SummaryContainer
          title="Расход" icon="expense" color="var(--red)" total={expense}
          rows={expCats} onClick={() => navigate('/finance/expense')}
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
        <div className="card clickable" onClick={() => navigate('/finance/income')}>
          <div className="summary-head">
            <span className="t" style={{ color: 'var(--green)' }}><FinIcon name="income" size={18} /> Доход</span>
            <span className="total" style={{ color: 'var(--green)' }}>{money(incomePlanTotal)}</span>
          </div>
          <div className="brk-legend"><span>Направление</span><span>получено / план</span></div>
          <div className="brk">
            {incomeRows.map((r) => (
              <div className="brk-row" key={r.key}>
                <span className="name" style={{ color: r.color }}><FinIcon name={r.icon} size={16} /><span style={{ color: 'var(--text)' }}>{r.label}</span></span>
                <span className="num"><span className="muted" style={{ fontWeight: 500 }}>{money(r.fact)}</span> / {money(r.plan)}</span>
              </div>
            ))}
          </div>
          <div className="between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <span className="mini muted">Получено за месяц</span>
            <b className="pos">{money(incomeReceivedTotal)}</b>
          </div>
        </div>

        <div className="card clickable" onClick={() => navigate('/finance/expense')}>
          <div className="summary-head">
            <span className="t" style={{ color: 'var(--red)' }}><FinIcon name="expense" size={18} /> Расход</span>
            <span className="total" style={{ color: 'var(--red)' }}>{money(expensePlanTotal)}</span>
          </div>
          <div className="brk-legend"><span>Статья</span><span>потрачено / план</span></div>
          <div className="brk">
            {expenseRows.map((r) => (
              <div className="brk-row" key={r.key}>
                <span className="name" style={{ color: r.color }}><FinIcon name={r.icon} size={16} /><span style={{ color: 'var(--text)' }}>{r.label}</span></span>
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
        <div className="card stat clickable" onClick={() => navigate('/finance/income')}>
          <div className="label"><FinIcon name="income" size={15} /> Ожидается к получению</div>
          <div className="value pos">{money(stats.expectedIncome || 0)}</div>
          <div className="sub">план оплат по проектам</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/finance/expense/salary')}>
          <div className="label"><FinIcon name="salary" size={15} /> К выплате ЗП за месяц</div>
          <div className="value">{money(stats.salaryToPay || 0)}</div>
          <div className="sub">фонд {money(stats.salaryFund || 0)} − авансы − выплачено</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/finance/expense/debts')}>
          <div className="label"><FinIcon name="receipt" size={15} /> Всего должны</div>
          <div className="value neg">{money(stats.totalDebt || 0)}</div>
          <div className="sub">остаток по долгам</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/finance/expense/rent_subs')}>
          <div className="label"><FinIcon name="transactions" size={15} /> Регулярные / мес</div>
          <div className="value">{money(stats.subsMonthly || 0)}</div>
          <div className="sub">аренда + подписки</div>
        </div>
      </div>

      <div className="between" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Транзакции за месяц</div>
        <button className="btn ghost sm" onClick={() => navigate('/finance/transactions')}>Все операции →</button>
      </div>
      <TxTable txns={txns} onEdit={(t: any) => setModal({ open: true, initial: t })} onDelete={handleDelete} />

      {modal.open && <TransactionModal initial={modal.initial} onClose={() => setModal({ open: false })} />}
    </div>
  );
}

// Карточка-сводка «Доход»/«Расход»: разбивка по категориям операций месяца.
// rows приходят из overview.incomeByCategory/expenseByCategory: {categoryId,name,icon,color,total}.
function SummaryContainer({ title, icon, color, total, rows, onClick }: {
  title: string; icon: string; color: string; total: number;
  rows: any[]; onClick: () => void;
}) {
  return (
    <div className="card clickable" onClick={onClick}>
      <div className="summary-head">
        <span className="t" style={{ color }}><FinIcon name={icon} size={18} /> {title}</span>
        <span className="total" style={{ color }}>{money(total)}</span>
      </div>
      <div className="brk">
        {rows.length === 0 && <div className="mini muted" style={{ padding: '6px 0' }}>Нет операций</div>}
        {rows.map((r) => (
          <div className="brk-row" key={r.categoryId ?? 'none'}>
            <span className="name" style={{ color: r.color }}>
              {r.icon && <FinIcon name={r.icon} size={16} />}<span style={{ color: 'var(--text)' }}>{r.name ?? 'Без категории'}</span>
            </span>
            <span className="num">{money(r.total)}</span>
          </div>
        ))}
      </div>
      <div className="mini muted" style={{ marginTop: 10 }}>Открыть детали →</div>
    </div>
  );
}
