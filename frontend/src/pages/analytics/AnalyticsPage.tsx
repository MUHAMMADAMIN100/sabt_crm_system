import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsApi, tasksApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { PageLoader, StatCard, ProgressBar, Avatar, StatusBadge, PriorityBadge } from '@/components/ui'
import StoryCalendar from '@/components/stories/StoryCalendar'
import { FolderKanban, CheckSquare, Users, Clock, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts'

const COLORS = ['#4f6ef7', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4']

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const { data: overview, isLoading } = useQuery({ queryKey: ['overview'], queryFn: analyticsApi.overview })
  const { data: projByStatus } = useQuery({ queryKey: ['proj-status'], queryFn: analyticsApi.projectsByStatus })
  const { data: taskByStatus } = useQuery({ queryKey: ['task-status'], queryFn: analyticsApi.tasksByStatus })
  const { data: taskByPriority } = useQuery({ queryKey: ['task-priority'], queryFn: analyticsApi.tasksByPriority })
  const { data: empActivity } = useQuery({ queryKey: ['emp-activity'], queryFn: () => analyticsApi.employeeActivity() })
  const { data: hoursData } = useQuery({ queryKey: ['hours-30'], queryFn: () => analyticsApi.hoursPerDay({ days: 30 }) })
  const { data: projPerf } = useQuery({ queryKey: ['proj-perf'], queryFn: analyticsApi.projectsPerformance })
  const { data: empEff } = useQuery({ queryKey: ['emp-eff'], queryFn: analyticsApi.employeeEfficiency })
  const { data: allTasks } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })
  const { data: employeesList } = useQuery({ queryKey: ['employees'], queryFn: () => import('@/services/api.service').then(m => m.employeesApi.list()) })

  if (isLoading) return <PageLoader />

  // Group tasks by employee
  const tasksByEmployee: Record<string, any[]> = {}
  allTasks?.forEach((task: any) => {
    if (task.assignee) {
      const key = task.assignee.id || task.assigneeId
      if (!tasksByEmployee[key]) tasksByEmployee[key] = []
      tasksByEmployee[key].push(task)
    }
  })

  const getLabel = (key: string) => {
    const r = t(`statuses.${key}`)
    if (r !== `statuses.${key}`) return r
    const p = t(`priorities.${key}`)
    if (p !== `priorities.${key}`) return p
    return key
  }

  const formatData = (arr: any[]) => arr?.map(d => ({ ...d, name: getLabel(d.status || d.priority), value: parseInt(d.count) })) || []

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t('analytics.title')}</h1>

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={t('dashboard.activeProjectsCount')} value={overview.activeProjects} icon={FolderKanban} color="bg-primary-600" sub={`${t('common.from')} ${overview.totalProjects}`} />
          <StatCard title={t('common.completed')} value={`${overview.completionRate}%`} icon={CheckSquare} color="bg-green-500" sub={`${overview.doneTasks} ${t('common.from')} ${overview.totalTasks}`} />
          <StatCard title={t('dashboard.urgent')} value={overview.overdueTasks} icon={TrendingUp} color="bg-red-500" />
          <StatCard title={t('dashboard.hoursThisMonth')} value={overview.hoursThisMonth?.toFixed(0)} icon={Clock} color="bg-purple-500" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {projByStatus && (
          <div className="card">
            <h3 className="section-title mb-4">{t('analytics.projectsByStatus')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={formatData(projByStatus)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                  {projByStatus.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {taskByStatus && (
          <div className="card">
            <h3 className="section-title mb-4">{t('analytics.tasksByStatus')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={formatData(taskByStatus)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {taskByStatus.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {hoursData?.length > 0 && (
          <div className="card lg:col-span-2">
            <h3 className="section-title mb-4">{t('analytics.hoursPerDay')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={hoursData}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f6ef7" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#4f6ef7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d?.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}${t('dashboard.hours')}`]} />
                <Area type="monotone" dataKey="hours" stroke="#4f6ef7" fill="url(#grad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {empActivity?.length > 0 && (
          <div className="card">
            <h3 className="section-title mb-4">{t('analytics.employeeActivity')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={empActivity.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}ч`, t('dashboard.hours')]} />
                <Bar dataKey="totalHours" fill="#4f6ef7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {taskByPriority && (
          <div className="card">
            <h3 className="section-title mb-4">{t('analytics.tasksByPriority')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={formatData(taskByPriority)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                  {taskByPriority.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {projPerf?.length > 0 && (
        <div className="card">
          <h3 className="section-title mb-4">{t('analytics.performance')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 dark:border-surface-700">
                  <th className="text-left py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">{t('projects.name')}</th>
                  <th className="text-left py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">{t('common.status')}</th>
                  <th className="text-right py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">{t('tasks.title')}</th>
                  <th className="text-right py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">{t('common.completed')}</th>
                  <th className="text-right py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">{t('projects.progress')}</th>
                </tr>
              </thead>
              <tbody>
                {projPerf.map((p: any) => (
                  <tr key={p.id} className="border-b border-surface-50 dark:border-surface-700">
                    <td className="py-2 px-3 font-medium text-surface-900 dark:text-surface-100">{p.name}</td>
                    <td className="py-2 px-3"><span className={`badge status-${p.status}`}>{getLabel(p.status)}</span></td>
                    <td className="py-2 px-3 text-right text-surface-700 dark:text-surface-300">{p.taskCount}</td>
                    <td className="py-2 px-3 text-right text-green-600 dark:text-green-400">{p.doneTasks}</td>
                    <td className="py-2 px-3 text-right font-semibold text-surface-900 dark:text-surface-100">{p.progress}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {empEff?.length > 0 && (
        <div className="card">
          <h3 className="section-title mb-4">{t('analytics.employeeActivity')}</h3>
          <div className="space-y-2">
            {empEff.map((e: any) => {
              const pct = e.totalTasks > 0 ? Math.round((e.doneTasks / e.totalTasks) * 100) : 0
              const isExpanded = expandedEmp === e.id
              const empTasks = tasksByEmployee[e.id] || []
              return (
                <div key={e.id} className="border border-surface-100 dark:border-surface-700 rounded-xl overflow-hidden">
                  <button onClick={() => setExpandedEmp(isExpanded ? null : e.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors text-left">
                    {isExpanded ? <ChevronDown size={14} className="text-surface-400 shrink-0" /> : <ChevronRight size={14} className="text-surface-400 shrink-0" />}
                    <Avatar name={e.name} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{e.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-surface-500 dark:text-surface-400">{e.totalTasks} {t('tasks.title').toLowerCase()}</span>
                        <span className="text-xs text-green-600 dark:text-green-400">{e.doneTasks} {t('common.completed')}</span>
                        <span className="text-xs text-surface-400 dark:text-surface-500">{parseFloat(e.totalHours || '0').toFixed(1)}ч</span>
                      </div>
                    </div>
                    <div className="w-24 shrink-0">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-surface-500 dark:text-surface-400">{pct}%</span>
                      </div>
                      <ProgressBar value={pct} />
                    </div>
                  </button>
                  {isExpanded && empTasks.length > 0 && (
                    <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/30 p-2 space-y-1">
                      {empTasks.map((task: any) => (
                        <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white dark:hover:bg-surface-700 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                            <p className="text-xs text-surface-400 dark:text-surface-500">{task.project?.name || ''}</p>
                          </div>
                          <PriorityBadge priority={task.priority} />
                          <StatusBadge status={task.status} />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* SMM Stories Tracking for Admin */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <StoryCalendar isAdmin />
        </div>
      </div>
    </div>
  )
}
