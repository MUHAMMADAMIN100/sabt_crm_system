import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { financeApi } from '@/services/api.service'
import { ChevronLeft, ChevronRight, Plus, TrendingUp, TrendingDown, Wallet2 } from 'lucide-react'
import { money, monthLabel, shiftYm, currentYm, dirLabel } from './financeUtils'
import OperationModal from './OperationModal'
import clsx from 'clsx'

export default function FinanceOverviewPage() {
  const [ym, setYm] = useState(currentYm())
  const [op, setOp] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'overview', ym], queryFn: () => financeApi.overview(ym) })

  const income = data?.income ?? 0
  const expense = data?.expense ?? 0
  const profit = data?.profit ?? 0
  const txs: any[] = data?.transactions ?? []

  return (
    <div className="space-y-5">
      {/* Шапка */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Обзор</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Доход, расход и баланс за выбранный месяц</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav ym={ym} setYm={setYm} />
          <button onClick={() => setOp(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus size={16} /> Операция
          </button>
        </div>
      </div>

      {/* Верхние 3 карточки */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/finance/income" className="card hover:border-green-300 dark:hover:border-green-800 transition-colors">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-green-600 dark:text-green-400"><TrendingUp size={16} /> Доход</span>
            <span className="text-xl font-bold text-green-600 dark:text-green-400 tabular-nums">{money(income)}</span>
          </div>
          <p className="text-xs text-surface-400 mt-3">{income > 0 ? `${txs.filter(t => t.type === 'income').length} операций` : 'Нет операций'}</p>
          <p className="text-xs text-primary-600 mt-1">Открыть детали →</p>
        </Link>
        <Link to="/finance/expense" className="card hover:border-red-300 dark:hover:border-red-800 transition-colors">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400"><TrendingDown size={16} /> Расход</span>
            <span className="text-xl font-bold text-red-600 dark:text-red-400 tabular-nums">{money(expense)}</span>
          </div>
          <p className="text-xs text-surface-400 mt-3">{expense > 0 ? `${txs.filter(t => t.type === 'expense').length} операций` : 'Нет операций'}</p>
          <p className="text-xs text-primary-600 mt-1">Открыть детали →</p>
        </Link>
        <div className="card">
          <span className="font-semibold text-surface-700 dark:text-surface-200">Overall</span>
          <p className={clsx('text-2xl font-bold mt-2 tabular-nums', profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
            {income === 0 && expense === 0 ? 'Нет данных' : money(profit)}
          </p>
          <div className="flex items-center justify-between text-xs text-surface-400 mt-3">
            <span>Прибыль</span><span className="font-semibold tabular-nums">{money(profit)}</span>
          </div>
        </div>
      </div>

      {/* Доход по направлениям + Расход по статьям */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 font-semibold text-green-600 dark:text-green-400"><TrendingUp size={16} /> Доход</span>
            <span className="font-bold text-green-600 dark:text-green-400 tabular-nums">{money(income)}</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-surface-400"><th className="text-left font-medium pb-1.5">Направление</th><th className="text-right font-medium pb-1.5">получено / план</th></tr></thead>
            <tbody>
              {(data?.incomeByDirection ?? []).map((d: any) => (
                <tr key={d.direction} className="border-t border-surface-50 dark:border-surface-800/60">
                  <td className="py-2 font-medium text-surface-700 dark:text-surface-200">{dirLabel(d.direction)}</td>
                  <td className="py-2 text-right tabular-nums"><span className="text-green-600 dark:text-green-400">{money(d.received)}</span> <span className="text-surface-400">/ {money(d.plan)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between text-sm font-semibold border-t border-surface-100 dark:border-surface-700 mt-1 pt-2">
            <span className="text-surface-500">Получено за месяц</span><span className="text-green-600 dark:text-green-400 tabular-nums">{money(income)}</span>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400"><TrendingDown size={16} /> Расход</span>
            <span className="font-bold text-red-600 dark:text-red-400 tabular-nums">{money(expense)}</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-surface-400"><th className="text-left font-medium pb-1.5">Статья</th><th className="text-right font-medium pb-1.5">потрачено / план</th></tr></thead>
            <tbody>
              {(data?.expenseByCategory ?? []).map((c: any) => (
                <tr key={c.key} className="border-t border-surface-50 dark:border-surface-800/60">
                  <td className="py-2 font-medium text-surface-700 dark:text-surface-200">{c.label}</td>
                  <td className="py-2 text-right tabular-nums"><span className="text-red-600 dark:text-red-400">{money(c.spent)}</span> <span className="text-surface-400">/ {money(c.plan)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between text-sm font-semibold border-t border-surface-100 dark:border-surface-700 mt-1 pt-2">
            <span className="text-surface-500">Потрачено за месяц</span><span className="text-red-600 dark:text-red-400 tabular-nums">{money(expense)}</span>
          </div>
        </div>
      </div>

      {/* 4 мини-карточки */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard title="Ожидается к получению" value={money(data?.expectedIncome ?? 0)} hint="план оплат по проектам" color="text-green-600 dark:text-green-400" />
        <MiniCard title="К выплате ЗП за месяц" value={money(data?.salaryToPay ?? 0)} hint={`фонд ${money(data?.salaryFund ?? 0)} − авансы − выплачено`} />
        <MiniCard title="Всего должны" value={money(data?.totalDebt ?? 0)} hint="остаток по долгам" color={(data?.totalDebt ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : undefined} />
        <MiniCard title="Регулярные / мес" value={money(data?.regularMonthly ?? 0)} hint="аренда + подписки" />
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
          <div className="py-10 text-center text-surface-400">
            <Wallet2 size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Нет операций за период</p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-50 dark:divide-surface-800/60">
            {txs.slice(0, 15).map(t => <TxRow key={t.id} t={t} />)}
          </ul>
        )}
      </div>

      <OperationModal open={op} onClose={() => setOp(false)} defaultTab="income" />
    </div>
  )
}

function MonthNav({ ym, setYm }: { ym: string; setYm: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-1 py-0.5">
      <button onClick={() => setYm(shiftYm(ym, -1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronLeft size={16} /></button>
      <span className="text-sm font-medium px-2 min-w-[110px] text-center">{monthLabel(ym)}</span>
      <button onClick={() => setYm(shiftYm(ym, 1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronRight size={16} /></button>
    </div>
  )
}

function MiniCard({ title, value, hint, color }: { title: string; value: string; hint: string; color?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-surface-400">{title}</p>
      <p className={clsx('text-2xl font-bold mt-1 tabular-nums', color || 'text-surface-800 dark:text-surface-100')}>{value}</p>
      <p className="text-[11px] text-surface-400 mt-2">{hint}</p>
    </div>
  )
}

const TYPE_META: Record<string, { sign: string; color: string; label: string }> = {
  income: { sign: '+', color: 'text-green-600 dark:text-green-400', label: 'Доход' },
  expense: { sign: '−', color: 'text-red-600 dark:text-red-400', label: 'Расход' },
  transfer: { sign: '', color: 'text-blue-600 dark:text-blue-400', label: 'Перевод' },
  saving: { sign: '', color: 'text-purple-600 dark:text-purple-400', label: 'Накопление' },
}

export function TxRow({ t }: { t: any }) {
  const meta = TYPE_META[t.type] || TYPE_META.income
  const title = t.type === 'transfer'
    ? `${t.fromAccountName || '—'} → ${t.toAccountName || '—'}`
    : (t.categoryName || t.projectName || meta.label)
  const sub = [t.projectName, t.employeeName, t.debtName, t.comment].filter(Boolean).join(' · ')
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{title}</p>
        {sub && <p className="text-xs text-surface-400 truncate">{sub}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className={clsx('text-sm font-semibold tabular-nums', meta.color)}>{meta.sign}{money(t.amount)}</p>
        <p className="text-[11px] text-surface-400">{t.date} · {t.accountName || t.toAccountName || ''}</p>
      </div>
    </li>
  )
}
