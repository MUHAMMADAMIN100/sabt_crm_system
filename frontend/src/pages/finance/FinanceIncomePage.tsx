// Доход: обзор трёх направлений (SMM / Development / Design). Порт fin-webrand/src/pages/Income.tsx.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import './finance.css';
import { money, currentYm, monthLabel, INCOME_GROUPS } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import MonthNav from './MonthNav';
import { FinLoading, FinLoadError } from './FinKit';
import { financeApi } from '@/services/api.service';

export default function FinanceIncomePage() {
  const [ym, setYm] = useState(currentYm());
  const navigate = useNavigate();

  const { data: dirs, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'income-directions', ym],
    queryFn: () => financeApi.incomeDirections(ym),
  });

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="income" size={22} /> Доход</h1>
          <p>Три направления — нажмите, чтобы открыть проекты</p>
        </div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>

      {isLoading ? <FinLoading /> : isError ? <FinLoadError onRetry={() => refetch()} /> : (
      <div className="cards grid-3">
        {INCOME_GROUPS.map((g) => {
          const d: any = (dirs || []).find((x: any) => x.direction === g.key) || {};
          const cash = d.received ?? 0;
          const projects = d.projectCount ?? 0;
          const expected = d.expected ?? 0;
          return (
            <div className="card clickable" key={g.key} onClick={() => navigate(`/finance/income/${g.key}`)}>
              <div className="summary-head">
                <span className="t" style={{ color: g.color }}><CatIcon icon={g.icon} color={g.color} size={30} /> {g.label}</span>
              </div>
              <div className="value" style={{ fontSize: 26, fontWeight: 700 }}>{money(cash)}</div>
              <div className="mini muted" style={{ marginTop: 6 }}>
                {projects} проектов{expected > 0 ? ` · ожидается ${money(expected)}` : ''}
              </div>
              <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
            </div>
          );
        })}
      </div>
      )}

      <p className="mini muted" style={{ marginTop: 14 }}>
        {monthLabel(ym, true)} — суммы считаются по доходным операциям выбранного месяца.
      </p>
    </div>
  );
}
