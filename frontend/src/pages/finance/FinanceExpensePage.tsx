// Расход: обзор статей /finance/expense — порт fin-webrand/src/pages/Expense.tsx (ТЗ 4.1).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, currentYm, EXPENSE_GROUPS, OTHER_GROUP } from './finlib';
import FinIcon from './FinIcon';
import MonthNav from './MonthNav';
import './finance.css';

export default function FinanceExpensePage() {
  const [ym, setYm] = useState(currentYm());
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['finance', 'expenseSummary', ym],
    queryFn: () => financeApi.expenseSummary(ym),
  });

  const groupValue = (key: string): number => {
    if (!data) return 0;
    if (key === 'salary') return data.salary?.toPay ?? 0;
    if (key === 'rent_subs') return data.subscriptions?.monthly ?? 0;
    // Месячное обязательство по долгам: Σ min(платёж/мес, остаток) — как в эталоне.
    if (key === 'debts') return data.debts?.monthly ?? 0;
    return 0;
  };

  const subtitle = (key: string): string => {
    if (key === 'salary') return `${data?.salary?.count ?? 0} сотрудников`;
    if (key === 'rent_subs') return `${data?.subscriptions?.count ?? 0} позиций`;
    const remaining = data?.debts?.remaining ?? 0;
    return remaining > 0 ? `остаток ${money(remaining)}` : 'нет долгов';
  };

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="expense" size={22} /> Расход</h1>
          <p>Нажмите карточку, чтобы открыть детали</p>
        </div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>

      <div className="cards grid-4">
        {EXPENSE_GROUPS.map((g) => (
          <div className="card clickable" key={g.key} onClick={() => navigate(`/finance/expense/${g.key}`)}>
            <div className="summary-head"><span className="t" style={{ color: g.color }}><FinIcon name={g.icon} size={18} /> {g.label}</span></div>
            <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(groupValue(g.key))}</div>
            <div className="mini muted" style={{ marginTop: 6 }}>{subtitle(g.key)}</div>
            <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
          </div>
        ))}
        <div className="card clickable" onClick={() => navigate('/finance/expense/other')}>
          <div className="summary-head"><span className="t" style={{ color: OTHER_GROUP.color }}><FinIcon name={OTHER_GROUP.icon} size={18} /> {OTHER_GROUP.label}</span></div>
          <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(data?.other?.spent ?? 0)}</div>
          <div className="mini muted" style={{ marginTop: 6 }}>реклама, транспорт, налоги…</div>
          <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
        </div>
      </div>
    </div>
  );
}
