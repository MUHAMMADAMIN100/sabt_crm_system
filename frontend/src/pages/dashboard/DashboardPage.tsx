import { useQuery } from '@tanstack/react-query'
import { analyticsApi, tasksApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { StatCard, PageLoader, StatusBadge, PriorityBadge, ProgressBar } from '@/components/ui'
import { FolderKanban, CheckSquare, Users, Clock, AlertTriangle, TrendingDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const PIE_COLORS = ['#4f6ef7', '#22c55e', '#f59e0b', '#ef4444', '#a855f7']

export default function DashboardPage() {
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'manager'].includes(user?.role || '')
  const isAdmin = user?.role === 'admin'
  const { t } = useTranslation()

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: analyticsApi.overview,
    enabled: isManagerPlus,
  })

  const { data: myTasks } = useQuery({
    queryKey: ['my-tasks'],
    queryFn: tasksApi.my,
    enabled: !isAdmin,
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

  const { data: allProjects } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectsApi.list(),
    enabled: isAdmin,
  })

  if (isLoading && isManagerPlus) return <PageLoader />

  const urgentTasks = myTasks?.filter((t: any) =>
    t.deadline && new Date(t.deadline) < new Date(Date.now() + 86400000 * 2) && t.status !== 'done'
  ) || []

  // Overdue tasks for employee
  const overdueTasks = myTasks?.filter((t: any) =>
    t.deadline && new Date(t.deadline) < new Date() && t.status !== 'done' && t.status !== 'cancelled'
  ) || []

  // Admin stats
  const projectsByStatus = allProjects ? {
    planning: allProjects.filter((p: any) => p.status === 'planning').length,
    in_progress: allProjects.filter((p: any) => p.status === 'in_progress').length,
    completed: allProjects.filter((p: any) => p.status === 'completed').length,
    on_hold: allProjects.filter((p: any) => p.status === 'on_hold').length,
  } : null

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

      {/* Admin: project status breakdown */}
      {isAdmin && projectsByStatus && allProjects && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card text-center cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{projectsByStatus.planning}</p>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Планируется</p>
          </div>
          <div className="card text-center cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{projectsByStatus.in_progress}</p>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">В работе</p>
          </div>
          <div className="card text-center cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{projectsByStatus.completed}</p>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Завершено</p>
          </div>
          <div className="card text-center cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{projectsByStatus.on_hold}</p>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">На паузе</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Admin: Active projects with progress */}
        {isAdmin && (
          <div className="lg:col-span-2 card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Активные проекты</h2>
              <Link to="/projects" className="text-sm text-primary-600 dark:text-primary-400 hover:underline">{t('common.viewAll')}</Link>
            </div>
            {!projects?.length ? (
              <p className="text-surface-500 dark:text-surface-400 text-sm py-8 text-center">Нет активных проектов</p>
            ) : (
              <div className="space-y-3">
                {projects.slice(0, 6).map((p: any) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors group">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color || '#4f6ef7' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400">{p.name}</p>
                      <ProgressBar value={p.progress} className="mt-1" />
                    </div>
                    <span className="text-xs font-semibold text-surface-600 dark:text-surface-300 shrink-0">{p.progress}%</span>
                    <span className="text-xs text-surface-400 dark:text-surface-500 shrink-0">
                      {p.tasks?.length || 0} задач
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Employee: My tasks */}
        {!isAdmin && (
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
        )}

        <div className="space-y-4">
          {/* Employee: Overdue tasks warning */}
          {!isAdmin && overdueTasks.length > 0 && (
            <div className="card border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={16} className="text-red-500" />
                <h3 className="font-semibold text-red-800 dark:text-red-300 text-sm">Задачи отстают</h3>
              </div>
              <div className="space-y-2">
                {overdueTasks.slice(0, 4).map((ta: any) => (
                  <Link key={ta.id} to={`/tasks/${ta.id}`} className="flex items-center gap-2 p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-700 dark:text-red-300 truncate">• {ta.title}</p>
                      {ta.deadline && <p className="text-[10px] text-red-500 dark:text-red-400">Дедлайн: {format(new Date(ta.deadline), 'dd.MM.yyyy')}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {urgentTasks.length > 0 && !isAdmin && (
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
