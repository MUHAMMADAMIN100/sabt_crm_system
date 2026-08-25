// Расход: обзор статей /finance/expense — порт fin-webrand/src/pages/Expense.tsx (ТЗ 4.1).
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, EXPENSE_GROUPS, OTHER_GROUP, useYmParam, withYm, shiftYm, monthLabel } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import BreakdownHover from './BreakdownHover';
import MonthNav from './MonthNav';
import { FinLoading, FinLoadError } from './FinKit';
import './finance.css';

export default function FinanceExpensePage() {
  const [ym, setYm] = useYmParam();
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expenseSummary', ym],
    queryFn: () => financeApi.expenseSummary(ym),
  });

  // Зарплату платим 10-го числа за ПРОШЛЫЙ месяц. Поэтому в «Расход/M» карточка
  // ЗП показывает payroll месяца M−1 — то же число и логику, что в календаре.
  const salaryYm = shiftYm(ym, -1);
  const salaryQ = useQuery({
    queryKey: ['finance', 'expenseDetail', 'salary', salaryYm],
    queryFn: () => financeApi.expenseDetail('salary', salaryYm),
  });
  const salCards: any = salaryQ.data?.cards || {};
  const salAdvances = Number(salCards.advances || 0);
  const salPaid = Number(salCards.paid || 0);
  const salToPay = Number(salCards.toPay || 0);
  const salDone = salToPay <= 0.005;
  // Не выплачено → остаток к выплате; выплачено → сумма, ушедшая ~10-го (без авансов).
  const salaryValue = salDone ? Math.max(0, Math.round((salPaid - salAdvances) * 100) / 100) : salToPay;
  const salRows: any[] = salaryQ.data?.rows || [];
  const salCount = salRows.length;
  const salPaidCount = salRows.filter((r) => Number(r.toPay || 0) <= 0.005).length;

  const groupValue = (key: string): number => {
    if (key === 'salary') return salaryValue;
    if (!data) return 0;
    // Остаток к оплате за месяц — уменьшается с каждой оплатой, как у ЗП.
    if (key === 'rent_subs') return data.subscriptions?.toPay ?? data.subscriptions?.monthly ?? 0;
    // Месячное обязательство по долгам: Σ min(платёж/мес, остаток) — как в эталоне.
    if (key === 'debts') return data.debts?.monthly ?? 0;
    return 0;
  };

  const subtitle = (key: string): string => {
    if (key === 'salary') return `${salCount} сотрудников · за ${monthLabel(salaryYm)}`;
    if (key === 'rent_subs') return `${data?.subscriptions?.count ?? 0} позиций`;
    const remaining = data?.debts?.remaining ?? 0;
    return remaining > 0 ? `остаток ${money(remaining)}` : 'нет долгов';
  };

  /** Прогресс оплат месяца для подсветки карточки: {paid, total} или null. */
  const paidProgress = (key: string): { paid: number; total: number } | null => {
    if (key === 'salary') return { paid: salPaidCount, total: salCount };
    if (key === 'rent_subs') return { paid: data?.subscriptions?.paidCount ?? 0, total: data?.subscriptions?.count ?? 0 };
    return null;
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

      {isLoading || salaryQ.isLoading ? <FinLoading cards={4} /> : isError ? <FinLoadError onRetry={() => refetch()} /> : (
      <div className="cards grid-4">
        {EXPENSE_GROUPS.map((g) => {
          const pp = paidProgress(g.key);
          const allPaid = !!pp && pp.total > 0 && pp.paid >= pp.total;
          // Зарплата открывается за месяц НАЧИСЛЕНИЯ (тот, что платим в этом месяце).
          const cardYm = g.key === 'salary' ? salaryYm : ym;
          const href = withYm(`/finance/expense/${g.key}`, cardYm);
          return (
            <BreakdownHover className="card clickable" key={g.key} ym={cardYm} kind="group" id={g.key} title={g.label} color={g.color} icon={g.icon} onClick={() => navigate(href)}>
              <div className="summary-head"><span className="t" style={{ color: g.color }}><CatIcon icon={g.icon} color={g.color} size={30} /> {g.label}</span></div>
              <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(groupValue(g.key))}</div>
              <div className="mini muted" style={{ marginTop: 6 }}>{subtitle(g.key)}</div>
              {pp && pp.total > 0 && (
                <div style={{ marginTop: 8 }}>
                  {allPaid
                    ? <span className="badge ok"><FinIcon name="check" size={12} /> {g.key === 'salary' ? 'всё выплачено' : 'всё оплачено'}</span>
                    : <span className="mini muted">{g.key === 'salary' ? 'выплачено' : 'оплачено'} {pp.paid} из {pp.total}</span>}
                </div>
              )}
              <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
            </BreakdownHover>
          );
        })}
        <BreakdownHover className="card clickable" ym={ym} kind="group" id="other" title={OTHER_GROUP.label} color={OTHER_GROUP.color} icon={OTHER_GROUP.icon} onClick={() => navigate(withYm('/finance/expense/other', ym))}>
          <div className="summary-head"><span className="t" style={{ color: OTHER_GROUP.color }}><CatIcon icon={OTHER_GROUP.icon} color={OTHER_GROUP.color} size={30} /> {OTHER_GROUP.label}</span></div>
          <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(data?.other?.spent ?? 0)}</div>
          <div className="mini muted" style={{ marginTop: 6 }}>реклама, транспорт, налоги…</div>
          <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
        </BreakdownHover>
      </div>
      )}
    </div>
  );
}
