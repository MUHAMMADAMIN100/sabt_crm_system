import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi } from '@/services/api.service'
import { StatCard, PageLoader, Avatar } from '@/components/ui'
import {
  FolderKanban, Users, AlertTriangle, TrendingDown,
  UserX, Activity, Clock,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

/**
 * Панель основателя — только лаконичная ВЫЖИМКА. Подробности (финансы, KPI
 * всех сотрудников, истории, графики) живут на своих страницах: Финансы,
 * Сотрудники, Аналитика, Риски. Здесь — пульс компании одним взглядом.
 */
export default function FounderDashboard() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: analyticsApi.overview,
  })
  const { data: workload } = useQuery({
    queryKey: ['employee-workload'],
    queryFn: analyticsApi.employeeWorkload,
  })
  const { data: avgCompletion } = useQuery({
    queryKey: ['avg-completion'],
    queryFn: analyticsApi.avgCompletion,
  })

  if (isLoading) return <PageLoader />

  const inactiveEmployees = (workload || []).filter((e: any) => e.activeTasks === 0)
  const overloadedPMs = (workload || []).filter((e: any) => e.activeTasks >= 10)

  return (
    <div className="space-y-6">
      {/* Пульс компании — 3 ключевых числа */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Активных проектов"
          value={overview?.activeProjects ?? 0}
          icon={FolderKanban}
          color="bg-primary-600"
          sub={`из ${overview?.totalProjects ?? 0} всего`}
        />
        <StatCard
          title="Сотрудников"
          value={overview?.totalEmployees ?? 0}
          icon={Users}
          color="bg-surface-500"
          sub={`${inactiveEmployees.length} неактивных`}
        />
        <StatCard
          title="Среднее время закрытия"
          value={avgCompletion ? `${avgCompletion.avgDays}д` : '—'}
          icon={Clock}
          color="bg-surface-500"
          sub={avgCompletion ? `${avgCompletion.totalDone} задач закрыто` : 'нет данных'}
        />
      </div>

      {/* Требует внимания — люди */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Люди: неактивные + перегруженные */}
        <>
          <div className="card">
            <h3 className="font-semibold text-sm text-surface-900 dark:text-surface-100 mb-3 flex items-center gap-2">
              <UserX size={14} className="text-surface-500" /> Неактивные сегодня
            </h3>
            {inactiveEmployees.length === 0 ? (
              <p className="text-xs text-green-600 dark:text-green-400">Все активны ✓</p>
            ) : (
              <div className="space-y-2">
                {inactiveEmployees.slice(0, 6).map((e: any) => (
                  <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-2 hover:opacity-80">
                    <Avatar name={e.name} src={e.avatar} size={24} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">{e.name}</p>
                      <p className="text-[10px] text-surface-400 dark:text-surface-500 truncate">{e.position}</p>
                    </div>
                    <span className="text-[10px] text-surface-500 font-semibold">{e.activeTasks} задач</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {overloadedPMs.length > 0 && (
            <div className="card border-surface-100 dark:border-surface-900/30">
              <h3 className="font-semibold text-sm text-surface-700 dark:text-surface-400 mb-3 flex items-center gap-2">
                <Activity size={14} /> Перегруженные
              </h3>
              <div className="space-y-2">
                {overloadedPMs.slice(0, 4).map((e: any) => (
                  <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-2 hover:opacity-80">
                    <Avatar name={e.name} src={e.avatar} size={24} />
                    <span className="text-xs text-surface-800 dark:text-surface-200 flex-1 truncate">{e.name}</span>
                    <span className="text-xs font-bold text-surface-600">{e.activeTasks}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      </div>
    </div>
  )
}
