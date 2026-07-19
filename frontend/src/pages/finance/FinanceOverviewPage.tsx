// Обзор (дашборд) раздела «Финансы». Порт fin-webrand/src/pages/Dashboard.tsx (Этап 1 ТЗ).
// Данные: financeApi.overview(ym) через react-query вместо Dexie-хуков эталона.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import './finance.css';
import { money, currentYm, monthLabel, apiErr, INCOME_GROUPS, EXPENSE_GROUPS } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import BreakdownHover from './BreakdownHover';
import MonthNav from './MonthNav';
import TxTable from './TxTable';
import TransactionModal from './TransactionModal';
import { FinLoading, FinLoadError, invalidateFinance } from './FinKit';
import { financeApi } from '@/services/api.service';

export default function FinanceOverviewPage() {
  const [ym, setYm] = useState(currentYm());
  const [modal, setModal] = useState<{ open: boolean; initial?: any }>({ open: false });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'overview', ym],
    queryFn: () => financeApi.overview(ym),
  });

  const ov: any = data || {};
  const balances: any[] = ov.balances || [];
  const income: number = ov.income || 0;
  const expense: number = ov.expense || 0;
  const profit: number = ov.profit ?? income - expense;
  const incCats: any[] = ov.incomeByCategory || [];
  const expCats: any[] = ov.expenseByCategory || [];
  const txns: any[] = ov.transactions || [];
  const stats: any = ov.stats || {};

  // Доход по направлениям: план/факт из бэка (incomePlan), метаданные из INCOME_GROUPS
  const incomeRows = useMemo(() => INCOME_GROUPS.map((g) => {
    const p = (ov.incomePlan || []).find((x: any) => x.direction === g.key);
    return { ...g, plan: p?.plan || 0, fact: p?.fact || 0 };
  }), [ov.incomePlan]);
  const incomeReceivedTotal = incomeRows.reduce((s, r) => s + r.fact, 0);

  // Расход по статьям: план/факт из бэка (expensePlan), метаданные из EXPENSE_GROUPS
  const expenseRows = useMemo(() => EXPENSE_GROUPS.map((g) => {
    const p = (ov.expensePlan || []).find((x: any) => x.group === g.key);
    return { ...g, plan: p?.plan || 0, fact: p?.fact || 0 };
  }), [ov.expensePlan]);
  const expensePlanTotal = expenseRows.reduce((s, r) => s + r.plan, 0);

  const pie = [
    { name: 'Доход', value: income, color: '#16a34a' },
    { name: 'Расход', value: expense, color: '#e11d48' },
  ].filter((p) => p.value > 0);

  const handleDelete = async (t: any) => {
    const id = typeof t === 'string' || typeof t === 'number' ? t : t?.id;
    try {
      await financeApi.removeTransaction(id);
      invalidateFinance(qc);
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  };

  if (isLoading || isError) {
    return (
      <div className="fin-root">
        <div className="page-head">
          <div><h1>Обзор</h1><p>Доход, расход и баланс за выбранный месяц</p></div>
          <MonthNav ym={ym} onChange={setYm} />
        </div>
        {isError ? <FinLoadError onRetry={() => refetch()} /> : <FinLoading />}
      </div>
    );
  }

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>Доход, расход и баланс за выбранный месяц</p>
        </div>
        <div className="flex">
          <MonthNav ym={ym} onChange={setYm} />
          <button className="btn primary" onClick={() => setModal({ open: true })}><FinIcon name="plus" size={16} /> Операция</button>
        </div>
      </div>

      <div className="cards grid-balances" style={{ marginBottom: 14 }}>
        {balances.map((a) => (
          <div className="card stat" key={a.accountId}>
            <div className="label"><span className="dot" style={{ background: a.color }} /> {a.name}</div>
            <div className="value">{money(a.balance)}</div>
          </div>
        ))}
      </div>

      <div className="cards grid-overview" style={{ marginBottom: 22 }}>
        {/* Три среза в одной карточке: текущий месяц (заголовок),
            приходящий месяц (прогноз) и за всё время — без дублей внизу. */}
        <SummaryContainer
          title="Доход за месяц" hint="все операции месяца · по категориям"
          legendRight="получено / получим за месяц"
          icon="income" color="var(--green)" total={income}
          rows={incCats} ym={ym} txType="income" onClick={() => navigate('/finance/income')}
          footerRows={[
            { label: 'Прогноз на приходящий месяц', value: `≈ ${money(stats.forecastNextMonth || 0)}` },
            { label: 'Доход за всё время', value: money(stats.incomeAllTime || 0), cls: 'pos' },
          ]}
        />
        <SummaryContainer
          title="Расход за месяц" hint="все операции месяца · по категориям"
          icon="expense" color="var(--red)" total={expense}
          rows={expCats} ym={ym} txType="expense" onClick={() => navigate('/finance/expense')}
          footerRows={[
            { label: 'Регулярные обязательства / мес', value: money((stats.salaryToPay || 0) + (stats.subsMonthly || 0)) },
            { label: 'Расход за всё время', value: money(stats.expenseAllTime || 0), cls: 'neg' },
          ]}
        />
        <div className="card">
          <div className="summary-head"><span className="t">Overall</span></div>
          {pie.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>Нет данных</div>
          ) : (
            <div style={{ height: 150 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2}>
                    {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="between" style={{ marginTop: 6 }}>
            <span className="mini muted">Прибыль</span>
            <b className={profit >= 0 ? 'pos' : 'neg'}>{money(profit, true)}</b>
          </div>
          {(stats.amortMonthly || 0) > 0 && (
            <div className="between" style={{ marginTop: 4 }} title="Линейная амортизация инвентаря за месяц">
              <span className="mini muted">С учётом амортизации ({money(stats.amortMonthly)})</span>
              <b className={profit - stats.amortMonthly >= 0 ? 'pos' : 'neg'}>{money(profit - stats.amortMonthly, true)}</b>
            </div>
          )}
        </div>
      </div>

      {/* Тренд: месяц виден в контексте года, а не изолированно. */}
      {(ov.monthlySeries?.length ?? 0) > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="summary-head" style={{ marginBottom: 6 }}>
            <span className="t"><FinIcon name="overview" size={18} /> Динамика 12 месяцев</span>
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={ov.monthlySeries} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="ym" tickFormatter={(v) => monthLabel(v)} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v) => new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format(Number(v))} />
                <Tooltip formatter={(v: any, name: any) => [money(Number(v)), name]} labelFormatter={(l) => monthLabel(String(l), true)} />
                <Legend formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
                <Line type="monotone" dataKey="income" name="Доход" stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" name="Расход" stroke="#e11d48" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" name="Прибыль" stroke="#2563eb" strokeWidth={2} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="cards grid-2" style={{ marginBottom: 22 }}>
        <div className="card clickable" onClick={() => navigate('/finance/income')}>
          <div className="summary-head">
            <span className="t" style={{ color: 'var(--green)' }}><FinIcon name="income" size={18} /> Доход по направлениям</span>
            {/* Главная цифра — фактически получено за месяц (сумма планов
                с полными тарифами Dev только запутывала). */}
            <span className="total" style={{ color: 'var(--green)' }}>{money(incomeReceivedTotal)}</span>
          </div>
          <div className="brk-legend"><span>только проекты · за месяц</span><span>получено / план</span></div>
          <div className="brk">
            {incomeRows.map((r) => (
              <BreakdownHover key={r.key} className="brk-row" ym={ym} kind="direction" id={r.key} title={r.label} color={r.color} icon={r.icon}>
                <span className="name" style={{ color: r.color }}><CatIcon icon={r.icon} color={r.color} size={22} /><span style={{ color: 'var(--text)' }}>{r.label}</span></span>
                <span className="num"><span className="muted" style={{ fontWeight: 500 }}>{money(r.fact)}</span> / {money(r.plan)}</span>
              </BreakdownHover>
            ))}
          </div>
          <div className="between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <span className="mini muted">Ожидается ещё в этом месяце</span>
            <b>{money(stats.expectedThisMonth || 0)}</b>
          </div>
        </div>

        <div className="card clickable" onClick={() => navigate('/finance/expense')}>
          <div className="summary-head">
            <span className="t" style={{ color: 'var(--red)' }}><FinIcon name="expense" size={18} /> Расход по статьям</span>
            <span className="total" style={{ color: 'var(--red)' }}>{money(expensePlanTotal)}</span>
          </div>
          <div className="brk-legend"><span>план месяца по статьям</span><span>потрачено / план</span></div>
          <div className="brk">
            {expenseRows.map((r) => (
              <BreakdownHover key={r.key} className="brk-row" ym={ym} kind="group" id={r.key} title={r.label} color={r.color} icon={r.icon}>
                <span className="name" style={{ color: r.color }}><CatIcon icon={r.icon} color={r.color} size={22} /><span style={{ color: 'var(--text)' }}>{r.label}</span></span>
                <span className="num"><span className="muted" style={{ fontWeight: 500 }}>{money(r.fact)}</span> / {money(r.plan)}</span>
              </BreakdownHover>
            ))}
          </div>
          {/* «Потрачено за месяц» дублировало заголовок верхней карточки —
              вместо него остаток по плану статей. */}
          <div className="between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <span className="mini muted">Осталось оплатить по плану</span>
            <b>{money(expenseRows.reduce((s, r) => s + Math.max(0, r.plan - r.fact), 0))}</b>
          </div>
        </div>
      </div>

      <div className="cards grid-4" style={{ marginBottom: 22 }}>
        <div className="card stat clickable" onClick={() => navigate('/finance/income')}>
          <div className="label"><FinIcon name="income" size={15} /> Ожидается к получению</div>
          <div className="value pos">{money(stats.expectedIncome || 0)}</div>
          <div className="sub">план оплат по проектам</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/finance/expense/salary')}>
          <div className="label"><FinIcon name="salary" size={15} /> К выплате ЗП за месяц</div>
          <div className="value">{money(stats.salaryToPay || 0)}</div>
          <div className="sub">фонд {money(stats.salaryFund || 0)}{(stats.salaryBonuses || 0) > 0 ? ` + бонусы ${money(stats.salaryBonuses)}` : ''} − авансы − выплачено</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/finance/expense/debts')}>
          <div className="label"><FinIcon name="receipt" size={15} /> Всего должны</div>
          <div className="value neg">{money(stats.totalDebt || 0)}</div>
          <div className="sub">остаток по долгам</div>
        </div>
        <div className="card stat clickable" onClick={() => navigate('/finance/expense/rent_subs')}>
          <div className="label"><FinIcon name="transactions" size={15} /> Регулярные / мес</div>
          <div className="value">{money(stats.subsMonthly || 0)}</div>
          <div className="sub">аренда + подписки</div>
        </div>
      </div>

      <div className="between" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Транзакции за месяц</div>
        <button className="btn ghost sm" onClick={() => navigate('/finance/transactions')}>Все операции →</button>
      </div>
      <TxTable txns={txns} onEdit={(t: any) => setModal({ open: true, initial: t })} onDelete={handleDelete} />

      {modal.open && <TransactionModal initial={modal.initial} onClose={() => setModal({ open: false })} />}
    </div>
  );
}

// Карточка-сводка «Доход»/«Расход»: разбивка по категориям операций месяца.
// rows приходят из overview.incomeByCategory/expenseByCategory:
// {categoryId,name,icon,color,total,plan?} — plan есть только у базовых категорий
// направлений дохода (план месяца из таблиц направлений) → строка «получено / получим».
function SummaryContainer({ title, hint, legendRight, icon, color, total, rows, onClick, footerRows, ym, txType }: {
  title: string; hint?: string; legendRight?: string; icon: string; color: string; total: number;
  rows: any[]; onClick: () => void;
  footerRows?: Array<{ label: string; value: string; cls?: string }>;
  ym?: string; txType?: 'income' | 'expense';
}) {
  return (
    <div className="card clickable" onClick={onClick}>
      <div className="summary-head">
        <span className="t" style={{ color }}><FinIcon name={icon} size={18} /> {title}</span>
        <span className="total" style={{ color }}>{money(total)}</span>
      </div>
      {hint && <div className="brk-legend"><span>{hint}</span><span>{legendRight}</span></div>}
      <div className="brk">
        {rows.length === 0 && <div className="mini muted" style={{ padding: '6px 0' }}>Нет операций</div>}
        {rows.map((r) => (
          <BreakdownHover
            key={r.categoryId ?? 'none'} className="brk-row"
            ym={ym || ''} kind="category" id={r.categoryId ?? 'none'} txType={txType}
            title={r.name ?? 'Без категории'} color={r.color} icon={r.icon}
          >
            <span className="name" style={{ color: r.color }}>
              <CatIcon icon={r.icon} color={r.color} size={22} /><span style={{ color: 'var(--text)' }}>{r.name ?? 'Без категории'}</span>
            </span>
            {r.plan > 0
              ? <span className="num"><span className="muted" style={{ fontWeight: 500 }}>{money(r.total)}</span> / {money(r.plan)}</span>
              : <span className="num">{money(r.total)}</span>}
          </BreakdownHover>
        ))}
      </div>
      {footerRows && footerRows.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {footerRows.map((f) => (
            <div className="between" key={f.label}>
              <span className="mini muted">{f.label}</span>
              <b className={f.cls}>{f.value}</b>
            </div>
          ))}
        </div>
      )}
      <div className="mini muted" style={{ marginTop: 10 }}>Открыть детали →</div>
    </div>
  );
}
