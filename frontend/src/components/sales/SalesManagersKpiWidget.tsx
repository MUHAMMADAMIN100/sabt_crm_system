import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { clientsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { Briefcase, ArrowRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'
import clsx from 'clsx'
import SalesManagerKpiCard from './SalesManagerKpiCard'

type Period = 'today' | 'week' | 'month' | 'prev_month'

const PERIOD_LABELS: Record<Period, string> = {
  today:      'Сегодня',
  week:       'Эта неделя',
  month:      'Этот месяц',
  prev_month: 'Прошлый месяц',
}

function periodRange(p: Period): { from: string; to: string } {
  const now = new Date()
  if (p === 'today') {
    const d = format(now, 'yyyy-MM-dd')
    return { from: d, to: d }
  }
  if (p === 'week') {
    return {
      from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      to:   format(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    }
  }
  if (p === 'prev_month') {
    const prev = subMonths(now, 1)
    return {
      from: format(startOfMonth(prev), 'yyyy-MM-dd'),
      to:   format(endOfMonth(prev),   'yyyy-MM-dd'),
    }
  }
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to:   format(endOfMonth(now),   'yyyy-MM-dd'),
  }
}

interface Row {
  user: { id: string; name: string; email: string; role: string; avatar: string | null }
  employee: { id: string; position: string; department: string } | null
  kpi: any
}

/**
 * Виджет «KPI менеджеров продаж» — для дашборда основателя.
 * Список всех МП с их % выполнения за период, сортировка по убыванию.
 * Клик по карточке → переход на страницу сотрудника.
 */
export default function SalesManagersKpiWidget() {
  const [period, setPeriod] = useState<Period>('month')
  const range = periodRange(period)

  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ['kpi-all-sales-managers', period],
    queryFn: () => clientsApi.kpiAll(range),
    staleTime: 60_000,
  })

  // Сортировка: по overallPercent ↓, потом по имени.
  const rows = (data || []).slice().sort((a, b) => {
    const pa = a.kpi?.overallPercent ?? -1
    const pb = b.kpi?.overallPercent ?? -1
    if (pa !== pb) return pb - pa
    return a.user.name.localeCompare(b.user.name, 'ru')
  })

  if (isLoading) {
    return (
      <div className="card">
        <p className="text-xs text-surface-400 animate-pulse">Загрузка KPI менеджеров продаж…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return null // нет МП — виджет скрыт
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Briefcase size={18} className="text-primary-600" />
          <h3 className="section-title">KPI менеджеров продаж</h3>
        </div>
        <div className="flex gap-1">
          {(['today', 'week', 'month', 'prev_month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                period === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {rows.map(row => (
          <Link
            key={row.user.id}
            to={`/employees/${row.employee?.id || ''}`}
            className="flex items-start gap-3 p-3 rounded-xl border border-surface-100 dark:border-surface-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors"
          >
            <Avatar name={row.user.name} src={row.user.avatar || undefined} size={40} />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-surface-900 dark:text-surface-100 truncate">
                    {row.user.name}
                  </p>
                  <p className="text-[11px] text-surface-500 dark:text-surface-400 truncate">
                    {row.user.role === 'sales_manager_smm' ? 'СММ' : 'Разработка'}
                    {row.employee?.position && ` · ${row.employee.position}`}
                  </p>
                </div>
                <ArrowRight size={14} className="text-surface-400 shrink-0" />
              </div>
              <SalesManagerKpiCard userId={row.user.id} compact kpi={row.kpi} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
