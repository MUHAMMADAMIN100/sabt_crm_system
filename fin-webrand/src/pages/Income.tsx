import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClients, usePlannedPayments } from '../state/data';
import { cashReceivedMonthByGroup, totalExpected } from '../lib/calc';
import { INCOME_GROUPS } from '../lib/constants';
import { money, currentYm, ymOf } from '../lib/format';
import MonthNav from '../components/MonthNav';
import Icon from '../components/Icon';

export default function Income() {
  const clients = useClients();
  const planned = usePlannedPayments();
  const [ym, setYm] = useState(currentYm());
  const navigate = useNavigate();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="flex"><Icon name="income" size={22} /> Доход</h1>
          <p>Три направления — нажмите, чтобы открыть проекты</p>
        </div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>

      <div className="cards grid-3">
        {INCOME_GROUPS.map((g) => {
          const cash = cashReceivedMonthByGroup(planned, clients, g.key, ym);
          const projects = clients.filter((c) => c.group === g.key && c.status !== 'lead' && c.status !== 'archived').length;
          const smmIds = new Set(clients.filter((c) => c.group === 'smm').map((c) => c.id));
          const expected = g.key === 'smm'
            ? totalExpected(planned.filter((p) => p.ym === ym && p.clientId && smmIds.has(p.clientId)))
            : 0;
          return (
            <div className="card clickable" key={g.key} onClick={() => navigate(`/income/${g.key}`)}>
              <div className="summary-head">
                <span className="t" style={{ color: g.color }}><Icon name={g.icon} size={18} /> {g.label}</span>
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

      <p className="mini muted" style={{ marginTop: 14 }}>
        Месяц: {ymOf(ym + '-01')} — суммы считаются по доходным операциям выбранного месяца.
      </p>
    </>
  );
}
