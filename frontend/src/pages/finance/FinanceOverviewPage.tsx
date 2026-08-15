// Обзор (дашборд) раздела «Финансы». Порт fin-webrand/src/pages/Dashboard.tsx (Этап 1 ТЗ).
// Данные: financeApi.overview(ym) через react-query вместо Dexie-хуков эталона.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { money, apiErr, INCOME_GROUPS, EXPENSE_GROUPS , useYmParam, withYm, todayISO } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import BreakdownHover from './BreakdownHover';
import MonthNav from './MonthNav';
import TxTable from './TxTable';
import TransactionModal from './TransactionModal';
import { FinLoading, FinLoadError, invalidateFinance } from './FinKit';
import { financeApi } from '@/services/api.service';
import { MonthlyFlowComparison, OverviewCashFlowChart } from './FinanceCharts';
import { AccountLabel } from './AccountIdentity';

// ── Экспорт CSV: подписи и экранирование ячейки ──────────────────────
const FIN_TYPE_RU: Record<string, string> = {
  income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление',
};
const FIN_STATUS_RU: Record<string, string> = {
  completed: 'Проведено', pending: 'Ожидание', cancelled: 'Отменено',
};
/** Экранирование значения для CSV (разделитель «;», кавычки удваиваются). */
const csvCell = (v: any): string => {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function FinanceOverviewPage() {
  const [ym, setYm] = useYmParam();
  const [modal, setModal] = useState<{ open: boolean; initial?: any }>({ open: false });
  const [exporting, setExporting] = useState(false);
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

  const handleDelete = async (t: any) => {
    const id = typeof t === 'string' || typeof t === 'number' ? t : t?.id;
    try {
      await financeApi.removeTransaction(id);
      invalidateFinance(qc);
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  };

  /** Выгрузка ВСЕХ финансовых операций (включая отменённые) в CSV.
   *  Файл открывается в Excel: UTF-8 BOM + разделитель «;». */
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await financeApi.transactions({ pageSize: 100000, status: 'all' });
      const items: any[] = res?.items || [];
      const headers = [
        'Дата', 'Тип', 'Категория', 'Счёт', 'Проект/Клиент', 'Сотрудник', 'Долг',
        'Подписка/Аренда', 'Контрагент', 'Описание', 'Комментарий', 'Способ оплаты',
        'Месяц ЗП', 'Сумма', 'Статус', 'Создал',
      ];
      const lines = items.map((t) => {
        const account = t.type === 'transfer' || t.type === 'saving'
          ? [t.fromAccountName, t.toAccountName].filter(Boolean).join(' → ')
          : (t.accountName ?? t.fromAccountName ?? t.toAccountName ?? '');
        return [
          t.date ?? '',
          FIN_TYPE_RU[t.type] ?? t.type ?? '',
          t.categoryName ?? '',
          account,
          t.projectName ?? t.legacyProject ?? '',
          t.employeeName ?? '',
          t.debtName ?? '',
          t.subscriptionName ?? '',
          t.counterparty ?? '',
          t.legacyDescription ?? '',
          t.comment ?? '',
          t.paymentMethod ?? '',
          t.salaryYm ?? '',
          Number(t.amount) || 0,
          FIN_STATUS_RU[t.status] ?? t.status ?? '',
          t.createdByName ?? '',
        ];
      });
      const csv = [headers, ...lines].map((r) => r.map(csvCell).join(';')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sabt-finance-${todayISO()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Экспортировано операций: ${items.length}`);
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setExporting(false);
    }
  };

  if (isLoading || isError) {
    return (
      <div className="fin-root">
        <div className="page-head">
          <div><h1 className="flex"><FinIcon name="overview" size={22} /> Обзор</h1><p>Доход, расход и баланс за выбранный месяц</p></div>
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
          <h1 className="flex"><FinIcon name="overview" size={22} /> Обзор</h1>
          <p>Доход, расход и баланс за выбранный месяц</p>
        </div>
        <div className="flex">
          <MonthNav ym={ym} onChange={setYm} />
          <button className="btn ghost" onClick={exportCsv} disabled={exporting} title="Скачать все операции в CSV (Excel)">
            <FinIcon name="download" size={16} /> {exporting ? 'Экспорт…' : 'Экспорт CSV'}
          </button>
          <button className="btn primary" onClick={() => setModal({ open: true })}><FinIcon name="plus" size={16} /> Операция</button>
        </div>
      </div>

      <div className="cards grid-balances" style={{ marginBottom: 14 }}>
        {balances.map((a) => (
          <div className="card stat" key={a.accountId}>
            <div className="label"><AccountLabel name={a.name} color={a.color} /></div>
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
          rows={incCats} ym={ym} txType="income" onClick={() => navigate(withYm('/finance/income', ym))}
          footerRows={[
            { label: 'Прогноз на приходящий месяц', value: `≈ ${money(stats.forecastNextMonth || 0)}` },
            { label: 'Доход за всё время', value: money(stats.incomeAllTime || 0), cls: 'pos' },
          ]}
        />
        <SummaryContainer
          title="Расход за месяц" hint="все операции месяца · по категориям"
          icon="expense" color="var(--red)" total={expense}
          rows={expCats} ym={ym} txType="expense" onClick={() => navigate(withYm('/finance/expense', ym))}
          footerRows={[
            { label: 'Регулярные обязательства / мес', value: money((stats.salaryToPay || 0) + (stats.subsMonthly || 0)) },
            { label: 'Расход за всё время', value: money(stats.expenseAllTime || 0), cls: 'neg' },
          ]}
        />
        <MonthlyFlowComparison income={income} expense={expense} profit={profit} amortization={stats.amortMonthly || 0} />
      </div>

      {/* Тренд: месяц виден в контексте года, а не изолированно. */}
      <OverviewCashFlowChart rows={ov.monthlySeries || []} selectedYm={ym} />

      <div className="cards grid-2" style={{ marginBottom: 22 }}>
        <div className="card">
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
          <button className="btn ghost sm fin-open-details" onClick={() => navigate(withYm('/finance/income', ym))}>Открыть доходы <FinIcon name="arrowRight" size={14} /></button>
        </div>

        <div className="card">
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
          <button className="btn ghost sm fin-open-details" onClick={() => navigate(withYm('/finance/expense', ym))}>Открыть расходы <FinIcon name="arrowRight" size={14} /></button>
        </div>
      </div>

      <div className="cards grid-4" style={{ marginBottom: 22 }}>
        <button type="button" className="card stat clickable" onClick={() => navigate(withYm('/finance/income', ym))}>
          <div className="label"><FinIcon name="income" size={15} /> Ожидается к получению</div>
          <div className="value pos">{money(stats.expectedIncome || 0)}</div>
          <div className="sub">план оплат по проектам</div>
        </button>
        <button type="button" className="card stat clickable" onClick={() => navigate(withYm('/finance/expense/salary', ym))}>
          <div className="label"><FinIcon name="salary" size={15} /> К выплате ЗП за месяц</div>
          <div className="value">{money(stats.salaryToPay || 0)}</div>
          <div className="sub">фонд {money(stats.salaryFund || 0)}{(stats.salaryBonuses || 0) > 0 ? ` + бонусы ${money(stats.salaryBonuses)}` : ''} − авансы − выплачено</div>
        </button>
        <button type="button" className="card stat clickable" onClick={() => navigate(withYm('/finance/expense/debts', ym))}>
          <div className="label"><FinIcon name="receipt" size={15} /> Всего должны</div>
          <div className="value neg">{money(stats.totalDebt || 0)}</div>
          <div className="sub">остаток по долгам</div>
        </button>
        <button type="button" className="card stat clickable" onClick={() => navigate(withYm('/finance/expense/rent_subs', ym))}>
          <div className="label"><FinIcon name="transactions" size={15} /> Регулярные / мес</div>
          <div className="value">{money(stats.subsMonthly || 0)}</div>
          <div className="sub">аренда + подписки</div>
        </button>
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
    <div className="card">
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
      <button className="btn ghost sm fin-open-details" onClick={onClick}>Открыть детали <FinIcon name="arrowRight" size={14} /></button>
    </div>
  );
}
