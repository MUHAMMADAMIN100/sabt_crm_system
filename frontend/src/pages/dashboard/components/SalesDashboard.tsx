import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi } from '@/services/api.service'
import { PageLoader, StatusBadge, ProgressBar } from '@/components/ui'
import {
  DollarSign, Briefcase, TrendingDown, Clock, Calendar,
  AlertTriangle, CheckCircle2, Mail, TrendingUp,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import clsx from 'clsx'

const TYPE_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'overdue', label: '🔴 Просрочено' },
  { value: 'upcoming', label: '🟠 Скоро' },
  { value: 'outstanding', label: '⏳ К оплате' },
  { value: 'paid', label: '✅ Оплачено' },
]

const PIE_COLORS = ['#6B4FCF', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9']

const fmt = (n: number) => n.toLocaleString('ru-RU')

export default function SalesDashboard() {
  const [filter, setFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['sales-stats'],
    queryFn: analyticsApi.sales,
  })

  const projects = useMemo(() => {
    const list = (data?.projects || []) as any[]
    if (filter === 'overdue') return list.filter(p => p.isOverdue)
    if (filter === 'upcoming') return list.filter(p => p.isUpcoming)
    if (filter === 'outstanding') return list.filter(p => p.remaining > 0)
    if (filter === 'paid') return list.filter(p => p.budget > 0 && p.remaining === 0)
    return list
  }, [data, filter])

  if (isLoading) return <PageLoader />

  const totalBudget = Number(data?.totalBudget || 0)
  const totalPaid = Number(data?.totalPaid || 0)
  const totalOutstanding = Number(data?.totalOutstanding || 0)
  const collectionRate = totalBudget > 0 ? Math.round((totalPaid / totalBudget) * 100) : 0
  const overdueAmount = Number(data?.overdueOutstanding || 0)
  const upcomingAmount = Number(data?.upcomingDeadlineOutstanding || 0)

  const monthlyChart = (data?.monthlyRevenue || []).map((m: any) => ({
    month: format(parseISO(`${m.month}-01`), 'LLL', { locale: ru }),
    total: m.total,
  }))

  const byType = (data?.byType || []) as Array<{ type: string; count: number; budget: number; paid: number; outstanding: number }>

  return (
    <div className="space-y-6">
      {/* Top KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <Briefcase size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-surface-500 dark:text-surface-400 leading-tight">Бюджет всех проектов</p>
            <p className="text-lg sm:text-xl font-bold text-surface-900 dark:text-surface-100 leading-tight">
              {fmt(totalBudget)} <span className="text-xs font-normal">сомони</span>
            </p>
            <p className="text-[10px] text-surface-400 leading-tight">{data?.projectCount} проектов</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
            <DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-surface-500 dark:text-surface-400 leading-tight">Получено всего</p>
            <p className="text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-400 leading-tight">
              {fmt(totalPaid)} <span className="text-xs font-normal">сомони</span>
            </p>
            <p className="text-[10px] text-surface-400 leading-tight">{collectionRate}% собираемость</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <Clock size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-surface-500 dark:text-surface-400 leading-tight">К оплате</p>
            <p className="text-lg sm:text-xl font-bold text-amber-700 dark:text-amber-400 leading-tight">
              {fmt(totalOutstanding)} <span className="text-xs font-normal">сомони</span>
            </p>
            <p className="text-[10px] text-surface-400 leading-tight">{data?.outstandingCount} проектов</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
            <TrendingDown size={20} className="text-red-600 dark:text-red-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-surface-500 dark:text-surface-400 leading-tight">Просроченная оплата</p>
            <p className="text-lg sm:text-xl font-bold text-red-600 dark:text-red-400 leading-tight">
              {fmt(overdueAmount)} <span className="text-xs font-normal">сомони</span>
            </p>
            <p className="text-[10px] text-surface-400 leading-tight">после дедлайна</p>
          </div>
        </div>
      </div>

      {/* Second row: collection progress bar + upcoming + charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title flex items-center gap-2"><TrendingUp size={16} className="text-emerald-500" /> Поступления по месяцам</h3>
            <span className="text-xs text-surface-400">последние 6 месяцев</span>
          </div>
          {monthlyChart.length === 0 ? (
            <p className="text-sm text-surface-400 py-10 text-center">Пока платежей нет</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={monthlyChart}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}к` : v} />
                <Tooltip formatter={(v: any) => [`${fmt(Number(v))} сомони`, 'Получено']} />
                <Area type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-500" />
            <h3 className="section-title">Скоро дедлайн</h3>
          </div>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mb-1">{fmt(upcomingAmount)}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
            сомони к получению в ближайшие 14 дней
          </p>
          <div className="pt-3 border-t border-surface-100 dark:border-surface-700 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-surface-500">Полностью оплачено</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{data?.fullyPaidCount || 0} проектов</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-surface-500">Частично оплачено</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {(data?.outstandingCount || 0) - (projects.filter((p: any) => p.paidAmount === 0 && p.budget > 0).length)} проектов
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* By project type */}
      {byType.length > 0 && (
        <div className="card">
          <h3 className="section-title mb-3 flex items-center gap-2"><Briefcase size={16} /> По типам проектов</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byType}>
              <XAxis dataKey="type" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}к` : v} />
              <Tooltip formatter={(v: any) => `${fmt(Number(v))} сомони`} />
              <Bar dataKey="budget" name="Бюджет" radius={[6, 6, 0, 0]}>
                {byType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Projects table */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="section-title">Все проекты</h3>
          <span className="text-xs text-surface-400">{projects.length} из {data?.projectCount || 0}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
              )}
            >{f.label}</button>
          ))}
        </div>

        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                <th className="pb-2 font-medium">Проект</th>
                <th className="pb-2 font-medium">Тип</th>
                <th className="pb-2 font-medium text-right">Бюджет</th>
                <th className="pb-2 font-medium text-right">Оплачено</th>
                <th className="pb-2 font-medium text-right">Остаток</th>
                <th className="pb-2 font-medium">Дедлайн</th>
                <th className="pb-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-surface-800">
              {projects.map((p: any) => (
                <tr key={p.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors">
                  <td className="py-2 pr-3">
                    <Link to={`/projects/${p.id}`} className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400">
                      {p.name}
                    </Link>
                    {p.clientInfo?.email && (
                      <p className="text-[10px] text-surface-400 flex items-center gap-1 mt-0.5">
                        <Mail size={10} /> {p.clientInfo.email}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {p.projectType && (
                      <span className="text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">{p.projectType}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium text-surface-800 dark:text-surface-200 tabular-nums whitespace-nowrap">
                    {fmt(p.budget)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                    {fmt(p.paidAmount)}
                  </td>
                  <td className={clsx(
                    'py-2 pr-3 text-right font-bold tabular-nums whitespace-nowrap',
                    p.remaining === 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : p.isOverdue
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-400',
                  )}>
                    {fmt(p.remaining)}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {p.endDate ? (
                      <span className={clsx(
                        'text-xs',
                        p.isOverdue ? 'text-red-500 font-semibold' : p.isUpcoming ? 'text-amber-600 dark:text-amber-400' : 'text-surface-500 dark:text-surface-400',
                      )}>
                        {p.isOverdue && '🔴 '}{p.isUpcoming && '🟠 '}
                        {format(new Date(p.endDate), 'dd.MM.yy')}
                      </span>
                    ) : (
                      <span className="text-xs text-surface-400">—</span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    {p.budget > 0 && p.remaining === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={12} /> Оплачено
                      </span>
                    ) : (
                      <StatusBadge status={p.status} />
                    )}
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-sm text-surface-400">
                    Нет проектов по фильтру
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Per-project progress bars */}
        <div className="space-y-2 pt-3 border-t border-surface-100 dark:border-surface-700">
          <p className="text-xs font-medium text-surface-500 dark:text-surface-400">Прогресс оплаты:</p>
          {projects.slice(0, 8).map((p: any) => (
            <div key={p.id} className="flex items-center gap-3 text-xs">
              <Link to={`/projects/${p.id}`} className="w-40 truncate font-medium text-surface-700 dark:text-surface-300 hover:text-primary-600">
                {p.name}
              </Link>
              <div className="flex-1 min-w-0">
                <ProgressBar value={p.paidPct} />
              </div>
              <span className="w-10 text-right text-surface-500 tabular-nums">{p.paidPct}%</span>
              <Link to={`/projects/${p.id}`} className="p-1 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded">
                <Calendar size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
