// Доход: обзор трёх направлений (SMM / Development / Design). Порт fin-webrand/src/pages/Income.tsx.
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import './finance.css';
import { money, monthLabel, pluralRu, INCOME_GROUPS, useYmParam, withYm } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import BreakdownHover from './BreakdownHover';
import MonthNav from './MonthNav';
import { keepMonth, FinLoading, FinLoadError } from './FinKit';
import { IncomeLineChart } from './ExpenseLineChart';
import { financeApi } from '@/services/api.service';

export default function FinanceIncomePage() {
  const [ym, setYm] = useYmParam();
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { data: dirs, isLoading, isError, refetch, isPlaceholderData } = useQuery({
    queryKey: ['finance', 'income-directions', ym],
    queryFn: () => financeApi.incomeDirections(ym),
    ...keepMonth,
  });
  // Соседний месяц заранее — карточки и график.
  const prefetch = (m: string) => {
    qc.prefetchQuery({ queryKey: ['finance', 'income-directions', m], queryFn: () => financeApi.incomeDirections(m) });
    qc.prefetchQuery({ queryKey: ['finance', 'incomeChart', m], queryFn: () => financeApi.incomeChart(m) });
  };

  return (
    <div className={'fin-root' + (isPlaceholderData ? ' fin-stale' : '')}>
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="income" size={22} /> Доход</h1>
          <p>Четыре направления — нажмите, чтобы открыть проекты</p>
        </div>
        <MonthNav ym={ym} onChange={setYm} prefetch={prefetch} />
      </div>

      {isLoading ? <FinLoading /> : isError ? <FinLoadError onRetry={() => refetch()} /> : (
      <div className="cards grid-4">
        {INCOME_GROUPS.map((g) => {
          const d: any = (dirs || []).find((x: any) => x.direction === g.key) || {};
          const cash = d.received ?? 0;
          const projects = d.projectCount ?? 0;
          const expected = d.expected ?? 0;
          return (
            <BreakdownHover className="card clickable" key={g.key} ym={ym} kind="direction" id={g.key} title={g.label} color={g.color} icon={g.icon} onClick={() => navigate(withYm(`/finance/income/${g.key}`, ym))}>
              <div className="summary-head">
                <span className="t" style={{ color: g.color }}><CatIcon icon={g.icon} color={g.color} size={30} /> {g.label}</span>
              </div>
              <div className="value" style={{ fontSize: 26, fontWeight: 700 }}>{money(cash)}</div>
              <div className="mini muted" style={{ marginTop: 6 }}>
                {pluralRu(projects, 'проект', 'проекта', 'проектов')}{expected > 0 ? ` · ожидается ${money(expected)}` : ''}
                {(d.pausedCount ?? 0) > 0 ? <span style={{ color: 'var(--amber)' }}> · на паузе {d.pausedCount}</span> : null}
              </div>
              <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
            </BreakdownHover>
          );
        })}
      </div>
      )}

      <p className="mini muted" style={{ marginTop: 14 }}>
        {monthLabel(ym, true)} — суммы считаются по доходным операциям выбранного месяца.
      </p>

      {/* График — как на «Расходе» (13.11.2026); грузится вместе с карточками. */}
      {!isError && <IncomeLineChart ym={ym} />}
    </div>
  );
}
