import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { currentYm, formatDate, money, monthLabel } from './finlib';
import FinIcon from './FinIcon';
import { AccountLabel } from './AccountIdentity';

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
  salary: number | null;
  advance: number;
  bonus: number;
  fine: number;
  accrued: number | null;
  paidByOperations: number;
  finalPayment?: number;
  bonusPaid?: number;
  totalPaid?: number;
  remaining?: number | null;
  previousSalary?: number | null;
  salaryDelta?: number | null;
  unclassifiedPayment?: number;
  frozen: boolean;
  // Точная полученная сумма: из операций или исторического снимка.
  recordedPaid?: number | null;
  legacySource?: 'notion' | null;
  legacyCrmPaid?: number | null;
};

type MonthEvent = PayoutRow & { legacy?: boolean };

const KIND_CLASS: Record<PayoutRow['kind'], string> = {
  advance: 'adv',
  bonus: 'bon',
  salary: 'sal',
};

function EmptyHistory({ children }: { children: string }) {
  return <div className="fin-employee-history-empty">{children}</div>;
}

function SalaryChanges({ rows }: { rows: SalaryChange[] }) {
  if (!rows.length) return <EmptyHistory>Изменения ставки пока не зафиксированы</EmptyHistory>;
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
                  : initial ? 'Первая сохранённая ставка' : delta > 0 ? 'Повышение оклада' : 'Снижение оклада'}
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
              {row.isCurrent && <em>текущая</em>}
              {row.isFuture && <em className="future">запланирована</em>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function eventsForPeriod(period: PayrollPeriod, rows: PayoutRow[]) {
  const actual = rows
    .filter(row => row.salaryYm === period.ym)
    .sort((a, b) => b.date.localeCompare(a.date));
  const actualAdvance = actual
    .filter(row => row.kind === 'advance')
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const legacyAdvance = Math.max(0, Number(period.advance) - actualAdvance);
  const events: MonthEvent[] = [...actual];

  // В старой ведомости могла сохраниться только сумма аванса. Не подставляем
  // вымышленную дату или счёт, но показываем известную часть выплаты.
  if (legacyAdvance > 0.005) {
    events.push({
      id: `legacy-advance:${period.ym}`,
      kind: 'advance',
      kindLabel: 'Аванс',
      amount: legacyAdvance,
      date: '',
      salaryYm: period.ym,
      note: 'Дата и счёт старой выдачи не сохранились',
      legacy: true,
    });
  }

  return { events, legacyAdvance };
}

function MonthPaymentHistory({ periods, rows }: { periods: PayrollPeriod[]; rows: PayoutRow[] }) {
  if (!periods.length) return <EmptyHistory>Начисления пока не зафиксированы</EmptyHistory>;

  return (
    <div className="fin-month-payment-history">
      {periods.map((period) => {
        if (period.legacySource === 'notion') {
          const crmEvents = rows
            .filter(row => row.salaryYm === period.ym)
            .sort((a, b) => b.date.localeCompare(a.date));
          return (
            <article className={`fin-payment-month legacy-notion${period.ym === currentYm() ? ' current' : ''}`} key={period.ym}>
              <div className="fin-payment-month-head">
                <div>
                  <strong>{monthLabel(period.ym, true)}</strong>
                  <small>история Notion</small>
                </div>
              </div>
              <div className="fin-legacy-payment-fact">
                <span>
                  <small>Сумма в старой таблице</small>
                  <b>{money(Number(period.recordedPaid) || 0)}</b>
                </span>
                <p>Дата, счёт и разбивка на аванс и зарплату не сохранились.</p>
              </div>
              {crmEvents.length > 0 && (
                <>
                  <p className="fin-legacy-payment-warning">
                    В CRM отдельно записано {money(Number(period.legacyCrmPaid) || 0)}.
                    Эти операции не прибавлены к архивной сумме автоматически.
                  </p>
                  <div className="fin-payment-events">
                    {crmEvents.map(row => (
                      <div className="fin-payment-event" key={row.id}>
                        <i className={`kind ${KIND_CLASS[row.kind]}`}>{row.kindLabel}</i>
                        <div>
                          <strong>{formatDate(row.date)}</strong>
                          <small>{row.accountName ? <AccountLabel name={row.accountName} compact /> : 'Счёт не указан'}</small>
                          {row.note && <em>{row.note}</em>}
                        </div>
                        <b>{money(row.amount)}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        }

        const { events, legacyAdvance } = eventsForPeriod(period, rows);
        const hasRecordedPaid = period.recordedPaid != null && Number.isFinite(Number(period.recordedPaid));
        const recordedFromHistory = period.frozen;
        const fallbackReceived = hasRecordedPaid
          ? Number(period.recordedPaid)
          : Number(period.paidByOperations) + legacyAdvance;
        const received = Number.isFinite(Number(period.totalPaid))
          ? Number(period.totalPaid)
          : fallbackReceived;
        const finalPayment = Number.isFinite(Number(period.finalPayment))
          ? Number(period.finalPayment)
          : events.filter(row => row.kind === 'salary').reduce((sum, row) => sum + Number(row.amount), 0);
        const accrued = Number(period.accrued ?? period.salary ?? 0);
        const balance = period.remaining == null ? accrued - received : Number(period.remaining);
        const settled = Math.abs(balance) < 0.005;
        const overpaid = balance < -0.005;
        const salaryDelta = period.salaryDelta == null ? null : Number(period.salaryDelta);

        return (
          <article className={`fin-payment-month${period.ym === currentYm() ? ' current' : ''}`} key={period.ym}>
            <div className="fin-payment-month-head">
              <div>
                <strong>{monthLabel(period.ym, true)}</strong>
                <small className={period.frozen ? 'frozen' : ''}>
                  {period.frozen ? 'месяц закрыт' : 'текущий расчёт'}
                </small>
              </div>
              {settled && <span className="fin-payment-settled">выплачено</span>}
            </div>

            <div className="fin-payment-month-summary">
              <span><small>Установленный оклад</small><b>{money(Number(period.salary) || 0)}</b></span>
              <span><small>Аванс</small><b>{money(Number(period.advance) || 0)}</b></span>
              <span><small>Окончательная выплата</small><b>{money(finalPayment)}</b></span>
              <span>
                <small>{recordedFromHistory || legacyAdvance > 0 ? 'Всего выплат зафиксировано' : 'Всего выплат'}</small>
                <b>{money(received)}</b>
              </span>
              <span className={overpaid ? 'overpaid' : settled ? 'settled' : 'remaining'}>
                <small>{overpaid ? 'Переплата' : balance > 0.005 ? 'Остаток к выплате' : 'Задолженности нет'}</small>
                <b>{money(Math.abs(balance))}</b>
              </span>
            </div>

            {salaryDelta != null && Math.abs(salaryDelta) >= 0.005 && (
              <p className={`fin-payment-rate-change ${salaryDelta > 0 ? 'up' : 'down'}`}>
                Оклад изменён: {money(Number(period.previousSalary) || 0)} → {money(Number(period.salary) || 0)}{' '}
                <b>{salaryDelta > 0 ? '+' : '−'}{money(Math.abs(salaryDelta))}</b>
              </p>
            )}

            {(Number(period.bonus) > 0 || Number(period.fine) > 0 || Number(period.unclassifiedPayment) > 0) && (
              <p className="fin-payment-adjustments">
                Начислено {money(accrued)}
                {Number(period.bonus) > 0 ? ` · бонус ${money(period.bonus)}` : ''}
                {Number(period.fine) > 0 ? ` · штраф ${money(period.fine)}` : ''}
                {Number(period.unclassifiedPayment) > 0 ? ` · старая выплата без разбивки ${money(period.unclassifiedPayment!)}` : ''}
              </p>
            )}

            <div className="fin-payment-events">
              {events.length ? events.map(row => (
                <div className={`fin-payment-event${row.legacy ? ' legacy' : ''}`} key={row.id}>
                  <i className={`kind ${KIND_CLASS[row.kind]}`}>{row.kindLabel}</i>
                  <div>
                    <strong>{row.date ? formatDate(row.date) : 'Старая запись'}</strong>
                    <small>{row.accountName ? <AccountLabel name={row.accountName} compact /> : (row.legacy ? 'Счёт не сохранился' : 'Счёт не указан')}</small>
                    {row.note && <em>{row.note}</em>}
                  </div>
                  <b>{money(row.amount)}</b>
                </div>
              )) : (
                <div className="fin-payment-events-empty">Операции по счетам не зафиксированы</div>
              )}
            </div>
          </article>
        );
      })}
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

  return (
    <section id={`employee-history-${employeeId}`} className="fin-employee-history"
      role="region" aria-label={`История зарплаты — ${name}`}>
      <header className="fin-employee-history-head">
        <div>
          <h3>{name}</h3>
          <p>Ставка и выплаты по месяцам</p>
        </div>
        <button className="btn ghost sm" type="button" onClick={onClose}>
          <FinIcon name="chevronLeft" size={14} /> Свернуть
        </button>
      </header>

      <div className="fin-employee-history-grid">
        <section className="fin-employee-history-card salary-rates">
          <div className="fin-employee-history-title">
            <span><FinIcon name="banknote" size={17} /> Изменения фиксированной ставки</span>
            <small>за всё время</small>
          </div>
          <SalaryChanges rows={salaryChanges} />
        </section>

        <section className="fin-employee-history-card monthly-payments">
          <div className="fin-employee-history-title">
            <span><FinIcon name="receipt" size={17} /> Выплаты по месяцам</span>
            <small>{periods.length} мес.</small>
          </div>
          <MonthPaymentHistory periods={periods} rows={rows} />
        </section>
      </div>
    </section>
  );
}
