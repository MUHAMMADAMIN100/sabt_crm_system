import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { kpiApi, employeesApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { Users, ArrowRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'
import clsx from 'clsx'
import EmployeeKpiCard, { UserKpi } from './EmployeeKpiCard'

type Period = 'today' | 'week' | 'month' | 'prev_month'

const PERIOD_LABELS: Record<Period, string> = {
  today:      'Сегодня',
  week:       'Неделя',
  month:      'Месяц',
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

/** Группы ролей для фильтра. */
const ROLE_GROUPS: { value: string; label: string; roles: string[] }[] = [
  { value: 'all',      label: 'Все',                roles: [] },
  { value: 'sales',    label: 'Менеджеры продаж',   roles: ['sales_manager_smm', 'sales_manager_dev'] },
  { value: 'smm',      label: 'SMM',                roles: ['smm_specialist', 'storymaker'] },
  { value: 'pm',       label: 'Руководители',       roles: ['video_director', 'smm_director'] },
  { value: 'design',   label: 'Продакшн',           roles: ['designer', 'videographer', 'video_editor', 'organizer'] },
  { value: 'dev',      label: 'Разработчики',       roles: ['developer'] },
]

const ROLE_LABEL: Record<string, string> = {
  sales_manager_smm: 'МП (СММ)',
  sales_manager_dev: 'МП (Разработка)',
  smm_specialist:    'SMM',
  smm_director:      'Рук. SMM',
  video_director:    'Рук. видео',
  designer:          'Дизайнер',
  developer:         'Разработчик',
  videographer:      'Видеограф',
  video_editor:      'Монтажёр',
  organizer:         'Организатор',
  storymaker:        'Сторисмейкер',
  employee:          'Сотрудник',
}

/**
 * Виджет «KPI команды» — для дашборда основателя.
 * Все сотрудники (кроме admin/founder/co_founder), сортировка по % ↓.
 * Фильтр по группе ролей, переключатель периода.
 */
export default function EmployeesKpiWidget() {
  const [period, setPeriod] = useState<Period>('month')
  const [filter, setFilter] = useState<string>('all')
  const range = periodRange(period)

  const { data: kpis, isLoading } = useQuery<UserKpi[]>({
    queryKey: ['kpi-all', period],
    queryFn: () => kpiApi.all(range),
    staleTime: 60_000,
  })

  // Подтягиваем employees чтобы построить (userId → employee) маппу с
  // именем/аватаром/employee.id для ссылки на страницу сотрудника.
  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
    staleTime: 60_000,
  })
  const empByUserId = useMemo(() => {
    const m = new Map<string, any>()
    for (const e of employees || []) if (e.userId) m.set(e.userId, e)
    return m
  }, [employees])

  // Фильтр + сортировка
  const filtered = useMemo(() => {
    const arr = (kpis || []).slice()
    const group = ROLE_GROUPS.find(g => g.value === filter)
    const filteredList = group && group.roles.length > 0
      ? arr.filter(k => group.roles.includes(k.role))
      : arr
    return filteredList.sort((a, b) => {
      if (a.overallPercent !== b.overallPercent) return b.overallPercent - a.overallPercent
      const an = empByUserId.get(a.userId)?.fullName || ''
      const bn = empByUserId.get(b.userId)?.fullName || ''
      return an.localeCompare(bn, 'ru')
    })
  }, [kpis, filter, empByUserId])

  if (isLoading) {
    return (
      <div className="card">
        <p className="text-xs text-surface-400 animate-pulse">Загрузка KPI команды…</p>
      </div>
    )
  }

  if (!kpis || kpis.length === 0) {
    return null
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-primary-600" />
          <h3 className="section-title">KPI команды</h3>
          <span className="text-xs text-surface-400">{filtered.length}</span>
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

      {/* Фильтр по группе ролей */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {ROLE_GROUPS.map(g => (
          <button
            key={g.value}
            onClick={() => setFilter(g.value)}
            className={clsx(
              'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
              filter === g.value
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-surface-400 py-4 text-center">Нет сотрудников в этой группе</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(row => {
            const emp = empByUserId.get(row.userId)
            return (
              <Link
                key={row.userId}
                to={emp?.id ? `/employees/${emp.id}` : '#'}
                className="flex items-start gap-3 p-3 rounded-xl border border-surface-100 dark:border-surface-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors"
              >
                <Avatar name={emp?.fullName || 'Сотрудник'} src={emp?.avatar} size={40} />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-surface-900 dark:text-surface-100 truncate">
                        {emp?.fullName || 'Сотрудник'}
                      </p>
                      <p className="text-[11px] text-surface-500 dark:text-surface-400 truncate">
                        {ROLE_LABEL[row.role] || row.role}
                        {emp?.position && ` · ${emp.position}`}
                      </p>
                    </div>
                    <ArrowRight size={14} className="text-surface-400 shrink-0" />
                  </div>
                  <EmployeeKpiCard userId={row.userId} compact kpi={row} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
