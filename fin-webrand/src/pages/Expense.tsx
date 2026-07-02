import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactions, useEmployees, useSubscriptions, useDebts } from '../state/data';
import { monthTxns, debtRemaining } from '../lib/calc';
import { EXPENSE_GROUPS } from '../lib/constants';
import { money, currentYm } from '../lib/format';
import MonthNav from '../components/MonthNav';
import Icon from '../components/Icon';

export default function Expense() {
  const txns = useTransactions();
  const employees = useEmployees();
  const subs = useSubscriptions();
  const debts = useDebts();
  const [ym, setYm] = useState(currentYm());
  const navigate = useNavigate();
  const mtx = useMemo(() => monthTxns(txns, ym), [txns, ym]);

  // «Прочее» — расходы по категориям вне 3 частей (реклама, транспорт, налоги, печать, прочее, картомные)
  const otherTotal = mtx
    .filter((t) => t.type === 'expense' && !['salary', 'rent_subs', 'debts'].includes(t.group ?? ''))
    .reduce((s, t) => s + t.amount, 0);

  // Обязательства за месяц из таблиц (а не факт по журналу)
  const active = employees.filter((e) => e.status === 'active');
  const salaryFund = active.reduce((s, e) => s + e.salary, 0);
  const advances = active.reduce((s, e) => s + e.advance, 0);
  const salaryPaid = mtx.filter((t) => t.type === 'expense' && t.group === 'salary').reduce((s, t) => s + t.amount, 0);
  const salaryToPay = Math.max(0, salaryFund - advances - salaryPaid);
  const subsMonthly = subs.filter((s) => s.active).reduce((sum, x) => sum + x.amount, 0);
  const debtsMonthly = debts.reduce((s, d) => s + Math.min(d.monthlyPayment ?? 0, debtRemaining(d, txns)), 0);
  const groupValue = (key: string): number =>
    key === 'salary' ? salaryToPay : key === 'rent_subs' ? subsMonthly : key === 'debts' ? debtsMonthly : 0;

  const subtitle = (key: string): string => {
    if (key === 'salary') return `${employees.filter((e) => e.status === 'active').length} сотрудников`;
    if (key === 'rent_subs') return `${subs.filter((s) => s.active).length} позиций`;
    const remaining = debts.reduce((s, d) => s + debtRemaining(d, txns), 0);
    return remaining > 0 ? `остаток ${money(remaining)}` : 'нет долгов';
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="flex"><Icon name="expense" size={22} /> Расход</h1>
          <p>Нажмите карточку, чтобы открыть детали</p>
        </div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>

      <div className="cards grid-4">
        {EXPENSE_GROUPS.map((g) => (
          <div className="card clickable" key={g.key} onClick={() => navigate(`/expense/${g.key}`)}>
            <div className="summary-head"><span className="t" style={{ color: g.color }}><Icon name={g.icon} size={18} /> {g.label}</span></div>
            <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(groupValue(g.key))}</div>
            <div className="mini muted" style={{ marginTop: 6 }}>{subtitle(g.key)}</div>
            <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
          </div>
        ))}
        <div className="card clickable" onClick={() => navigate('/expense/other')}>
          <div className="summary-head"><span className="t" style={{ color: '#64748b' }}><Icon name="arrowRight" size={18} /> Прочее</span></div>
          <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(otherTotal)}</div>
          <div className="mini muted" style={{ marginTop: 6 }}>реклама, транспорт, налоги…</div>
          <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
        </div>
      </div>
    </>
  );
}
