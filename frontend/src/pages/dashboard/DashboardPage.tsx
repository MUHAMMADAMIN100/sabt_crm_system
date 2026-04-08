import { useQuery } from '@tanstack/react-query'
import { useMemo, lazy, Suspense } from 'react'
import { analyticsApi, tasksApi, projectsApi, storiesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { StatCard, PageLoader, StatusBadge, PriorityBadge, ProgressBar, Avatar } from '@/components/ui'
import { FolderKanban, CheckSquare, Users, Clock, AlertTriangle, TrendingDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const FounderDashboard = lazy(() => import('./components/FounderDashboard'))
const PMDashboard = lazy(() => import('./components/PMDashboard'))
const SMMDashboard = lazy(() => import('./components/SMMDashboard'))

const PIE_COLORS = ['#6B4FCF', '#22c55e', '#f59e0b', '#ef4444', '#a855f7']

// ── Helpers for story dot colors ──────────────────────────────────
function storyDotColor(index: number, count: number) {
  if (index > count) return 'bg-surface-200 dark:bg-surface-600'
  if (count === 1) return 'bg-pink-400'
  if (count === 2) return 'bg-yellow-400'
  return 'bg-green-500'
}

// ── Stories widget ────────────────────────────────────────────────
function StoriesWidget({ myProjects, todayStoryMap, monthTotalActual, monthTotalExpected, monthPct, daysElapsed }: {
  myProjects: any[]
  todayStoryMap: Record<string, number>
  monthTotalActual: number
  monthTotalExpected: number
  monthPct: number
  daysElapsed: number
}) {
  const todayDone = myProjects.filter(p => (todayStoryMap[p.id] || 0) >= 3).length
  const allDoneToday = myProjects.length > 0 && todayDone === myProjects.length

  return (
    <div className="card animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">📸</span>
          <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">Истории сегодня</h3>
        </div>
        {myProjects.length > 0 && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            allDoneToday
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400'
          }`}>
            {todayDone}/{myProjects.length} проектов
          </span>
        )}
      </div>

      {myProjects.length === 0 ? (
        <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-3">Нет активных проектов</p>
      ) : (
        <div className="space-y-2">
          {myProjects.map((project: any) => {
            const count = todayStoryMap[project.id] || 0
            const done = count >= 3
            return (
              <div key={project.id} className="flex items-center gap-2 group">
                <div
                  className="w-2 h-2 rounded-full shrink-0 transition-transform duration-150 group-hover:scale-125"
                  style={{ backgroundColor: project.color || '#6B4FCF' }}
                />
                <p className="text-xs font-medium text-surface-800 dark:text-surface-200 flex-1 truncate">
                  {project.name}
                </p>
                {/* 3 dots */}
                <div className="flex gap-1 shrink-0">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${storyDotColor(i, count)}`}
                    />
                  ))}
                </div>
                {/* Status */}
                {done ? (
                  <span className="text-[10px] font-bold text-green-600 dark:text-green-400 shrink-0 w-6 text-right">✓</span>
                ) : (
                  <span className={`text-[10px] font-semibold shrink-0 w-6 text-right ${
                    count === 0 ? 'text-red-500 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'
                  }`}>{count}/3</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Monthly summary */}
      {myProjects.length > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-surface-400 dark:text-surface-500">За месяц</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-bold ${
                monthPct >= 80 ? 'text-green-600 dark:text-green-400'
                : monthPct >= 50 ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-500 dark:text-red-400'
              }`}>{monthPct}%</span>
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {monthTotalActual}/{monthTotalExpected}
              </span>
            </div>
          </div>
          <ProgressBar value={monthPct} />
          <p className="text-[10px] text-surface-400 dark:text-surface-500">
            {daysElapsed} {daysElapsed === 1 ? 'день' : daysElapsed < 5 ? 'дня' : 'дней'} •{' '}
            {myProjects.length} {myProjects.length === 1 ? 'проект' : myProjects.length < 5 ? 'проекта' : 'проектов'} •{' '}
            план 3 истории/день
          </p>
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const user = useAuthStore(s => s.user)
  const role = user?.role || 'employee'
  const isFounderView = ['admin', 'founder'].includes(role)
  const isPMView = role === 'project_manager'
  const isWorkerView = ['smm_specialist', 'designer', 'marketer', 'targetologist', 'sales_manager'].includes(role)
  const isManagerPlus = ['admin', 'founder', 'project_manager'].includes(role)
  const isAdmin = role === 'admin'
  const { t } = useTranslation()

  // Role-specific dashboards
  if (isFounderView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Привет, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5">
            {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <Suspense fallback={<PageLoader />}>
          <FounderDashboard />
        </Suspense>
      </div>
    )
  }

  if (isPMView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Привет, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5">
            {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <Suspense fallback={<PageLoader />}>
          <PMDashboard />
        </Suspense>
      </div>
    )
  }

  if (isWorkerView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Привет, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5">
            {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <Suspense fallback={<PageLoader />}>
          <SMMDashboard />
        </Suspense>
      </div>
    )
  }

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


  const { data: allProjects } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectsApi.list(),
    enabled: isAdmin,
  })

  // ── Employee stories queries ──────────────────────────────────────
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  const { data: todayStories } = useQuery({
    queryKey: ['stories-today', today],
    queryFn: () => storiesApi.my(today, today),
    enabled: !isAdmin,
  })

  const { data: monthStories } = useQuery({
    queryKey: ['stories-month', monthStart, today],
    queryFn: () => storiesApi.my(monthStart, today),
    enabled: !isAdmin,
  })

  const { data: allProjectsList } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    enabled: !isAdmin,
  })

  // ── Employee story analytics (hooks must be before any early return) ──
  const myProjects = useMemo(() =>
    (allProjectsList || []).filter((p: any) =>
      !p.isArchived &&
      p.status !== 'completed' &&
      p.members?.some((m: any) => m.id === user?.id)
    ), [allProjectsList, user])

  const todayStoryMap = useMemo(() => {
    const map: Record<string, number> = {}
    ;(todayStories || []).forEach((s: any) => {
      map[s.projectId] = (map[s.projectId] || 0) + (s.storiesCount || s.count || 0)
    })
    return map
  }, [todayStories])

  const monthTotalActual = useMemo(() =>
    (monthStories || []).reduce((sum: number, s: any) => sum + (s.storiesCount || s.count || 0), 0),
    [monthStories])

  // ── Early return after all hooks ──────────────────────────────────
  if (isLoading && isManagerPlus) return <PageLoader />

  const urgentTasks = myTasks?.filter((t: any) =>
    t.deadline && new Date(t.deadline) < new Date(Date.now() + 86400000 * 2) && t.status !== 'done'
  ) || []

  const overdueTasks = myTasks?.filter((t: any) =>
    t.deadline && new Date(t.deadline) < new Date() && t.status !== 'done' && t.status !== 'cancelled'
  ) || []

  const daysElapsed = new Date().getDate()
  const monthTotalExpected = myProjects.length * daysElapsed * 3
  const monthPct = monthTotalExpected > 0 ? Math.min(100, Math.round((monthTotalActual / monthTotalExpected) * 100)) : 0

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
        </div>
      )}

      {/* Admin: project status breakdown */}
      {isAdmin && projectsByStatus && allProjects && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card text-center cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-3xl font-bold text-primary-600 dark:text-primary-400">{projectsByStatus.planning}</p>
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
                    {p.members?.length > 0 ? (
                      <div className="flex -space-x-2 shrink-0">
                        {p.members.slice(0, 3).map((m: any) => (
                          <div key={m.id} className="ring-2 ring-white dark:ring-surface-800 rounded-full">
                            <Avatar name={m.name} src={m.avatar} size={24} />
                          </div>
                        ))}
                        {p.members.length > 3 && (
                          <div className="w-6 h-6 rounded-full bg-surface-200 dark:bg-surface-600 ring-2 ring-white dark:ring-surface-800 flex items-center justify-center text-[9px] font-semibold text-surface-600 dark:text-surface-300 shrink-0">
                            +{p.members.length - 3}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color || '#6B4FCF' }} />
                    )}
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
              <div className="space-y-1">
                {myTasks.slice(0, 6).map((task: any) => (
                  <Link
                    key={task.id}
                    to={`/tasks/${task.id}`}
                    className="block p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 min-w-0 flex-1 leading-snug">{task.title}</p>
                      {task.deadline && (
                        <span className={`text-xs shrink-0 ${new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>
                          {format(new Date(task.deadline), 'dd.MM')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PriorityBadge priority={task.priority} />
                      <StatusBadge status={task.status} />
                      {task.project?.name && (
                        <span className="text-xs text-surface-400 dark:text-surface-500 truncate">{task.project.name}</span>
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

          {/* ── Stories analytics ── */}
          {!isAdmin && (
            <StoriesWidget
              myProjects={myProjects}
              todayStoryMap={todayStoryMap}
              monthTotalActual={monthTotalActual}
              monthTotalExpected={monthTotalExpected}
              monthPct={monthPct}
              daysElapsed={daysElapsed}
            />
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">{t('dashboard.activeProjects')}</h3>
              <Link to="/projects" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">{t('common.viewAll')}</Link>
            </div>
            <div className="space-y-3">
              {projects?.slice(0, 4).map((p: any) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="block hover:opacity-80">
                  <div className="flex items-center gap-2 mb-1">
                    {p.members?.length > 0 ? (
                      <div className="flex -space-x-1.5 shrink-0">
                        {p.members.slice(0, 2).map((m: any) => (
                          <div key={m.id} className="ring-1 ring-white dark:ring-surface-800 rounded-full">
                            <Avatar name={m.name} src={m.avatar} size={20} />
                          </div>
                        ))}
                        {p.members.length > 2 && (
                          <div className="w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-600 ring-1 ring-white dark:ring-surface-800 flex items-center justify-center text-[8px] font-semibold text-surface-600 dark:text-surface-300 shrink-0">
                            +{p.members.length - 2}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color || '#6B4FCF' }} />
                    )}
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate flex-1">{p.name}</span>
                    <span className="text-xs text-surface-500 dark:text-surface-400 shrink-0">{p.progress}%</span>
                  </div>
                  <ProgressBar value={p.progress} />
                </Link>
              ))}
              {!projects?.length && <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-2">{t('common.noActiveProjects')}</p>}
            </div>
          </div>
        </div>
      </div>

      {isManagerPlus && tasksByStatus?.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="card">
              <h3 className="section-title mb-4">{t('dashboard.tasksByStatus')}</h3>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={tasksByStatus.map((s: any) => ({ ...s, count: Number(s.count) }))} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
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
        </div>
      )}
    </div>
  )
}
