import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsApi, tasksApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatCard, ProgressBar, Avatar, StatusBadge, PriorityBadge, CollapsibleSection } from '@/components/ui'
import { FolderKanban, CheckSquare, Clock, TrendingUp, ChevronDown, ChevronRight, AlertTriangle, Zap } from 'lucide-react'
import clsx from 'clsx'
import {
  FounderAnalyticsSection, TeamAnalyticsSection, SmmAnalyticsSection,
  FinanceAnalyticsSection, RiskAnalyticsSection, TariffAnalyticsSection,
} from './AnalyticsSections'
import StoryCalendar from '@/components/stories/StoryCalendar'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts'

const COLORS = ['#6B4FCF', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4']

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const isHeadSMM = user?.role === 'head_smm'
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [expandedWorkload, setExpandedWorkload] = useState<string | null>(null)
  // Wave 19: расщепление /analytics на 6 секций (TZ п.13)
  const [section, setSection] = useState<'all' | 'founder' | 'team' | 'smm' | 'finance' | 'risk' | 'tariff'>('all')

  // Single combined request instead of 9 separate ones
  const { data: dash, isLoading } = useQuery({ queryKey: ['analytics-dashboard'], queryFn: analyticsApi.dashboard })
  const { data: allTasks } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })
  const { data: employeesList } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })
  const { data: workload } = useQuery({ queryKey: ['analytics-workload'], queryFn: analyticsApi.employeeWorkload })

  const overview = dash?.overview
  const projByStatus = dash?.projByStatus
  const taskByStatus = dash?.taskByStatus
  const taskByPriority = dash?.taskByPriority
  const empActivity = dash?.empActivity
  const hoursData = dash?.hoursPerDay
  const projPerf = dash?.projPerf
  const empEff = dash?.empEff

  if (isLoading) return <PageLoader />

  const smmPositions = ['SMM специалист', 'Главный SMM специалист']
  const smmRoles = ['smm_specialist', 'head_smm']
  const isSMMEmployee = (emp: any) => smmRoles.includes(emp?.user?.role || emp?.role || '') || smmPositions.includes(emp?.position || '')

  // Filter workload & efficiency for head_smm — include both position and role check
  const filteredWorkload = isHeadSMM
    ? (workload || []).filter((e: any) => smmPositions.includes(e.position || '') || smmRoles.includes(e.role || ''))
    : workload
  const filteredEmpEff = isHeadSMM
    ? (empEff || []).filter((e: any) => smmPositions.includes(e.position || '') || smmRoles.includes(e.role || ''))
    : empEff

  // Group tasks by employee (filter to SMM projects for head_smm)
  const tasksByEmployee: Record<string, any[]> = {}
  allTasks?.forEach((task: any) => {
    if (isHeadSMM && task.project?.projectType !== 'SMM') return
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

      {/* Wave 19: section tabs */}
      <div className="flex gap-1 border-b border-surface-100 dark:border-surface-700 overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
        {(['all', 'founder', 'team', 'smm', 'finance', 'risk', 'tariff'] as const).map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              section === s ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                            : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300')}>
            {s === 'all' ? 'Общая' : s === 'founder' ? 'Founder' : s === 'team' ? 'Команда' : s === 'smm' ? 'SMM' : s === 'finance' ? 'Финансы' : s === 'risk' ? 'Риски' : 'Тарифы'}
          </button>
        ))}
      </div>

      {section === 'founder' && <FounderAnalyticsSection />}
      {section === 'team'    && <TeamAnalyticsSection />}
      {section === 'smm'     && <SmmAnalyticsSection />}
      {section === 'finance' && <FinanceAnalyticsSection />}
      {section === 'risk'    && <RiskAnalyticsSection />}
      {section === 'tariff'  && <TariffAnalyticsSection />}

      {section === 'all' && <>

      {overview && (
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard title={t('dashboard.activeProjectsCount')} value={overview.activeProjects} icon={FolderKanban} color="bg-primary-600" sub={`${t('common.from')} ${overview.totalProjects}`} />
          <StatCard title={t('common.completed')} value={`${overview.completionRate}%`} icon={CheckSquare} color="bg-green-500" sub={`${overview.doneTasks} ${t('common.from')} ${overview.totalTasks}`} />
          <StatCard title={t('dashboard.urgent')} value={overview.overdueTasks} icon={TrendingUp} color="bg-red-500" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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


        {empActivity?.length > 0 && (
          <div className="card">
            <h3 className="section-title mb-4">{t('analytics.employeeActivity')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={empActivity.slice(0, 8).map((e: any) => ({ ...e, totalMinutes: Math.round((e.totalHours || 0) * 60) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} unit="м" />
                <Tooltip formatter={(v: any) => [`${v} мин`, 'Минуты']} />
                <Bar dataKey="totalMinutes" fill="#6B4FCF" radius={[6, 6, 0, 0]} />
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
        <CollapsibleSection
          id="analytics-performance"
          title={<h3 className="section-title">{t('analytics.performance')}</h3>}
        >
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
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        {p.members?.length > 0 && (
                          <div className="flex -space-x-1.5 shrink-0">
                            {p.members.slice(0, 4).map((m: any) => (
                              <div key={m.id} title={m.name} className="shrink-0">
                                <Avatar name={m.name} src={m.avatar} size={24} />
                              </div>
                            ))}
                            {p.members.length > 4 && (
                              <div className="w-6 h-6 rounded-full bg-surface-200 dark:bg-surface-600 flex items-center justify-center text-[10px] font-semibold text-surface-600 dark:text-surface-300 border border-white dark:border-surface-800 shrink-0">
                                +{p.members.length - 4}
                              </div>
                            )}
                          </div>
                        )}
                        <span className="font-medium text-surface-900 dark:text-surface-100">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3"><span className={`badge status-${p.status}`}>{getLabel(p.status)}</span></td>
                    <td className="py-2 px-3 text-right text-surface-700 dark:text-surface-300">{p.taskCount}</td>
                    <td className="py-2 px-3 text-right text-green-600 dark:text-green-400">{p.doneTasks}</td>
                    <td className="py-2 px-3 text-right font-semibold text-surface-900 dark:text-surface-100">{p.progress}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      {filteredWorkload && filteredWorkload.length > 0 && (
        <CollapsibleSection
          id="analytics-workload"
          title={<h3 className="section-title">Загруженность сотрудников</h3>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 dark:border-surface-700">
                  <th className="text-left py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">Сотрудник</th>
                  <th className="text-left py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold hidden md:table-cell">Отдел</th>
                  <th className="text-center py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">Активных задач</th>
                  <th className="text-center py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">
                    <span className="flex items-center justify-center gap-1"><Zap size={11} className="text-amber-500" /> Критичных</span>
                  </th>
                  <th className="text-center py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold">
                    <span className="flex items-center justify-center gap-1"><AlertTriangle size={11} className="text-red-500" /> Просрочено</span>
                  </th>
                  <th className="text-left py-2 px-3 text-xs text-surface-500 dark:text-surface-400 font-semibold hidden lg:table-cell">Нагрузка</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkload.map((e: any) => {
                  const maxTasks = Math.max(...filteredWorkload.map((w: any) => w.activeTasks), 1)
                  const pct = Math.round((e.activeTasks / maxTasks) * 100)
                  const loadColor = e.activeTasks >= 10 ? 'bg-red-500' : e.activeTasks >= 5 ? 'bg-amber-500' : 'bg-emerald-500'
                  const isExpanded = expandedWorkload === e.id
                  const empTasks = tasksByEmployee[e.userId] || tasksByEmployee[e.id] || []
                  return (
                    <React.Fragment key={e.id}>
                      <tr onClick={() => setExpandedWorkload(isExpanded ? null : e.id)}
                        className="border-b border-surface-50 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors cursor-pointer">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={13} className="text-surface-400 shrink-0" /> : <ChevronRight size={13} className="text-surface-400 shrink-0" />}
                            <Avatar name={e.name} src={e.avatar} size={28} />
                            <div>
                              <p className="font-medium text-surface-900 dark:text-surface-100 text-xs">{e.name}</p>
                              {e.position && <p className="text-[10px] text-surface-400 dark:text-surface-500">{e.position}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 hidden md:table-cell text-xs text-surface-500 dark:text-surface-400">{e.department || '—'}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold ${e.activeTasks >= 10 ? 'bg-red-500' : e.activeTasks >= 5 ? 'bg-amber-500' : 'bg-primary-600'}`}>
                            {e.activeTasks}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center text-xs font-semibold text-amber-600 dark:text-amber-400">
                          {e.criticalTasks > 0 ? e.criticalTasks : <span className="text-surface-300 dark:text-surface-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center text-xs font-semibold text-red-600 dark:text-red-400">
                          {e.overdueTasks > 0 ? e.overdueTasks : <span className="text-surface-300 dark:text-surface-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 hidden lg:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${loadColor} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-surface-400 dark:text-surface-500 w-7 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-surface-100 dark:border-surface-700">
                          <td colSpan={6} className="px-3 py-2 bg-surface-50/60 dark:bg-surface-800/40">
                            {empTasks.length === 0 ? (
                              <p className="text-xs text-surface-400 dark:text-surface-500 py-1 pl-10">Нет активных задач</p>
                            ) : (
                              <div className="space-y-1 pl-10">
                                {empTasks.map((task: any) => {
                                  const statusPct: Record<string, number> = { new: 0, in_progress: 50, review: 80, done: 100, cancelled: 0 }
                                  const taskPct = task.estimatedHours > 0
                                    ? Math.min(100, Math.round((task.loggedHours / task.estimatedHours) * 100))
                                    : (statusPct[task.status] ?? 0)
                                  const barColor = taskPct >= 100 ? 'bg-green-500' : taskPct >= 50 ? 'bg-primary-500' : 'bg-amber-400'
                                  return (
                                    <div key={task.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700/40">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2 mb-0.5">
                                          <p className="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                                          <span className="text-[10px] text-surface-400 dark:text-surface-500 shrink-0">{taskPct}%</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="flex-1 h-1 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${taskPct}%` }} />
                                          </div>
                                          {task.project?.name && <p className="text-[10px] text-surface-400 dark:text-surface-500 truncate max-w-[120px]">{task.project.name}</p>}
                                        </div>
                                      </div>
                                      {task.deadline && (
                                        <span className="text-[10px] text-surface-400 dark:text-surface-500 shrink-0">
                                          {new Date(task.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                                        </span>
                                      )}
                                      <PriorityBadge priority={task.priority} />
                                      <StatusBadge status={task.status} />
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="analytics-stories"
        title={<h3 className="section-title">📸 Истории по проектам</h3>}
        defaultOpen={false}
      >
        <StoryCalendar adminAll />
      </CollapsibleSection>

      {filteredEmpEff?.length > 0 && (
        <CollapsibleSection
          id="analytics-emp-activity"
          title={<h3 className="section-title">{t('analytics.employeeActivity')}</h3>}
        >
          <div className="space-y-2">
            {filteredEmpEff.map((e: any) => {
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
                  {isExpanded && (
                    <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/30 p-2 space-y-2">
                      <StoryCalendar employeeId={e.id} compact />
                      {empTasks.length > 0 && (
                        <div className="space-y-1">
                          {empTasks.map((task: any) => {
                            const selfAssigned = task.createdById === task.assigneeId
                            const creatorName = task.createdBy?.name?.trim().split(' ')[0]
                            return (
                            <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs text-surface-400 dark:text-surface-500">{task.project?.name || ''}</p>
                                  {task.assignee && (
                                    <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1 py-0.5 rounded">
                                      {task.assignee.name?.trim().split(/\s+/).slice(0,2).map((w:string) => w[0]?.toUpperCase()).join('')}
                                    </span>
                                  )}
                                  {(selfAssigned || creatorName) && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                      selfAssigned
                                        ? 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
                                        : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                    }`}>
                                      {selfAssigned ? 'сам' : `от ${creatorName}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <PriorityBadge priority={task.priority} />
                              <StatusBadge status={task.status} />
                            </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}

      </>}
    </div>
  )
}
