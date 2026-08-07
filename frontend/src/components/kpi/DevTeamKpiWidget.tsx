import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { kpiApi, employeesApi, tasksApi, analyticsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { Users, ChevronDown, ChevronRight, AlertTriangle, Plus } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'
import clsx from 'clsx'
import { DEV_TEAM_ROLES, getRoleLabel } from '@/lib/permissions'
import { getTaskStatusLabel, normalizeTaskStatus, isTaskOverdue, STATUS_COLOR_CLASSES } from '@/lib/taskStatus'
import { DEV_STAGES } from '@/pages/workflow/DevProjectsBoard'
import TaskDrawer from '@/components/tasks/TaskDrawer'

type Period = 'today' | 'week' | 'month' | 'prev_month'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Сегодня', week: 'Неделя', month: 'Месяц', prev_month: 'Прошлый месяц',
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
      to: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    }
  }
  if (p === 'prev_month') {
    const prev = subMonths(now, 1)
    return { from: format(startOfMonth(prev), 'yyyy-MM-dd'), to: format(endOfMonth(prev), 'yyyy-MM-dd') }
  }
  return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') }
}

/** Цвет полосы KPI: та же светофорная логика, что на дашборде основателя. */
const barColor = (pct: number) =>
  pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-primary-500' : 'bg-red-500'

/**
 * «Команда разработки» — KPI проект-менеджера, менеджера продаж по разработке
 * и разработчиков в одном месте, с раскрытием: на каком процессе идёт каждая
 * задача (статус, готовность, этап доски «Разработка», дедлайн).
 *
 * Виджет для руководителя направления: данные приходят уже сегментированными
 * (backend/src/common/direction-scope.ts), здесь только представление.
 */
export default function DevTeamKpiWidget({ onCreateTask }: { onCreateTask?: (userId: string) => void }) {
  const [period, setPeriod] = useState<Period>('month')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const range = periodRange(period)

  const { data: kpis } = useQuery<any[]>({
    queryKey: ['kpi-all', period],
    queryFn: () => kpiApi.all(range),
    staleTime: 60_000,
  })
  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
    staleTime: 60_000,
  })
  // Загруженность даёт активные/критичные/просроченные — те же цифры, что в
  // таблице «Загруженность сотрудников», чтобы виджеты не расходились.
  const { data: workload } = useQuery({
    queryKey: ['analytics-workload'],
    queryFn: analyticsApi.employeeWorkload,
    staleTime: 60_000,
  })
  // Задачи нужны для раскрытия «на каком процессе». Список уже отфильтрован
  // бэкендом по направлению.
  const { data: allTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
    staleTime: 30_000,
  })

  const empByUserId = useMemo(() => {
    const m = new Map<string, any>()
    for (const e of employees || []) if (e.userId) m.set(e.userId, e)
    return m
  }, [employees])

  const loadByUserId = useMemo(() => {
    const m = new Map<string, any>()
    for (const w of (workload as any[]) || []) if (w.userId) m.set(w.userId, w)
    return m
  }, [workload])

  const tasksByUser = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const t of (allTasks as any[]) || []) {
      // Личные заметки чужими быть не могут, но подстрахуемся — руководителю
      // в разрезе сотрудника нужны рабочие задачи, а не чьи-то заметки.
      if (t.scope === 'personal') continue
      const ids = new Set<string>()
      if (t.assigneeId) ids.add(t.assigneeId)
      for (const a of t.assignees || []) if (a.userId) ids.add(a.userId)
      for (const id of ids) {
        const arr = m.get(id) || []
        arr.push(t)
        m.set(id, arr)
      }
    }
    return m
  }, [allTasks])

  /** Команда направления: берём из сотрудников, а не из KPI — человек без
   *  задач за период в KPI не приходит, но в команде он есть. */
  const team = useMemo(() => {
    const rows = (employees || [])
      .filter((e: any) => {
        const r = e.user?.role || ''
        const s = e.user?.secondaryRole || ''
        return DEV_TEAM_ROLES.includes(r) || DEV_TEAM_ROLES.includes(s)
      })
      .map((e: any) => {
        const kpi = (kpis || []).find((k: any) => k.userId === e.userId)
        const load = loadByUserId.get(e.userId)
        return {
          userId: e.userId as string,
          employeeId: e.id as string,
          name: e.fullName || e.user?.name || 'Сотрудник',
          avatar: e.avatar || e.user?.avatar,
          role: e.user?.role as string,
          secondaryRole: e.user?.secondaryRole as string | null,
          percent: kpi?.overallPercent ?? null,
          noData: !kpi || kpi.noData || (kpi.items?.length ?? 0) === 0,
          activeTasks: load?.activeTasks ?? 0,
          overdueTasks: load?.overdueTasks ?? 0,
          criticalTasks: load?.criticalTasks ?? 0,
        }
      })
    // Сначала руководящие роли направления, затем по проценту.
    const rank = (r: string) => (r === 'pm_dev' ? 0 : r === 'sales_manager_dev' ? 1 : 2)
    return rows.sort((a, b) =>
      rank(a.role) - rank(b.role)
      || (b.percent ?? -1) - (a.percent ?? -1)
      || a.name.localeCompare(b.name, 'ru'))
  }, [employees, kpis, loadByUserId])

  if (team.length === 0) return null

  const stageLabel = (n: any) => {
    const st = DEV_STAGES.find(s => s.num === Number(n))
    return st ? `${st.pct}% · ${st.label}` : null
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-primary-600" />
          <h3 className="section-title">KPI команды разработки</h3>
          <span className="text-xs text-surface-400">{team.length}</span>
        </div>
        <div className="flex gap-1">
          {(['today', 'week', 'month', 'prev_month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx('px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                period === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600')}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {team.map(row => {
          const isOpen = expanded === row.userId
          const tasks = (tasksByUser.get(row.userId) || [])
            .slice()
            .sort((a: any, b: any) => {
              // Сначала незакрытые, внутри — по дедлайну.
              const closed = (t: any) => ['done', 'cancelled'].includes(normalizeTaskStatus(t.status)) ? 1 : 0
              if (closed(a) !== closed(b)) return closed(a) - closed(b)
              const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
              const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
              return da - db
            })
          return (
            <div key={row.userId} className="rounded-xl border border-surface-100 dark:border-surface-700 overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : row.userId)}
                  className="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors shrink-0"
                  title={isOpen ? 'Свернуть задачи' : 'Показать задачи'}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <Avatar name={row.name} src={row.avatar} size={36} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={row.employeeId ? `/employees/${row.employeeId}` : '#'}
                    className="font-semibold text-sm text-surface-900 dark:text-surface-100 truncate hover:text-primary-600 dark:hover:text-primary-400 transition-colors block"
                  >
                    {row.name}
                  </Link>
                  <p className="text-[11px] text-surface-500 dark:text-surface-400 truncate">
                    {getRoleLabel(row.role)}
                    {row.secondaryRole ? ` / ${getRoleLabel(row.secondaryRole)}` : ''}
                  </p>
                </div>

                <div className="hidden sm:flex items-center gap-4 text-center shrink-0">
                  <div>
                    <p className="text-sm font-bold text-surface-900 dark:text-surface-100 tabular-nums">{row.activeTasks}</p>
                    <p className="text-[10px] text-surface-400">активных</p>
                  </div>
                  <div>
                    <p className={clsx('text-sm font-bold tabular-nums',
                      row.overdueTasks > 0 ? 'text-red-500' : 'text-surface-900 dark:text-surface-100')}>
                      {row.overdueTasks || '—'}
                    </p>
                    <p className="text-[10px] text-surface-400">просрочено</p>
                  </div>
                </div>

                <div className="w-24 sm:w-32 shrink-0">
                  {row.noData ? (
                    <p className="text-[11px] text-surface-400 text-right">нет данных</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-surface-400">KPI</span>
                        <span className="text-xs font-bold text-surface-900 dark:text-surface-100 tabular-nums">
                          {Math.round(row.percent ?? 0)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                        <div
                          className={clsx('h-full rounded-full transition-all', barColor(row.percent ?? 0))}
                          style={{ width: `${Math.min(100, Math.max(0, row.percent ?? 0))}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>

                {onCreateTask && (
                  <button
                    type="button"
                    onClick={() => onCreateTask(row.userId)}
                    title={`Поставить задачу: ${row.name}`}
                    className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-surface-400 hover:text-primary-600 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                  >
                    <Plus size={15} />
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-800/40 px-3 py-2">
                  {tasks.length === 0 ? (
                    <p className="text-xs text-surface-400 py-2">Задач нет</p>
                  ) : (
                    <div className="space-y-1">
                      {tasks.map((t: any) => {
                        const st = normalizeTaskStatus(t.status)
                        const overdue = isTaskOverdue(t)
                        const stage = stageLabel(t.devStage)
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setOpenTaskId(t.id)}
                            className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700/60 transition-colors"
                          >
                            <span className={clsx('shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_COLOR_CLASSES[st])}>
                              {getTaskStatusLabel(t.status)}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-xs text-surface-700 dark:text-surface-200">
                              {t.title}
                            </span>
                            {stage && (
                              <span className="hidden md:inline shrink-0 text-[10px] text-primary-600 dark:text-primary-400 truncate max-w-[180px]">
                                {stage}
                              </span>
                            )}
                            {t.project?.name && (
                              <span className="hidden lg:inline shrink-0 text-[10px] text-surface-400 truncate max-w-[140px]">
                                {t.project.name}
                              </span>
                            )}
                            {typeof t.progress === 'number' && t.progress > 0 && (
                              <span className="shrink-0 text-[10px] text-surface-500 tabular-nums">{t.progress}%</span>
                            )}
                            {t.deadline && (
                              <span className={clsx('shrink-0 text-[10px] tabular-nums flex items-center gap-0.5',
                                overdue ? 'text-red-500 font-semibold' : 'text-surface-400')}>
                                {overdue && <AlertTriangle size={10} />}
                                {format(new Date(t.deadline), 'dd.MM')}
                              </span>
                            )}
                          </button>
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

      <TaskDrawer taskId={openTaskId as any} onClose={() => setOpenTaskId(null)} />
    </div>
  )
}
