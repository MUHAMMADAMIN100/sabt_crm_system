import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { PageLoader, StatusBadge, ProgressBar, CollapsibleSection } from '@/components/ui'
import { Calendar, CheckCircle2, Mail } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'

const TYPE_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'overdue', label: '🔴 Просрочено' },
  { value: 'upcoming', label: '🟠 Скоро' },
  { value: 'outstanding', label: '⏳ К оплате' },
  { value: 'paid', label: '✅ Оплачено' },
]

const fmt = (n: number) => n.toLocaleString('ru-RU')

export default function SalesDashboard() {
  const [filter, setFilter] = useState('')
  const role = useAuthStore(s => s.user?.role)
  // Сегмент МП: СММ → SMM-проекты, разработка → «Web сайт».
  const segmentType =
    role === 'sales_manager_dev' ? 'Web сайт'
    : role === 'sales_manager_smm' ? 'SMM'
    : null

  const { data, isLoading } = useQuery({
    queryKey: ['sales-stats'],
    queryFn: analyticsApi.sales,
  })

  const projects = useMemo(() => {
    let list = (data?.projects || []) as any[]
    // Каждый МП видит только проекты своего направления.
    if (segmentType) list = list.filter(p => p.projectType === segmentType)
    if (filter === 'overdue') return list.filter(p => p.isOverdue)
    if (filter === 'upcoming') return list.filter(p => p.isUpcoming)
    if (filter === 'outstanding') return list.filter(p => p.remaining > 0)
    if (filter === 'paid') return list.filter(p => p.budget > 0 && p.remaining === 0)
    return list
  }, [data, filter, segmentType])

  if (isLoading) return <PageLoader />

  const totalCount = segmentType
    ? ((data?.projects || []) as any[]).filter(p => p.projectType === segmentType).length
    : (data?.projectCount || 0)

  return (
    <div className="space-y-6">
      {/* Projects table */}
      <CollapsibleSection
        id="sales-projects"
        title={
          <div className="flex items-center justify-between w-full">
            <h3 className="section-title">Все проекты</h3>
            <span className="text-xs text-surface-400">{projects.length} из {totalCount}</span>
          </div>
        }
      >
      <div className="space-y-4">

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
      </CollapsibleSection>
    </div>
  )
}
