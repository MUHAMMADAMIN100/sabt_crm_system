// Расход: обзор статей /finance/expense — порт fin-webrand/src/pages/Expense.tsx (ТЗ 4.1).
// 01.11.2026 (решения владельца): «Долги» и «Рассрочки» считаются по месяцу,
// как ЗП и аренда; кнопки «1 год / 6 месяцев / 3 месяца» — расход по месяцам
// вперёд от текущего (вариант Б: карточки + таблица статья × месяц). Назад к
// одному месяцу — нажать текущий месяц справа.
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { money, moneyBare, EXPENSE_GROUPS, OTHER_GROUP, BANK_GROUP, useYmParam, withYm, shiftYm, monthLabel, pluralRu, currentYm } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import BreakdownHover from './BreakdownHover';
import MonthNav from './MonthNav';
import { FinLoading, FinLoadError } from './FinKit';
import { INSTALLMENT_COLOR } from './InstallmentsSection';
import ExpenseLineChart, { SERIES as CHART_SERIES } from './ExpenseLineChart';
import './finance.css';

const PERIODS = [{ n: 12, label: '1 год' }, { n: 6, label: '6 месяцев' }, { n: 3, label: '3 месяца' }];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const prepOf = (ym: string) => MONTHS_PREP[Number(ym.slice(5, 7)) - 1] ?? 'этом месяце';
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dayOf = (iso: string, month: 'long' | 'short' = 'long') =>
  new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month });

export default function FinanceExpensePage() {
  const [ym, setYm] = useYmParam();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pRaw = Number(params.get('p'));
  const period = [3, 6, 12].includes(pRaw) ? pRaw : 0;
  // Период всегда от текущего месяца вперёд; выход — снова текущий месяц.
  const setPeriod = (n: number) => setParams((prev) => {
    const p = new URLSearchParams(prev);
    if (n) p.set('p', String(n)); else p.delete('p');
    p.set('ym', currentYm());
    return p;
  }, { replace: true });

  const start = currentYm();
  const end = shiftYm(start, Math.max(0, period - 1));

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="expense" size={22} /> Расход</h1>
          <p>{period
            ? `${cap(monthLabel(start, true))} — ${monthLabel(end, true)} · ${period === 12 ? 'год' : pluralRu(period, 'месяц', 'месяца', 'месяцев')} вперёд`
            : 'Нажмите карточку, чтобы открыть детали'}</p>
        </div>
        <div className="fin-exp-ctrl">
          <div className="fin-segments" role="group" aria-label="Расход на месяцы вперёд">
            {PERIODS.map((x) => (
              <button key={x.n} type="button" className={period === x.n ? 'active' : ''} aria-pressed={period === x.n} onClick={() => setPeriod(x.n)}>{x.label}</button>
            ))}
          </div>
          {period ? (
            <button type="button" className="fin-exp-month" onClick={() => setPeriod(0)} title="Вернуться к одному месяцу">
              {cap(monthLabel(start, true))}
            </button>
          ) : <MonthNav ym={ym} onChange={setYm} />}
        </div>
      </div>
      {period ? <PeriodView months={period} onOpen={(path, cardYm) => navigate(withYm(path, cardYm))} /> : <MonthView ym={ym} />}
    </div>
  );
}

// ─── Один месяц ───────────────────────────────────────────

function MonthView({ ym }: { ym: string }) {
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

  if (isLoading || salaryQ.isLoading) return <FinLoading cards={5} />;
  if (isError) return <FinLoadError onRetry={() => refetch()} />;

  const salary = EXPENSE_GROUPS.find((g) => g.key === 'salary')!;
  const rent = EXPENSE_GROUPS.find((g) => g.key === 'rent_subs')!;
  const debts = EXPENSE_GROUPS.find((g) => g.key === 'debts')!;
  const subs = data?.subscriptions ?? {};

  const head = (g: { icon: string; color: string; label: string }) => (
    <div className="summary-head"><span className="t" style={{ color: g.color }}><CatIcon icon={g.icon} color={g.color} size={30} /> {g.label}</span></div>
  );
  const progress = (paid: number, total: number, word: string, all: string) => (
    total > 0 ? (
      <div style={{ marginTop: 8 }}>
        {paid >= total
          ? <span className="badge ok"><FinIcon name="check" size={12} /> {all}</span>
          : <span className="mini muted">{word} {paid} из {total}</span>}
      </div>
    ) : null
  );

  return (
    <>
    <div className="cards grid-5">
      <BreakdownHover className="card clickable" ym={salaryYm} kind="group" id="salary" title={salary.label} color={salary.color} icon={salary.icon}
        onClick={() => navigate(withYm('/finance/expense/salary', salaryYm))}>
        {head(salary)}
        <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(salaryValue)}</div>
        <div className="mini muted" style={{ marginTop: 6 }}>{salCount} сотрудников · за {monthLabel(salaryYm)}</div>
        {progress(salPaidCount, salCount, 'выплачено', 'всё выплачено')}
        <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
      </BreakdownHover>

      <BreakdownHover className="card clickable" ym={ym} kind="group" id="rent_subs" title={rent.label} color={rent.color} icon={rent.icon}
        onClick={() => navigate(withYm('/finance/expense/rent_subs', ym))}>
        {head(rent)}
        {/* Остаток к оплате за месяц — уменьшается с каждой оплатой, как у ЗП. */}
        <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(subs.toPay ?? subs.monthly ?? 0)}</div>
        <div className="mini muted" style={{ marginTop: 6 }}>{subs.count ?? 0} позиций</div>
        {progress(subs.paidCount ?? 0, subs.count ?? 0, 'оплачено', 'всё оплачено')}
        <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
      </BreakdownHover>

      <BreakdownHover className="card clickable" ym={ym} kind="group" id="debts" title={debts.label} color={debts.color} icon={debts.icon}
        onClick={() => navigate(withYm('/finance/expense/debts', ym))}>
        {head(debts)}
        <DebtsMonth ym={ym} d={data?.debts} />
        <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
      </BreakdownHover>

      <InstallmentsCard ym={ym} banks={data?.installments?.banks} onOpen={() => navigate('/finance/expense/installments')} />

      <BreakdownHover className="card clickable" ym={ym} kind="group" id="other" title={OTHER_GROUP.label} color={OTHER_GROUP.color} icon={OTHER_GROUP.icon}
        onClick={() => navigate(withYm('/finance/expense/other', ym))}>
        {head(OTHER_GROUP)}
        <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(data?.other?.spent ?? 0)}</div>
        <div className="mini muted" style={{ marginTop: 6 }}>реклама, транспорт, налоги…</div>
        <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
      </BreakdownHover>
    </div>
    <ExpenseLineChart ym={ym} period={0} />
    </>
  );
}

/** «Долги» за месяц: сколько отдать в нём (транши и сроки «вернуть до»),
 *  сколько уже отдали; весь долг — мелкой строкой. */
function DebtsMonth({ ym, d }: { ym: string; d?: any }) {
  const toPay = Number(d?.toPay ?? d?.dueMonth) || 0;
  const paid = Number(d?.spent) || 0;
  const overdue = Number(d?.overdue) || 0;
  const items: any[] = d?.dueItems ?? [];
  const remaining = Number(d?.remaining) || 0;
  return (
    <>
      <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(toPay)}</div>
      <div className="mini muted" style={{ marginTop: 6 }}>
        {toPay > 0
          ? `отдать в ${prepOf(ym)} · ${pluralRu(Number(d?.dueCount) || 1, 'долг', 'долга', 'долгов')}`
          : paid > 0 ? `в ${prepOf(ym)} всё отдали` : `в ${prepOf(ym)} отдавать нечего`}
      </div>
      {toPay > 0 && paid > 0 && <div className="mini muted" style={{ marginTop: 4 }}>отдали {money(paid)} из {money(paid + toPay)}</div>}
      {toPay <= 0 && paid > 0 && <div style={{ marginTop: 8 }}><span className="badge ok"><FinIcon name="check" size={12} /> отдали {money(paid)}</span></div>}
      {overdue > 0 && <div className="mini" style={{ marginTop: 4, color: 'var(--red)' }}>не отдано с прошлых месяцев {money(overdue)}</div>}
      {items.length > 0 && (
        <div className="mini muted" style={{ marginTop: 4 }}>
          {items.slice(0, 2).map((x) => `${x.name} — ${moneyBare(x.amount)}, ${dayOf(x.date, 'short')}`).join(' · ')}
          {items.length > 2 ? ` · ещё ${items.length - 2}` : ''}
        </div>
      )}
      {remaining > 0 && <div className="fin-exp-all">всего должны <b>{money(remaining)}</b></div>}
    </>
  );
}

/** «Рассрочки» за месяц: платежи банкам этого месяца, оплачено N из M,
 *  ближайший платёж; сколько всего осталось банкам — мелкой строкой. */
function InstallmentsCard({ ym, banks, onOpen }: { ym: string; banks?: any; onOpen: () => void }) {
  const mo = banks?.month ?? { toPay: 0, overdue: 0, count: 0, paid: 0, paidCount: 0 };
  const all = (Number(mo.count) || 0) + (Number(mo.paidCount) || 0);
  const paidCount = Number(mo.paidCount) || 0;
  const remaining = Number(banks?.remaining) || 0;
  const next = banks?.next;
  return (
    <button type="button" className="card clickable fin-inst-card-btn" onClick={onOpen}>
      <div className="summary-head"><span className="t" style={{ color: INSTALLMENT_COLOR }}><CatIcon icon="installment" color={INSTALLMENT_COLOR} size={30} /> Рассрочки</span></div>
      <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(mo.toPay)}</div>
      <div className="mini muted" style={{ marginTop: 6 }}>
        {all > 0 ? `банкам в ${prepOf(ym)} · ${pluralRu(all, 'платёж', 'платежа', 'платежей')}` : `в ${prepOf(ym)} платежей банкам нет`}
      </div>
      {all > 0 && <div className="progress" style={{ marginTop: 8 }}><i style={{ width: `${Math.round((paidCount / all) * 100)}%`, background: 'var(--red)' }} /></div>}
      {all > 0 && (
        <div style={{ marginTop: 8 }}>
          {paidCount >= all
            ? <span className="badge ok"><FinIcon name="check" size={12} /> всё оплачено</span>
            : <span className="mini muted">оплачено {paidCount} из {all}</span>}
        </div>
      )}
      {Number(mo.overdue) > 0 && <div className="mini" style={{ marginTop: 6, color: 'var(--red)' }}>не оплачено с прошлых месяцев {money(mo.overdue)}</div>}
      {next && (
        <div className="mini" style={{ marginTop: 6, color: next.overdue ? 'var(--red)' : 'var(--muted)' }}>
          {next.overdue ? 'не оплачено' : 'ближайший'} · {dayOf(next.date)}, {money(next.amount)}{next.bank ? ` · ${next.bank}` : ''}
        </div>
      )}
      {remaining > 0 && <div className="fin-exp-all">всего банкам <b>{money(remaining)}</b></div>}
      <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
    </button>
  );
}

// ─── Период вперёд (вариант Б) ────────────────────────────

type PlanRow = { ym: string; salary: number; rent: number; debts: number; installments: number; other: number; otherSource: 'plan' | 'avg'; total: number };

function PeriodView({ months, onOpen }: { months: number; onOpen: (path: string, ym: string) => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'expensePlan', months],
    queryFn: () => financeApi.expensePlan(months),
  });
  if (isLoading) return <FinLoading cards={5} />;
  if (isError || !data) return <FinLoadError onRetry={() => refetch()} />;

  const rows: PlanRow[] = data.rows ?? [];
  const t = data.totals ?? {};
  const n = Math.max(1, rows.length);
  const start: string = data.start;
  const other = data.other ?? {};
  const perMonth = (x: number) => `≈ ${money(Math.round((Number(x) || 0) / n))} в месяц`;
  const maxDebt = rows.reduce<PlanRow | null>((best, r) => (r.debts > (best?.debts ?? 0) ? r : best), null);
  const salary = EXPENSE_GROUPS.find((g) => g.key === 'salary')!;
  const rent = EXPENSE_GROUPS.find((g) => g.key === 'rent_subs')!;
  const debts = EXPENSE_GROUPS.find((g) => g.key === 'debts')!;
  const avgRange = other.avgFrom && other.avgTo
    ? (other.avgFrom === other.avgTo ? monthLabel(other.avgFrom, true) : `${monthLabel(other.avgFrom, true)} — ${monthLabel(other.avgTo, true)}`)
    : null;

  const cards: Array<{ g: { key: string; label: string; icon: string; color: string }; value: number; lines: string[]; path: string; ym: string }> = [
    { g: salary, value: t.salary, lines: [perMonth(t.salary), 'по текущим окладам'], path: '/finance/expense/salary', ym: shiftYm(start, -1) },
    { g: rent, value: t.rent, lines: [perMonth(t.rent), `${data.subsCount ?? 0} позиций`], path: '/finance/expense/rent_subs', ym: start },
    {
      g: debts, value: t.debts, path: '/finance/expense/debts', ym: start,
      lines: [perMonth(t.debts), maxDebt && maxDebt.debts > 0 ? `больше всего — ${monthLabel(maxDebt.ym, true)}, ${moneyBare(maxDebt.debts)}` : 'отдавать нечего'],
    },
    {
      g: { ...BANK_GROUP, label: 'Рассрочки' }, value: t.installments, path: '/finance/expense/installments', ym: start,
      lines: [perMonth(t.installments), t.installmentsCount > 0 ? `${pluralRu(t.installmentsCount, 'платёж', 'платежа', 'платежей')} банкам` : 'платежей банкам нет'],
    },
    {
      g: OTHER_GROUP, value: t.other, path: '/finance/expense/other', ym: start,
      lines: [perMonth(t.other), other.ownMonths > 0 ? `ваш план — ${other.ownMonths} мес., остальное — среднее` : `оценка по среднему ${money(other.avg ?? 0)}`],
    },
  ];
  // Точки статей — цветами линий графика под таблицей (одни и те же ряды).
  const tableRows: Array<{ key: keyof PlanRow; label: string; color: string; total: number }> = CHART_SERIES
    .map((sr) => ({ key: sr.key as keyof PlanRow, label: sr.label, color: sr.color, total: Number(t[sr.key]) || 0 }));

  return (
    <>
      <div className="cards grid-5">
        {cards.map((c) => (
          <button key={c.g.key} type="button" className="card clickable fin-inst-card-btn" onClick={() => onOpen(c.path, c.ym)}>
            <div className="summary-head"><span className="t" style={{ color: c.g.color }}><CatIcon icon={c.g.icon} color={c.g.color} size={30} /> {c.g.label}</span></div>
            <div className="value" style={{ fontSize: 24, fontWeight: 700 }}>{money(c.value)}</div>
            {c.lines.map((l) => <div key={l} className="mini muted" style={{ marginTop: 6 }}>{l}</div>)}
            <div className="mini muted" style={{ marginTop: 12 }}>Открыть →</div>
          </button>
        ))}
      </div>

      <div className="table-wrap fin-exp-plan">
        <table>
          <thead>
            <tr>
              <th>Статья</th>
              {rows.map((r) => <th key={r.ym} className="num">{monthLabel(r.ym)}</th>)}
              <th className="num sum">За {months === 12 ? 'год' : pluralRu(months, 'месяц', 'месяца', 'месяцев')}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((tr) => (
              <tr key={tr.key}>
                <td><span className="cat"><i style={{ background: tr.color }} />{tr.label}</span></td>
                {rows.map((r) => {
                  const est = tr.key === 'other' && r.otherSource === 'avg';
                  return (
                    <td key={r.ym} className={`num${est ? ' est' : ''}`} title={est ? 'среднее — своей цифры на месяц нет' : undefined}>
                      {est && Number(r[tr.key]) > 0 ? '≈ ' : ''}{moneyBare(Number(r[tr.key]) || 0)}
                    </td>
                  );
                })}
                <td className="num sum">{moneyBare(tr.total || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              {rows.map((r) => <td key={r.ym} className="num">{moneyBare(r.total)}</td>)}
              <td className="num sum">{money(t.total || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mini muted fin-table-note">
        Текущий месяц — только то, что ещё не оплачено. Зарплата — выплата в месяце за предыдущий месяц, по текущим окладам.
        {' '}«Прочее» — ваш план на месяц (страница «Прочее»), где его нет — среднее {money(other.avg ?? 0)}
        {avgRange ? ` за ${avgRange}` : ''} (≈ серым).
      </p>
      <ExpenseLineChart ym={start} period={months} />
    </>
  );
}
