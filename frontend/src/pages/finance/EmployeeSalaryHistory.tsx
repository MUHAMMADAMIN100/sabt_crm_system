import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { formatDate, money, monthLabel } from './finlib';
import FinIcon from './FinIcon';

type SalaryChange = {
  effectiveYm: string;
  salary: number;
  previousSalary: number | null;
  delta: number | null;
  isCurrent?: boolean;
  isFuture?: boolean;
};

type PayoutRow = {
  id: string;
  kind: 'advance' | 'bonus' | 'salary';
  kindLabel: string;
  amount: number;
  date: string;
  salaryYm: string;
  accountName?: string | null;
  note?: string | null;
};

type PayrollPeriod = {
  ym: string;
  salary: number;
  advance: number;
  bonus: number;
  fine: number;
  accrued: number;
  paidByOperations: number;
  frozen: boolean;
};

const KIND_CLASS: Record<string, string> = {
  advance: 'adv',
  bonus: 'bon',
  salary: 'sal',
};

function EmptyHistory({ children }: { children: string }) {
  return <div className="fin-employee-history-empty">{children}</div>;
}

function SalaryChanges({ rows }: { rows: SalaryChange[] }) {
  if (!rows.length) return <EmptyHistory>Изменения оклада пока не зафиксированы</EmptyHistory>;
  return (
    <div className="fin-salary-rate-list">
      {rows.map((row) => {
        const delta = Number(row.delta);
        const initial = row.previousSalary == null;
        const tone = row.isFuture ? 'future' : initial ? 'initial' : delta > 0 ? 'up' : 'down';
        return (
          <div className={`fin-salary-rate ${tone}`} key={row.effectiveYm}>
            <span className="fin-salary-rate-dot" />
            <div>
              <strong>{monthLabel(row.effectiveYm, true)}</strong>
              <small>
                {row.isFuture
                  ? 'Запланированное изменение'
                  : initial ? 'Первоначальный оклад' : delta > 0 ? 'Повышение оклада' : 'Снижение оклада'}
              </small>
            </div>
            <div className="fin-salary-rate-values">
              {initial
                ? <b>{money(row.salary)}</b>
                : <><span>{money(Number(row.previousSalary))} → </span><b>{money(row.salary)}</b></>}
              {!initial && (
                <small className={delta > 0 ? 'pos' : 'neg'}>
                  {delta > 0 ? '+' : '−'}{money(Math.abs(delta))}
                </small>
              )}
              {row.isCurrent && <em>текущий</em>}
              {row.isFuture && <em className="future">запланирован</em>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type AdvanceEvent = PayoutRow & { legacy?: boolean };

function AdvanceHistory({ rows, periods }: { rows: PayoutRow[]; periods: PayrollPeriod[] }) {
  const actual = rows.filter(row => row.kind === 'advance');
  const actualByMonth = new Map<string, number>();
  for (const row of actual) {
    actualByMonth.set(row.salaryYm, (actualByMonth.get(row.salaryYm) || 0) + Number(row.amount));
  }
  // В старых закрытых ведомостях сумма аванса могла сохраниться только в
  // снимке месяца. Не выдумываем дату/счёт, но и не скрываем известную сумму.
  const legacy: AdvanceEvent[] = periods
    .map(period => ({
      period,
      missing: Math.max(0, Number(period.advance) - (actualByMonth.get(period.ym) || 0)),
    }))
    .filter(({ missing }) => missing > 0.005)
    .map(({ period, missing }) => ({
      id: `legacy-advance:${period.ym}`,
      kind: 'advance',
      kindLabel: 'Аванс',
      amount: missing,
      date: '',
      salaryYm: period.ym,
      accountName: null,
      note: 'Детали старой выдачи не сохранились',
      legacy: true,
    }));
  const events: AdvanceEvent[] = [...actual, ...legacy].sort((a, b) =>
    (b.date || `${b.salaryYm}-01`).localeCompare(a.date || `${a.salaryYm}-01`));

  if (!events.length) return <EmptyHistory>Авансы ещё не выдавались</EmptyHistory>;
  return (
    <div className="fin-advance-history">
      {events.map(row => (
        <div className={`fin-advance-event${row.legacy ? ' legacy' : ''}`} key={row.id}>
          <span className="kind adv">Аванс</span>
          <div>
            <strong>{row.date ? formatDate(row.date) : monthLabel(row.salaryYm, true)}</strong>
            <small>
              за {monthLabel(row.salaryYm, true)}
              {row.accountName ? ` · ${row.accountName}` : ''}
            </small>
            {row.note && <em>{row.note}</em>}
          </div>
          <b>{money(row.amount)}</b>
        </div>
      ))}
    </div>
  );
}

function PayrollPeriods({ rows }: { rows: PayrollPeriod[] }) {
  if (!rows.length) return <EmptyHistory>Начисления пока не зафиксированы</EmptyHistory>;
  return (
    <div className="fin-inline-payroll-periods">
      {rows.map(period => (
        <div className="fin-inline-payroll-period" key={period.ym}>
          <div className="head">
            <strong>{monthLabel(period.ym, true)}</strong>
            <span className={period.frozen ? 'frozen' : ''}>
              {period.frozen ? 'месяц закрыт' : 'расчёт'}
            </span>
          </div>
          <b>{money(period.accrued)}</b>
          <small>
            оклад {money(period.salary)}
            {Number(period.advance) > 0 ? ` · аванс ${money(period.advance)}` : ''}
            {Number(period.bonus) > 0 ? ` · бонус ${money(period.bonus)}` : ''}
            {Number(period.fine) > 0 ? ` · штраф ${money(period.fine)}` : ''}
          </small>
          <small>по счетам выплачено {money(period.paidByOperations)}</small>
        </div>
      ))}
    </div>
  );
}

function OtherPayouts({ rows }: { rows: PayoutRow[] }) {
  const otherRows = rows.filter(row => row.kind !== 'advance');
  if (!otherRows.length) return <EmptyHistory>Выплат зарплаты и бонусов пока нет</EmptyHistory>;
  return (
    <div className="fin-inline-payout-table" role="table" aria-label="Выплаты зарплаты и бонусов">
      <div className="fin-inline-payout-head" role="row">
        <span role="columnheader">Тип</span>
        <span role="columnheader">Дата</span>
        <span role="columnheader">Месяц</span>
        <span role="columnheader">Счёт / комментарий</span>
        <span role="columnheader">Сумма</span>
      </div>
      {otherRows.map(row => (
        <div className="fin-inline-payout-row" role="row" key={row.id}>
          <span role="cell"><i className={`kind ${KIND_CLASS[row.kind] || ''}`}>{row.kindLabel}</i></span>
          <span role="cell" className="nowrap">{formatDate(row.date)}</span>
          <span role="cell">{monthLabel(row.salaryYm, true)}</span>
          <span role="cell">
            <b>{row.accountName || 'Счёт не указан'}</b>
            {row.note && <small>{row.note}</small>}
          </span>
          <strong role="cell">{money(row.amount)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function EmployeeSalaryHistory({
  employeeId,
  name,
  onClose,
}: {
  employeeId: string;
  name: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['fin-payouts', employeeId, 'all'],
    queryFn: () => financeApi.employeePayouts(employeeId, 'all'),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <div id={`employee-history-${employeeId}`} className="fin-employee-history loading"
        role="region" aria-label={`История зарплаты — ${name}`}>
        <span className="fin-history-loader" />
        <span>Загружаю полную историю сотрудника…</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div id={`employee-history-${employeeId}`} className="fin-employee-history error"
        role="region" aria-label={`История зарплаты — ${name}`}>
        <span>Не удалось загрузить историю.</span>
        <button className="btn sm" type="button" onClick={() => query.refetch()}>Повторить</button>
      </div>
    );
  }

  const data = query.data ?? {};
  const rows: PayoutRow[] = data.rows ?? [];
  const periods: PayrollPeriod[] = data.periods ?? [];
  const salaryChanges: SalaryChange[] = data.salaryChanges ?? [];
  const totals = data.totals ?? {};

  return (
    <section id={`employee-history-${employeeId}`} className="fin-employee-history"
      role="region" aria-label={`История зарплаты — ${name}`}>
      <header className="fin-employee-history-head">
        <div>
          <h3>{name}</h3>
          <p>Полная история оклада, начислений и фактических выплат</p>
        </div>
        <div className="fin-employee-history-kpis">
          <span>Последняя ставка <b>{money(data.currentSalary ?? salaryChanges[0]?.salary ?? 0)}</b></span>
          <span>Выплачено по счетам <b>{money(totals.paidByOperations ?? 0)}</b></span>
          <span>Всего авансов <b>{money(totals.advance ?? 0)}</b></span>
        </div>
        <button className="btn ghost sm" type="button" onClick={onClose}>
          <FinIcon name="chevronLeft" size={14} /> Свернуть
        </button>
      </header>

      <div className="fin-employee-history-grid">
        <section className="fin-employee-history-card salary-rates">
          <div className="fin-employee-history-title">
            <span><FinIcon name="banknote" size={17} /> Изменения оклада</span>
            <small>за всё время</small>
          </div>
          <SalaryChanges rows={salaryChanges} />
        </section>
        <section className="fin-employee-history-card advances">
          <div className="fin-employee-history-title">
            <span><FinIcon name="wallet" size={17} /> История выдачи авансов</span>
            <small>{money(totals.advance ?? 0)}</small>
          </div>
          <AdvanceHistory rows={rows} periods={periods} />
        </section>
      </div>

      <section className="fin-employee-history-card">
        <div className="fin-employee-history-title">
          <span><FinIcon name="receipt" size={17} /> Начисления по месяцам</span>
          <small>{periods.length} мес.</small>
        </div>
        <PayrollPeriods rows={periods} />
      </section>

      <section className="fin-employee-history-card">
        <div className="fin-employee-history-title">
          <span><FinIcon name="transactions" size={17} /> Зарплата и бонусы по счетам</span>
          <small>{rows.filter(row => row.kind !== 'advance').length} операций</small>
        </div>
        <OtherPayouts rows={rows} />
      </section>
    </section>
  );
}
