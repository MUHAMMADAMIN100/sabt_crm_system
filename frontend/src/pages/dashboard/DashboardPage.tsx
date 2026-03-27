import { useQuery } from '@tanstack/react-query'
import { analyticsApi, tasksApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { StatCard, PageLoader, StatusBadge, PriorityBadge, ProgressBar } from '@/components/ui'
import { FolderKanban, CheckSquare, Users, Clock, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const PIE_COLORS = ['#4f6ef7', '#22c55e', '#f59e0b', '#ef4444', '#a855f7']

export default function DashboardPage() {
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'manager'].includes(user?.role || '')
  const { t } = useTranslation()

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: analyticsApi.overview,
    enabled: isManagerPlus,
  })

  const { data: myTasks } = useQuery({
    queryKey: ['my-tasks'],
    queryFn: tasksApi.my,
  })

  const { data: projects } = useQuery({
    queryKey: ['projects', { status: 'in_progress' }],
    queryFn: () => projectsApi.list({ status: 'in_progress' }),
  })

  const { data: tasksByStatus } = useQuery({
    queryKey: ['tasks-by-status'],
    queryFn: analyticsApi.tasksByStatus,
    enabled: isManagerPlus,
  })

  const { data: hoursData } = useQuery({
    queryKey: ['hours-per-day'],
    queryFn: () => analyticsApi.hoursPerDay({ days: 14 }),
    enabled: isManagerPlus,
  })

  if (isLoading && isManagerPlus) return <PageLoader />

  const urgentTasks = myTasks?.filter((t: any) =>
    t.deadline && new Date(t.deadline) < new Date(Date.now() + 86400000 * 2) && t.status !== 'done'
  ) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          {t('dashboard.greeting')}, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-surface-500 dark:text-surface-400 mt-0.5">
          {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
        </p>
      </div>

      {isManagerPlus && overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={t('dashboard.activeProjectsCount')} value={overview.activeProjects} icon={FolderKanban} color="bg-primary-600" sub={`${t('common.from')} ${overview.totalProjects} ${t('common.total')}`} />
          <StatCard title={t('dashboard.totalTasks')} value={overview.totalTasks} icon={CheckSquare} color="bg-green-500" sub={`${overview.completionRate}% ${t('common.completed')}`} />
          <StatCard title={t('dashboard.employeesCount')} value={overview.totalEmployees} icon={Users} color="bg-amber-500" />
          <StatCard title={t('dashboard.hoursThisMonth')} value={overview.hoursThisMonth?.toFixed(1)} icon={Clock} color="bg-purple-500" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">{t('dashboard.myTasks')}</h2>
            <Link to="/tasks?mine=true" className="text-sm text-primary-600 dark:text-primary-400 hover:underline">{t('common.viewAll')}</Link>
          </div>
          {!myTasks?.length ? (
            <p className="text-surface-500 dark:text-surface-400 text-sm py-8 text-center">{t('dashboard.noTasks')}</p>
          ) : (
            <div className="space-y-2">
              {myTasks.slice(0, 6).map((task: any) => (
                <Link
                  key={task.id}
                  to={`/tasks/${task.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400">{task.title}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{task.project?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityBadge priority={task.priority} />
                    <StatusBadge status={task.status} />
                    {task.deadline && (
                      <span className={`text-xs ${new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>
                        {format(new Date(task.deadline), 'dd.MM')}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {urgentTasks.length > 0 && (
            <div className="card border-orange-100 dark:border-orange-900/30 bg-orange-50 dark:bg-orange-900/10">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-orange-500" />
                <h3 className="font-semibold text-orange-800 dark:text-orange-300 text-sm">{t('dashboard.urgent')}</h3>
              </div>
              <div className="space-y-2">
                {urgentTasks.slice(0, 3).map((ta: any) => (
                  <Link key={ta.id} to={`/tasks/${ta.id}`} className="block text-sm text-orange-700 dark:text-orange-300 hover:underline truncate">
                    • {ta.title}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">{t('dashboard.activeProjects')}</h3>
              <Link to="/projects" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">{t('common.viewAll')}</Link>
            </div>
            <div className="space-y-3">
              {projects?.slice(0, 4).map((p: any) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="block hover:opacity-80">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{p.name}</span>
                    <span className="text-xs text-surface-500 dark:text-surface-400 ml-2 shrink-0">{p.progress}%</span>
                  </div>
                  <ProgressBar value={p.progress} />
                </Link>
              ))}
              {!projects?.length && <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-2">{t('common.noActiveProjects')}</p>}
            </div>
          </div>
        </div>
      </div>

      {isManagerPlus && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {hoursData?.length > 0 && (
            <div className="lg:col-span-2 card">
              <h3 className="section-title mb-4">{t('dashboard.hoursChart')}</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={hoursData}>
                  <defs>
                    <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f6ef7" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#4f6ef7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => format(new Date(d), 'dd.MM')} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}ч`, t('dashboard.hours')]} />
                  <Area type="monotone" dataKey="hours" stroke="#4f6ef7" fill="url(#hoursGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {tasksByStatus?.length > 0 && (
            <div className="card">
              <h3 className="section-title mb-4">{t('dashboard.tasksByStatus')}</h3>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={tasksByStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                    {tasksByStatus.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any, n: any) => [v, t(`statuses.${n}`) !== `statuses.${n}` ? t(`statuses.${n}`) : n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {tasksByStatus.map((s: any, i: number) => (
                  <div key={s.status} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-xs text-surface-500 dark:text-surface-400">{t(`statuses.${s.status}`) !== `statuses.${s.status}` ? t(`statuses.${s.status}`) : s.status} ({s.count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
