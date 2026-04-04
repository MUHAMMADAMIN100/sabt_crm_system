import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi, tasksApi } from '@/services/api.service'
import { StatCard, PageLoader, StatusBadge, Avatar } from '@/components/ui'
import {
  FolderKanban, CheckSquare, Users, AlertTriangle,
  TrendingDown, UserX, Activity,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

export default function FounderDashboard() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: analyticsApi.overview,
  })

  const { data: overdueTasks } = useQuery({
    queryKey: ['tasks-overdue'],
    queryFn: tasksApi.overdue,
  })

  const { data: workload } = useQuery({
    queryKey: ['employee-workload'],
    queryFn: analyticsApi.employeeWorkload,
  })

  const { data: efficiency } = useQuery({
    queryKey: ['employee-efficiency'],
    queryFn: analyticsApi.employeeEfficiency,
  })

  if (isLoading) return <PageLoader />

  const atRiskProjects = overview?.overdueTasks > 0 ? Math.ceil(overview.overdueTasks / 3) : 0
  const inactiveEmployees = (workload || []).filter((e: any) => e.activeTasks === 0)
  const overloadedPMs = (workload || []).filter((e: any) => e.activeTasks >= 10)

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Активных проектов"
          value={overview?.activeProjects ?? 0}
          icon={FolderKanban}
          color="bg-primary-600"
          sub={`из ${overview?.totalProjects ?? 0} всего`}
        />
        <StatCard
          title="Просроченных задач"
          value={overview?.overdueTasks ?? 0}
          icon={TrendingDown}
          color="bg-red-500"
          sub="требуют внимания"
        />
        <StatCard
          title="Сотрудников"
          value={overview?.totalEmployees ?? 0}
          icon={Users}
          color="bg-amber-500"
          sub={`${inactiveEmployees.length} неактивных`}
        />
        <StatCard
          title="Проектов в риске"
          value={atRiskProjects}
          icon={AlertTriangle}
          color="bg-orange-500"
          sub="по просрочкам"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overdue tasks */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title text-red-600 dark:text-red-400 flex items-center gap-2">
              <TrendingDown size={16} /> Просроченные задачи
            </h2>
            <Link to="/tasks?overdue=true" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
              Все
            </Link>
          </div>
          {!overdueTasks?.length ? (
            <p className="text-sm text-green-600 dark:text-green-400 py-4 text-center">Просрочек нет ✓</p>
          ) : (
            <div className="space-y-2">
              {overdueTasks.slice(0, 8).map((t: any) => (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{t.title}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500">{t.project?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.assignee && <Avatar name={t.assignee.name} src={t.assignee.avatar} size={20} />}
                    {t.deadline && (
                      <span className="text-xs text-red-500 font-medium">
                        {format(new Date(t.deadline), 'dd.MM', { locale: ru })}
                      </span>
                    )}
                    <StatusBadge status={t.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Inactive employees */}
          <div className="card">
            <h3 className="font-semibold text-sm text-surface-900 dark:text-surface-100 mb-3 flex items-center gap-2">
              <UserX size={14} className="text-orange-500" /> Неактивные сегодня
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
                    <span className="text-[10px] text-orange-500 font-semibold">{e.activeTasks} задач</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Overloaded */}
          {overloadedPMs.length > 0 && (
            <div className="card border-orange-100 dark:border-orange-900/30">
              <h3 className="font-semibold text-sm text-orange-700 dark:text-orange-400 mb-3 flex items-center gap-2">
                <Activity size={14} /> Перегруженные
              </h3>
              <div className="space-y-2">
                {overloadedPMs.slice(0, 4).map((e: any) => (
                  <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-2 hover:opacity-80">
                    <Avatar name={e.name} src={e.avatar} size={24} />
                    <span className="text-xs text-surface-800 dark:text-surface-200 flex-1 truncate">{e.name}</span>
                    <span className="text-xs font-bold text-orange-600">{e.activeTasks}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Employee efficiency table */}
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <CheckSquare size={16} /> Эффективность сотрудников
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                <th className="pb-2 font-medium">Сотрудник</th>
                <th className="pb-2 font-medium text-right">Выполнено</th>
                <th className="pb-2 font-medium text-right">Всего</th>
                <th className="pb-2 font-medium text-right">Часов</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-surface-800">
              {(efficiency?.data || []).slice(0, 10).map((e: any) => (
                <tr key={e.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors">
                  <td className="py-2">
                    <Link to={`/employees/${e.id}`} className="flex items-center gap-2">
                      <Avatar name={e.name} size={24} />
                      <div>
                        <p className="font-medium text-surface-900 dark:text-surface-100">{e.name}</p>
                        <p className="text-[10px] text-surface-400">{e.position}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="py-2 text-right font-semibold text-green-600 dark:text-green-400">{e.doneTasks}</td>
                  <td className="py-2 text-right text-surface-500">{e.totalTasks}</td>
                  <td className="py-2 text-right text-surface-500">{e.totalHours?.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
