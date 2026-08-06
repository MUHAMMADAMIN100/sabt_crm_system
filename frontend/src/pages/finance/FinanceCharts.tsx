import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { currentYm, money, monthLabel } from './finlib';

export interface OverviewChartPoint {
  ym: string;
  income: number;
  expense: number;
  profit: number;
}

export interface PlanningChartPoint {
  ym: string;
  income: number;
  expense: number;
  net: number;
  closingBalance: number;
  actualIncome: number;
  plannedIncome: number;
  actualExpense: number;
  plannedExpense: number;
  warning?: boolean;
  [key: string]: unknown;
}

export interface PlanningChartRow extends PlanningChartPoint {
  actualExpenseChart: number;
  plannedExpenseChart: number;
}

export function formatChartMoney(value: number): string {
  const numeric = Number(value) || 0;
  const absolute = Math.abs(numeric);
  const sign = numeric < 0 ? '−' : '';
  const format = (scaled: number) => new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: scaled < 10 ? 1 : 0,
  }).format(scaled);
  if (absolute >= 1_000_000) return `${sign}${format(absolute / 1_000_000)} млн`;
  if (absolute >= 1_000) return `${sign}${format(absolute / 1_000)} тыс.`;
  return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(absolute)}`;
}

export function buildPlanningChartRows(rows: PlanningChartPoint[]): PlanningChartRow[] {
  return rows.map((row) => ({
    ...row,
    actualExpenseChart: -Math.abs(Number(row.actualExpense) || 0),
    plannedExpenseChart: -Math.abs(Number(row.plannedExpense) || 0),
  }));
}

export function flowBarPercent(value: number, income: number, expense: number): number {
  const maximum = Math.max(Math.abs(Number(income) || 0), Math.abs(Number(expense) || 0));
  if (maximum === 0 || Number(value) === 0) return 0;
  return Math.max(3, Math.min(100, Math.round((Math.abs(Number(value)) / maximum) * 100)));
}

function LegendMark({ kind, tone }: { kind: 'bar' | 'line' | 'plan'; tone: string }) {
  return <span className={`fin-chart-legend-mark ${kind} ${tone}`} aria-hidden="true" />;
}

function ChartLegend({ children, label }: { children: ReactNode; label: string }) {
  return <div className="fin-chart-legend" aria-label={label}>{children}</div>;
}

export function MonthlyFlowComparison({ income, expense, profit, amortization = 0 }: {
  income: number;
  expense: number;
  profit: number;
  amortization?: number;
}) {
  const hasFlow = income !== 0 || expense !== 0;
  const expenseRatio = income > 0 ? Math.round((expense / income) * 100) : null;
  const afterAmortization = profit - amortization;
  const explanation = !hasFlow
    ? 'За месяц пока нет проведённых операций'
    : income <= 0
      ? 'Расходы проведены без дохода'
      : expense > income
        ? `Расход выше дохода на ${money(expense - income)}`
        : `Расходы составляют ${expenseRatio}% от дохода`;

  return (
    <section className="card fin-flow-comparison" aria-label="Сравнение дохода и расхода за месяц">
      <div className="fin-flow-comparison-head">
        <div><strong>Результат месяца</strong><span>{explanation}</span></div>
        <div className={`fin-flow-result ${profit < 0 ? 'neg' : profit > 0 ? 'pos' : ''}`}>
          <small>{!hasFlow ? 'Без результата' : profit < 0 ? 'Убыток' : profit > 0 ? 'Прибыль' : 'Результат'}</small>
          <b>{money(profit, true)}</b>
        </div>
      </div>

      <div className="fin-flow-bars">
        <div className="fin-flow-bar-row">
          <div className="fin-flow-bar-label"><span><i className="income" />Доход</span><b>{money(income)}</b></div>
          <div className="fin-flow-track" role="meter" aria-label="Доход" aria-valuemin={0}
            aria-valuemax={Math.max(0, income, expense, 1)} aria-valuenow={Math.max(0, income)} aria-valuetext={money(income)}>
            <i className="income" style={{ width: `${flowBarPercent(income, income, expense)}%` }} />
          </div>
        </div>
        <div className="fin-flow-bar-row">
          <div className="fin-flow-bar-label"><span><i className="expense" />Расход</span><b>{money(expense)}</b></div>
          <div className="fin-flow-track" role="meter" aria-label="Расход" aria-valuemin={0}
            aria-valuemax={Math.max(0, income, expense, 1)} aria-valuenow={Math.max(0, expense)} aria-valuetext={money(expense)}>
            <i className="expense" style={{ width: `${flowBarPercent(expense, income, expense)}%` }} />
          </div>
        </div>
      </div>

      {amortization > 0 && (
        <div className="fin-flow-after">
          <span>После амортизации <small>{money(amortization)}</small></span>
          <b className={afterAmortization < 0 ? 'neg' : 'pos'}>{money(afterAmortization, true)}</b>
        </div>
      )}
    </section>
  );
}

const overviewSeries = [
  { key: 'profit', label: 'Результат', kind: 'line' as const, tone: 'balance' },
  { key: 'income', label: 'Доход', kind: 'bar' as const, tone: 'income' },
  { key: 'expense', label: 'Расход', kind: 'bar' as const, tone: 'expense' },
];

export function OverviewCashFlowChart({ rows, selectedYm }: { rows: OverviewChartPoint[]; selectedYm: string }) {
  const titleId = useId();
  const chartId = useId().replace(/:/g, '');
  const [visible, setVisible] = useState<Record<string, boolean>>({ profit: true, income: true, expense: true });
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    income: sum.income + Number(row.income || 0),
    expense: sum.expense + Number(row.expense || 0),
    profit: sum.profit + Number(row.profit || 0),
  }), { income: 0, expense: 0, profit: 0 }), [rows]);
  const hasNegativeResult = rows.some((row) => Number(row.profit) < 0);
  const hasValues = rows.some((row) => row.income !== 0 || row.expense !== 0 || row.profit !== 0);
  const selectedExists = rows.some((row) => row.ym === selectedYm);

  return (
    <figure className="card fin-cash-chart" aria-labelledby={titleId}>
      <figcaption className="fin-cash-chart-head">
        <div>
          <strong id={titleId}>Денежный поток за 12 месяцев</strong>
          <span>Столбцы — движение денег, линия — чистый результат</span>
        </div>
        <ChartLegend label="Показать или скрыть серии графика">
          {overviewSeries.map((series) => (
            <button type="button" key={series.key} aria-pressed={visible[series.key]}
              className={!visible[series.key] ? 'muted-series' : ''}
              onClick={() => setVisible((state) => ({ ...state, [series.key]: !state[series.key] }))}>
              <LegendMark kind={series.kind} tone={series.tone} />{series.label}
            </button>
          ))}
        </ChartLegend>
      </figcaption>

      <div className="fin-chart-summary" aria-label="Итоги за двенадцать месяцев">
        <span><small>Доход</small><b>{money(totals.income)}</b></span>
        <span><small>Расход</small><b>{money(totals.expense)}</b></span>
        <span><small>Результат</small><b className={totals.profit < 0 ? 'neg' : 'pos'}>{money(totals.profit, true)}</b></span>
      </div>
      <div className="fin-chart-unit">суммы в сомони</div>

      {!hasValues ? (
        <div className="fin-chart-empty">Нет операций за последние 12 месяцев</div>
      ) : (
        <div className="fin-overview-chart-canvas" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
            <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 2, left: 0 }} barGap={3} barCategoryGap="34%">
              <defs>
                <linearGradient id={`${chartId}ResultStroke`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--chart-gradient-start)" />
                  <stop offset="52%" stopColor="var(--chart-gradient-mid)" />
                  <stop offset="100%" stopColor="var(--chart-gradient-end)" />
                </linearGradient>
                <linearGradient id={`${chartId}ResultFill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={.14} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
                <pattern id={`${chartId}ExpensePattern`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--red)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeOpacity={.28} strokeWidth="1.5" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="2 5" />
              <XAxis dataKey="ym" tickFormatter={(value) => monthLabel(value)} axisLine={false} tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 11 }} tickMargin={9} minTickGap={22} />
              <YAxis tickFormatter={formatChartMoney} axisLine={false} tickLine={false} width={62}
                tick={{ fill: 'var(--muted)', fontSize: 11 }} tickMargin={7} />
              <Tooltip content={<OverviewChartTooltip />} cursor={{ fill: 'var(--surface-selected)', opacity: .55 }} />
              {hasNegativeResult && <ReferenceLine y={0} stroke="var(--chart-zero)" strokeWidth={1} />}
              {selectedExists && <ReferenceLine x={selectedYm} stroke="var(--accent)" strokeOpacity={.55} strokeDasharray="3 4" />}
              <Bar isAnimationActive={false} dataKey="income" name="Доход" fill="var(--green)" maxBarSize={15} radius={[5, 5, 0, 0]} hide={!visible.income} />
              <Bar isAnimationActive={false} dataKey="expense" name="Расход" fill={`url(#${chartId}ExpensePattern)`} maxBarSize={15} radius={[5, 5, 0, 0]} hide={!visible.expense} />
              <Area isAnimationActive={false} type="monotone" dataKey="profit" name="Результат" stroke={`url(#${chartId}ResultStroke)`}
                fill={`url(#${chartId}ResultFill)`} strokeWidth={2.8} dot={false}
                activeDot={{ r: 5, fill: 'var(--surface)', stroke: 'var(--accent)', strokeWidth: 3 }}
                hide={!visible.profit} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <table className="sr-only">
        <caption>Значения денежного потока по месяцам</caption>
        <thead><tr><th>Месяц</th><th>Доход</th><th>Расход</th><th>Результат</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.ym}><th>{monthLabel(row.ym, true)}</th><td>{money(row.income)}</td><td>{money(row.expense)}</td><td>{money(row.profit, true)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function OverviewChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as OverviewChartPoint | undefined;
  if (!row) return null;
  return (
    <div className="fin-data-tooltip">
      <strong>{monthLabel(String(label), true)}</strong>
      <div className="fin-data-tooltip-result"><span>Результат</span><b className={row.profit < 0 ? 'neg' : 'pos'}>{money(row.profit, true)}</b></div>
      <div><span><i className="income" />Доход</span><b>{money(row.income)}</b></div>
      <div><span><i className="expense" />Расход</span><b>{money(row.expense)}</b></div>
    </div>
  );
}

export function PlanningCashFlowChart({ rows, scenarioLabel, cashGapYm, dataTableId }: {
  rows: PlanningChartPoint[];
  scenarioLabel: string;
  cashGapYm?: string | null;
  dataTableId?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const chartId = useId().replace(/:/g, '');
  const chartRows = useMemo(() => buildPlanningChartRows(rows), [rows]);
  const today = currentYm();
  const todayExists = rows.some((row) => row.ym === today);
  const hasValues = rows.some((row) => row.income !== 0 || row.expense !== 0 || row.closingBalance !== 0);
  const minWidth = Math.max(680, chartRows.length * 74);

  return (
    <figure className="card fin-plan-chart fin-cash-chart" aria-labelledby={titleId} aria-describedby={descriptionId} aria-details={dataTableId}>
      <span id={descriptionId} className="sr-only">Подробные значения доступны в таблице сразу после диаграммы.</span>
      <figcaption className="fin-cash-chart-head planning">
        <div>
          <strong id={titleId}>Денежный поток</strong>
          <span>Поступления выше нуля, выплаты ниже; линия — остаток на конец месяца</span>
        </div>
        <span className="fin-plan-scenario">{scenarioLabel}</span>
      </figcaption>
      <ChartLegend label="Обозначения диаграммы прогноза">
        <span><LegendMark kind="bar" tone="income" />Доход · факт</span>
        <span><LegendMark kind="plan" tone="income" />Доход · план</span>
        <span><LegendMark kind="bar" tone="expense" />Расход · факт</span>
        <span><LegendMark kind="plan" tone="expense" />Расход · план</span>
        <span><LegendMark kind="line" tone="balance" />Остаток</span>
      </ChartLegend>
      <div className="fin-chart-unit">суммы в сомони · остаток по правой шкале</div>

      {!hasValues ? (
        <div className="fin-chart-empty">Нет данных для прогноза за выбранный период</div>
      ) : (
        <>
          <div className="fin-chart-scroll-hint" aria-hidden="true">Проведите по графику, чтобы увидеть весь год →</div>
          <div className="fin-plan-chart-scroll" tabIndex={0} role="region" aria-label="Прокручиваемый график прогноза на двенадцать месяцев">
            <div className="fin-plan-chart-canvas" style={{ minWidth }} aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <ComposedChart data={chartRows} margin={{ top: 18, right: 4, bottom: 2, left: 0 }} barGap={2} barCategoryGap="36%">
                  <defs>
                    <linearGradient id={`${chartId}BalanceStroke`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="var(--chart-gradient-start)" />
                      <stop offset="52%" stopColor="var(--chart-gradient-mid)" />
                      <stop offset="100%" stopColor="var(--chart-gradient-end)" />
                    </linearGradient>
                    <linearGradient id={`${chartId}BalanceFill`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={.13} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                    <pattern id={`${chartId}IncomePlanPattern`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill="var(--green-plan)" />
                      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--green)" strokeOpacity={.48} strokeWidth="2" />
                    </pattern>
                    <pattern id={`${chartId}ExpensePlanPattern`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill="var(--red-plan)" />
                      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--red)" strokeOpacity={.48} strokeWidth="2" />
                    </pattern>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="2 5" />
                  <XAxis dataKey="ym" tickFormatter={(value) => monthLabel(value)} axisLine={false} tickLine={false}
                    tick={{ fill: 'var(--muted)', fontSize: 11 }} tickMargin={9} />
                  <YAxis yAxisId="flow" tickFormatter={formatChartMoney} axisLine={false} tickLine={false} width={60}
                    tick={{ fill: 'var(--muted)', fontSize: 10.5 }} tickMargin={6} />
                  <YAxis yAxisId="balance" orientation="right" tickFormatter={formatChartMoney} axisLine={false} tickLine={false} width={62}
                    tick={{ fill: 'var(--accent)', fontSize: 10.5 }} tickMargin={6} />
                  <Tooltip content={<PlanningChartTooltip />} cursor={{ fill: 'var(--surface-selected)', opacity: .55 }} />
                  <ReferenceLine yAxisId="flow" y={0} stroke="var(--chart-zero)" strokeWidth={1.2} />
                  {todayExists && <ReferenceLine yAxisId="flow" x={today} stroke="var(--accent)" strokeOpacity={.42} strokeDasharray="3 4" />}
                  {cashGapYm && <ReferenceLine yAxisId="flow" x={cashGapYm} stroke="var(--red)" strokeOpacity={.78} strokeDasharray="3 3"
                    label={{ value: 'разрыв', position: 'insideTopRight', fill: 'var(--red)', fontSize: 10 }} />}
                  <Area isAnimationActive={false} yAxisId="balance" type="monotone" dataKey="closingBalance" name="Остаток"
                    stroke={`url(#${chartId}BalanceStroke)`} fill={`url(#${chartId}BalanceFill)`} strokeWidth={2.8} dot={false}
                    activeDot={{ r: 5, fill: 'var(--surface)', stroke: 'var(--accent)', strokeWidth: 3 }} />
                  <Bar isAnimationActive={false} yAxisId="flow" dataKey="actualIncome" stackId="income" fill="var(--green)" maxBarSize={21}>
                    {chartRows.map((row) => <Cell key={row.ym} radius={(row.plannedIncome > 0 ? 0 : [6, 6, 0, 0]) as any} />)}
                  </Bar>
                  <Bar isAnimationActive={false} yAxisId="flow" dataKey="plannedIncome" stackId="income" fill={`url(#${chartId}IncomePlanPattern)`} radius={[6, 6, 0, 0]} maxBarSize={21} />
                  <Bar isAnimationActive={false} yAxisId="flow" dataKey="actualExpenseChart" stackId="expense" fill="var(--red)" maxBarSize={21}>
                    {chartRows.map((row) => <Cell key={row.ym} radius={(row.plannedExpense > 0 ? 0 : [0, 0, 6, 6]) as any} />)}
                  </Bar>
                  <Bar isAnimationActive={false} yAxisId="flow" dataKey="plannedExpenseChart" stackId="expense" fill={`url(#${chartId}ExpensePlanPattern)`} radius={[0, 0, 6, 6]} maxBarSize={21} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

    </figure>
  );
}

function PlanningChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as PlanningChartRow | undefined;
  if (!row) return null;
  return (
    <div className="fin-data-tooltip planning">
      <strong>{monthLabel(String(label), true)}</strong>
      <div><span><i className="income" />Доход</span><b>{money(row.income)}</b><small>факт {money(row.actualIncome)} · план {money(row.plannedIncome)}</small></div>
      <div><span><i className="expense" />Расход</span><b>{money(row.expense)}</b><small>факт {money(row.actualExpense)} · план {money(row.plannedExpense)}</small></div>
      <div className="fin-data-tooltip-result"><span>Результат</span><b className={row.net < 0 ? 'neg' : 'pos'}>{money(row.net, true)}</b></div>
      <div className="fin-data-tooltip-balance"><span><i className="balance" />Остаток после плана</span><b className={row.closingBalance < 0 ? 'neg' : ''}>{money(row.closingBalance)}</b></div>
    </div>
  );
}
