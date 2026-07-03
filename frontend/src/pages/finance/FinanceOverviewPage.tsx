import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Plus, TrendingUp, TrendingDown, Wallet2, Users, Receipt, Repeat, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { financeApi } from '@/services/api.service'
import {
  money, currentYm, dirLabel, groupLabel, formatDate,
  GROUP_META, TYPE_LABEL, TYPE_COLOR, TYPE_SIGN,
} from './financeUtils'
import { MonthNav, Stat, EmptyState } from './financeUi'
import { CatIcon } from './financeIcons'
import OperationModal from './OperationModal'

const NEUTRAL_DOT = '#94a3b8'

export default function FinanceOverviewPage() {
  const [ym, setYm] = useState(currentYm())
  const [op, setOp] = useState(false)
  const nav = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'overview', ym], queryFn: () => financeApi.overview(ym) })

  const income: number = data?.income ?? 0
  const expense: number = data?.expense ?? 0
  const profit: number = data?.profit ?? 0
  const balances: any[] = data?.balances ?? []
  const incomeByCategory: any[] = data?.incomeByCategory ?? []
  const expenseByCategory: any[] = data?.expenseByCategory ?? []
  const incomePlan: any[] = data?.incomePlan ?? []
  const expensePlan: any[] = data?.expensePlan ?? []
  const stats: any = data?.stats ?? {}
  const txs: any[] = data?.transactions ?? []

  const incomePlanRows = incomePlan.map((r) => ({
    key: r.direction, label: dirLabel(r.direction), color: GROUP_META[r.direction]?.color, fact: r.fact, plan: r.plan,
  }))
  const expensePlanRows = expensePlan.map((r) => ({
    key: r.group, label: groupLabel(r.group), color: GROUP_META[r.group]?.color, fact: r.fact, plan: r.plan,
  }))
  const incomePlanTotal = incomePlan.reduce((s, r) => s + (r.plan || 0), 0)
  const incomeReceivedTotal = incomePlan.reduce((s, r) => s + (r.fact || 0), 0)
  const expensePlanTotal = expensePlan.reduce((s, r) => s + (r.plan || 0), 0)

  const pie = [
    { name: 'Доход', value: income, color: '#16a34a' },
    { name: 'Расход', value: expense, color: '#e11d48' },
  ].filter((p) => p.value > 0)

  return (
    <div className="space-y-5">
      {/* Шапка */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Обзор</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Доход, расход и баланс за выбранный месяц</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav ym={ym} onChange={setYm} />
          <button onClick={() => setOp(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus size={16} /> Операция
          </button>
        </div>
      </div>

      {/* Балансы счетов */}
      {balances.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {balances.map((b) => (
            <div className="card" key={b.accountId}>
              <p className="text-xs text-surface-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color || NEUTRAL_DOT }} />
                <span className="truncate">{b.name}</span>
              </p>
              <p className="text-lg font-bold mt-1 tabular-nums text-surface-800 dark:text-surface-100">{money(b.balance)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Верхние 3 карточки: Доход / Расход / Overall */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CatSummaryCard to="/finance/income" title="Доход" tone="income" total={income} rows={incomeByCategory} />
        <CatSummaryCard to="/finance/expense" title="Расход" tone="expense" total={expense} rows={expenseByCategory} />
        <div className="card">
          <span className="font-semibold text-surface-700 dark:text-surface-200">Overall</span>
          {pie.length === 0 ? (
            <EmptyState>Нет данных</EmptyState>
          ) : (
            <div className="mt-2">
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2}>
                    {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-surface-500">Прибыль</span>
            <b className={clsx('tabular-nums', profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
              {money(profit, true)}
            </b>
          </div>
        </div>
      </div>

      {/* План/факт: доход по направлениям + расход по статьям */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PlanCard
          to="/finance/income" title="Доход" tone="income"
          total={incomePlanTotal} colLabel="Направление" legend="получено / план"
          rows={incomePlanRows} footerLabel="Получено за месяц" footerValue={incomeReceivedTotal}
        />
        <PlanCard
          to="/finance/expense" title="Расход" tone="expense"
          total={expensePlanTotal} colLabel="Статья" legend="потрачено / план"
          rows={expensePlanRows} footerLabel="Потрачено за месяц" footerValue={expense}
        />
      </div>

      {/* 4 мини-карточки */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Ожидается к получению" value={money(stats.expectedIncome ?? 0)} tone="pos"
          sub="план оплат по проектам" icon={<TrendingUp size={15} />} onClick={() => nav('/finance/income')}
        />
        <Stat
          label="К выплате ЗП за месяц" value={money(stats.salaryToPay ?? 0)}
          sub={`фонд ${money(stats.salaryFund ?? 0)} − авансы − выплачено`} icon={<Users size={15} />} onClick={() => nav('/finance/expense')}
        />
        <Stat
          label="Всего должны" value={money(stats.totalDebt ?? 0)} tone={(stats.totalDebt ?? 0) > 0 ? 'neg' : 'default'}
          sub="остаток по долгам" icon={<Receipt size={15} />} onClick={() => nav('/finance/expense')}
        />
        <Stat
          label="Регулярные / мес" value={money(stats.subsMonthly ?? 0)}
          sub="аренда + подписки" icon={<Repeat size={15} />} onClick={() => nav('/finance/expense')}
        />
      </div>

      {/* Транзакции за месяц */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Транзакции за месяц</h3>
          <Link to="/finance/transactions" className="text-xs text-primary-600 hover:underline">Все операции →</Link>
        </div>
        {isLoading ? (
          <p className="text-sm text-surface-400 animate-pulse py-6 text-center">Загрузка…</p>
        ) : txs.length === 0 ? (
          <EmptyState icon={<Wallet2 size={28} />}>Нет операций за период</EmptyState>
        ) : (
          <ul className="divide-y divide-surface-50 dark:divide-surface-800/60">
            {txs.slice(0, 15).map((t) => <TxRow key={t.id} t={t} />)}
          </ul>
        )}
      </div>

      <OperationModal open={op} onClose={() => setOp(false)} defaultTab="income" />
    </div>
  )
}

/* ── Верхняя карточка «Доход»/«Расход» с разбивкой по категориям ── */
function CatSummaryCard({
  to, title, tone, total, rows,
}: {
  to: string; title: string; tone: 'income' | 'expense'; total: number; rows: any[]
}) {
  const isInc = tone === 'income'
  const color = isInc ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  const hover = isInc ? 'hover:border-green-300 dark:hover:border-green-800' : 'hover:border-red-300 dark:hover:border-red-800'
  const Icon: LucideIcon = isInc ? TrendingUp : TrendingDown
  return (
    <Link to={to} className={clsx('card transition-colors', hover)}>
      <div className="flex items-center justify-between">
        <span className={clsx('flex items-center gap-1.5 font-semibold', color)}><Icon size={18} /> {title}</span>
        <span className={clsx('font-bold tabular-nums', color)}>{money(total)}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {rows.length === 0 && <p className="text-xs text-surface-400 py-1">Нет операций</p>}
        {rows.map((r) => (
          <div key={r.categoryId ?? 'none'} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0" style={{ color: r.color || undefined }}><CatIcon name={r.icon} size={16} /></span>
              <span className="truncate text-surface-700 dark:text-surface-200">{r.name}</span>
            </span>
            <span className="tabular-nums text-surface-500 shrink-0">{money(r.total)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-primary-600 mt-3">Открыть детали →</p>
    </Link>
  )
}

/* ── Карточка план/факт по направлениям / статьям ── */
function PlanCard({
  to, title, tone, total, colLabel, legend, rows, footerLabel, footerValue,
}: {
  to: string; title: string; tone: 'income' | 'expense'; total: number
  colLabel: string; legend: string
  rows: { key: string; label: string; color?: string; fact: number; plan: number }[]
  footerLabel: string; footerValue: number
}) {
  const isInc = tone === 'income'
  const color = isInc ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  const hover = isInc ? 'hover:border-green-300 dark:hover:border-green-800' : 'hover:border-red-300 dark:hover:border-red-800'
  const Icon: LucideIcon = isInc ? TrendingUp : TrendingDown
  return (
    <Link to={to} className={clsx('card transition-colors', hover)}>
      <div className="flex items-center justify-between mb-3">
        <span className={clsx('flex items-center gap-1.5 font-semibold', color)}><Icon size={18} /> {title}</span>
        <span className={clsx('font-bold tabular-nums', color)}>{money(total)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-surface-400 mb-1.5">
        <span>{colLabel}</span><span>{legend}</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color || NEUTRAL_DOT }} />
              <span className="font-medium text-surface-700 dark:text-surface-200 truncate">{r.label}</span>
            </span>
            <span className="tabular-nums shrink-0">
              <span className={clsx('font-medium', color)}>{money(r.fact)}</span>{' '}
              <span className="text-surface-400">/ {money(r.plan)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm font-semibold border-t border-dashed border-surface-200 dark:border-surface-700 mt-3 pt-2.5">
        <span className="text-surface-500">{footerLabel}</span>
        <b className={clsx('tabular-nums', color)}>{money(footerValue)}</b>
      </div>
    </Link>
  )
}

/* ── Строка транзакции (используется также в FinanceExpensePage) ── */
export function TxRow({ t }: { t: any }) {
  const title = t.type === 'transfer'
    ? `${t.fromAccountName || '—'} → ${t.toAccountName || '—'}`
    : (t.categoryName || t.projectName || TYPE_LABEL[t.type] || '—')
  const sub = [t.projectName, t.employeeName, t.debtName, t.comment].filter(Boolean).join(' · ')
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{title}</p>
        {sub && <p className="text-xs text-surface-400 truncate">{sub}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className={clsx('text-sm font-semibold tabular-nums', TYPE_COLOR[t.type])}>{TYPE_SIGN[t.type]}{money(t.amount)}</p>
        <p className="text-[11px] text-surface-400">{formatDate(t.date)} · {t.accountName || t.toAccountName || ''}</p>
      </div>
    </li>
  )
}
