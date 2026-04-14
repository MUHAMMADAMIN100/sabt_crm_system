import { useState, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { storiesApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Avatar } from '@/components/ui'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import clsx from 'clsx'

interface StoryCalendarProps {
  employeeId?: string
  compact?: boolean
  adminAll?: boolean
}

const FALLBACK_TARGET = 3 // used only if project has no smmData.storiesPerDay
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Per-project daily target taken from smmData.storiesPerDay. */
function getDailyTarget(project: any): number {
  const v = Number(project?.smmData?.storiesPerDay)
  return Number.isFinite(v) && v > 0 ? Math.min(v, 12) : FALLBACK_TARGET
}

export default function StoryCalendar({ employeeId, compact, adminAll }: StoryCalendarProps) {
  const [current, setCurrent] = useState(new Date())
  const [selectedProject, setSelectedProject] = useState<any>(null)
  const [animMap, setAnimMap] = useState<Record<string, 'pop' | 'unpop'>>({})
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  // Track latest storiesCount per project+date to ignore stale mutation responses
  const latestCount = useRef<Record<string, number>>({})
  const isReadonly = !!employeeId || !!adminAll

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')
  const userId = employeeId || user?.id || ''

  const { data: stories } = useQuery({
    queryKey: ['stories', userId, from, to],
    queryFn: () => (isReadonly || adminAll) ? storiesApi.all(from, to) : storiesApi.my(from, to),
  })

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const upsertStory = useMutation({
    mutationFn: storiesApi.upsert,
    onMutate: async ({ projectId, date, storiesCount }: any) => {
      const dateKey = typeof date === 'string' ? date.split('T')[0] : date
      const trackKey = `${projectId}-${dateKey}`
      // Record latest intended count — used to discard stale responses
      latestCount.current[trackKey] = storiesCount

      await qc.cancelQueries({ queryKey: ['stories', userId, from, to] })
      const previous = qc.getQueryData(['stories', userId, from, to])

      qc.setQueryData(['stories', userId, from, to], (old: any[]) => {
        if (!old) return old
        const exists = old.some((s: any) => s.projectId === projectId && s.date?.split('T')[0] === dateKey)
        if (exists) {
          return old.map((s: any) =>
            s.projectId === projectId && s.date?.split('T')[0] === dateKey
              ? { ...s, storiesCount }
              : s
          )
        }
        return [...old, { projectId, date: dateKey, storiesCount, employeeId: userId, id: `temp-${Date.now()}` }]
      })
      return { previous, trackKey, storiesCount }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['stories', userId, from, to], context?.previous)
    },
    onSuccess: (serverData: any, _vars: any, context: any) => {
      const { trackKey, storiesCount } = context || {}
      // If a newer mutation already fired for this cell, ignore this stale response
      if (trackKey && latestCount.current[trackKey] !== storiesCount) return
      if (trackKey) delete latestCount.current[trackKey]

      qc.setQueryData(['stories', userId, from, to], (old: any[]) => {
        if (!old || !serverData) return old
        const dateKey = serverData.date?.split('T')[0]
        return old.map((s: any) =>
          s.projectId === serverData.projectId && s.date?.split('T')[0] === dateKey
            ? { ...s, ...serverData }
            : s
        )
      })
    },
  })

  const activeProjects = useMemo(() => {
    const base = projects?.filter((p: any) => !p.isArchived && p.status !== 'completed') || []
    // Admin all view or readonly (employee detail) sees all projects
    if (adminAll || isReadonly) return base
    if (['admin', 'founder'].includes(user?.role || '')) return base
    // Everyone else (PM, SMM, designer, etc.): projects where they are member OR manager
    return base.filter((p: any) =>
      p.members?.some((m: any) => m.id === user?.id) || p.managerId === user?.id,
    )
  }, [projects, user, isReadonly, adminAll])

  // Build story map: projectId -> dateKey -> count
  const storyMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    const src = (adminAll)
      ? stories || []
      : isReadonly
        ? stories?.filter((s: any) => s.employeeId === employeeId || s.userId === employeeId) || []
        : stories || []
    src.forEach((s: any) => {
      const dateKey = typeof s.date === 'string' ? s.date.split('T')[0] : format(new Date(s.date), 'yyyy-MM-dd')
      if (!map[s.projectId]) map[s.projectId] = {}
      map[s.projectId][dateKey] = (map[s.projectId][dateKey] || 0) + (s.storiesCount || s.count || 0)
    })
    return map
  }, [stories, employeeId, isReadonly])

  // Build per-employee story map: projectId -> employeeId -> { name, avatar, total, byDate }
  const empStoryMap = useMemo(() => {
    if (!adminAll) return {}
    const map: Record<string, Record<string, { name: string; avatar?: string; total: number; byDate: Record<string, number> }>> = {}
    const src = stories || []
    src.forEach((s: any) => {
      const dateKey = typeof s.date === 'string' ? s.date.split('T')[0] : format(new Date(s.date), 'yyyy-MM-dd')
      const eid = s.employeeId
      if (!map[s.projectId]) map[s.projectId] = {}
      if (!map[s.projectId][eid]) map[s.projectId][eid] = { name: s.employee?.name || eid, avatar: s.employee?.avatar, total: 0, byDate: {} }
      const cnt = s.storiesCount || s.count || 0
      map[s.projectId][eid].total += cnt
      map[s.projectId][eid].byDate[dateKey] = (map[s.projectId][eid].byDate[dateKey] || 0) + cnt
    })
    return map
  }, [stories, adminAll])

  // Per-project total for current month
  const projectTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    activeProjects.forEach((p: any) => {
      const pm = storyMap[p.id] || {}
      totals[p.id] = Object.values(pm).reduce((sum: number, c: any) => sum + c, 0)
    })
    return totals
  }, [activeProjects, storyMap])

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  /** Color a day by progress against the target. */
  const getDayColor = (count: number, date: Date, target: number) => {
    const past = date < new Date() && !isToday(date)
    const relevant = past || isToday(date)
    if (!relevant) return 'bg-surface-50 dark:bg-surface-700 text-surface-400'
    if (count === 0) return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
    if (count >= target) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    // Partially done — between 1 and target-1
    const pct = target > 0 ? count / target : 0
    if (pct >= 0.5) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
    return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400'
  }

  const triggerAnim = useCallback((key: string, type: 'pop' | 'unpop') => {
    setAnimMap(prev => ({ ...prev, [key]: type }))
    setTimeout(() => setAnimMap(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    }), 400)
  }, [])

  const handleCheck = (projectId: string, dateStr: string, checkboxIndex: number, currentCount: number, target: number) => {
    if (isReadonly) return
    const newCount = checkboxIndex > currentCount ? checkboxIndex : checkboxIndex - 1
    // animate all affected checkboxes
    for (let i = 1; i <= target; i++) {
      const key = `${dateStr}-${i}`
      const wasActive = i <= currentCount
      const willBeActive = i <= Math.max(0, newCount)
      if (wasActive !== willBeActive) {
        triggerAnim(key, willBeActive ? 'pop' : 'unpop')
      }
    }
    upsertStory.mutate({ projectId, date: dateStr, storiesCount: Math.max(0, newCount) })
  }

  /** Checkbox color: filled vs target. */
  const getCheckboxColor = (index: number, count: number, target: number) => {
    if (index > count) return 'bg-surface-200 dark:bg-surface-600'
    if (count >= target) return 'bg-green-500'
    const pct = target > 0 ? count / target : 0
    if (pct >= 0.5) return 'bg-yellow-400'
    return 'bg-pink-400'
  }

  // Project list view
  if (!selectedProject) {
    return (
      <div className={clsx('card', compact && 'p-3')}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={clsx('font-semibold text-surface-900 dark:text-surface-100', compact ? 'text-sm' : 'text-base')}>
            📸 Истории
          </h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs font-medium text-surface-600 dark:text-surface-300 min-w-[90px] text-center capitalize">
              {format(current, 'LLL yyyy', { locale: ru })}
            </span>
            <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        {activeProjects.length === 0 ? (
          <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-4">Нет активных проектов</p>
        ) : (
          <div className="space-y-2">
            {activeProjects.map((project: any) => {
              const total = projectTotals[project.id] || 0
              const pm = storyMap[project.id] || {}
              const daysWithStories = Object.values(pm).filter((c: any) => c > 0).length
              const todayKey = format(new Date(), 'yyyy-MM-dd')
              const todayCount = pm[todayKey] || 0
              const dailyTarget = getDailyTarget(project)
              const todayDone = todayCount >= dailyTarget
              return (
                <button
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors text-left"
                >
                  {/* Member avatars */}
                  {project.members?.length > 0 ? (
                    <div className="flex -space-x-2 shrink-0">
                      {project.members.slice(0, 3).map((m: any) => (
                        <div key={m.id} title={m.name} className="ring-2 ring-white dark:ring-surface-800 rounded-full shrink-0 cursor-default">
                          <Avatar name={m.name} src={m.avatar} size={24} />
                        </div>
                      ))}
                      {project.members.length > 3 && (
                        <div className="w-6 h-6 rounded-full bg-surface-200 dark:bg-surface-600 ring-2 ring-white dark:ring-surface-800 flex items-center justify-center text-[9px] font-semibold text-surface-600 dark:text-surface-300 shrink-0">
                          +{project.members.length - 3}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: project.color || '#6B4FCF' }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{project.name}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500">{daysWithStories} дней • {total} историй</p>
                    {adminAll && empStoryMap[project.id] && Object.keys(empStoryMap[project.id]).length > 1 && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {Object.values(empStoryMap[project.id]).map((emp: any) => (
                          <div key={emp.name} className="flex items-center gap-1">
                            <Avatar name={emp.name} src={emp.avatar} size={14} />
                            <span className="text-[10px] text-surface-500 dark:text-surface-400">{emp.total}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="flex gap-1">
                      {Array.from({ length: dailyTarget }, (_, idx) => idx + 1).map(i => {
                        let dotColor: string
                        if (todayCount === 0) {
                          dotColor = 'bg-red-500'
                        } else if (i <= todayCount) {
                          if (todayCount >= dailyTarget) dotColor = 'bg-green-500'
                          else if (todayCount / dailyTarget >= 0.5) dotColor = 'bg-yellow-400'
                          else dotColor = 'bg-pink-400'
                        } else {
                          dotColor = 'bg-surface-300 dark:bg-surface-600'
                        }
                        return <div key={i} className={clsx('w-2 h-2 rounded-full transition-colors duration-300', dotColor)} />
                      })}
                    </div>
                    <span className="text-[9px] font-semibold text-surface-400 dark:text-surface-500 min-w-[26px] text-right">
                      {todayCount}/{dailyTarget}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-3 text-[10px] mt-3 pt-3 border-t border-surface-100 dark:border-surface-700">
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-pink-400" /><span className="text-surface-400 dark:text-surface-500">1</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-yellow-400" /><span className="text-surface-400 dark:text-surface-500">2</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-green-500" /><span className="text-surface-400 dark:text-surface-500">3</span></div>
        </div>
      </div>
    )
  }

  // Project calendar view
  const projectStories = storyMap[selectedProject.id] || {}
  const dailyTarget = getDailyTarget(selectedProject)

  return (
    <div className={clsx('card', compact && 'p-3')}>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setSelectedProject(null)} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
          <ArrowLeft size={15} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedProject.color || '#6B4FCF' }} />
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{selectedProject.name}</h3>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 shrink-0">
              план: {dailyTarget}/день
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-medium text-surface-600 dark:text-surface-300 capitalize">
            {format(current, 'LLL', { locale: ru })}
          </span>
          <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[9px] font-semibold text-surface-400 dark:text-surface-500 py-0.5">{d}</div>
        ))}
      </div>

      {/* Calendar days with 3 checkboxes */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
        {days.map(day => {
          const dateKey = format(day, 'yyyy-MM-dd')
          const count = projectStories[dateKey] || 0
          const past = day < new Date() && !isToday(day)
          const future = day > new Date() && !isToday(day)

          return (
            <div
              key={day.toISOString()}
              className={clsx(
                'rounded-lg p-0.5 flex flex-col items-center gap-0.5',
                isToday(day) && 'ring-1 ring-primary-400',
                past && count === 0 && 'bg-red-50 dark:bg-red-900/20',
                future && 'opacity-50',
              )}
            >
              <span className={clsx('text-[9px] font-medium', isToday(day) ? 'text-primary-600 dark:text-primary-400' : 'text-surface-500 dark:text-surface-400')}>
                {format(day, 'd')}
              </span>
              {adminAll && empStoryMap[selectedProject.id] && (() => {
                const contributors = Object.values(empStoryMap[selectedProject.id]).filter((emp: any) => emp.byDate[dateKey] > 0)
                if (contributors.length <= 1) return null
                return (
                  <div className="flex -space-x-1 mb-0.5">
                    {contributors.map((emp: any) => (
                      <div key={emp.name} title={`${emp.name}: ${emp.byDate[dateKey]}`} className="ring-1 ring-white dark:ring-surface-800 rounded-full">
                        <Avatar name={emp.name} src={emp.avatar} size={10} />
                      </div>
                    ))}
                  </div>
                )
              })()}
              <div className={clsx('flex flex-wrap justify-center gap-0.5', dailyTarget > 4 && 'max-w-[40px]')}>
                {Array.from({ length: dailyTarget }, (_, idx) => idx + 1).map(i => {
                  const animKey = `${dateKey}-${i}`
                  const animType = animMap[animKey]
                  return (
                    <button
                      key={i}
                      disabled={isReadonly || future}
                      onClick={() => !future && handleCheck(selectedProject.id, dateKey, i, count, dailyTarget)}
                      className={clsx(
                        'w-3 h-3 rounded-sm transition-colors duration-200',
                        getCheckboxColor(i, count, dailyTarget),
                        i <= count && 'shadow-sm',
                        !isReadonly && !future && 'hover:scale-125 cursor-pointer',
                        (isReadonly || future) && 'cursor-default',
                        animType === 'pop'   && 'story-checkbox-pop',
                        animType === 'unpop' && 'story-checkbox-unpop',
                      )}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Month total */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-surface-100 dark:border-surface-700 text-xs">
        <span className="text-surface-400 dark:text-surface-500">Итого за месяц</span>
        <span className="font-semibold text-surface-700 dark:text-surface-300">
          {Object.values(projectStories).reduce((s: number, c: any) => s + c, 0)} историй
        </span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] mt-2">
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-red-400" /><span className="text-surface-400">0 (нет)</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-pink-400" /><span className="text-surface-400">&lt; половины</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-yellow-400" /><span className="text-surface-400">≥ половины</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-green-500" /><span className="text-surface-400">план ({dailyTarget})</span></div>
      </div>

      {/* Per-employee breakdown (admin only, multi-member) */}
      {adminAll && empStoryMap[selectedProject.id] && Object.keys(empStoryMap[selectedProject.id]).length > 1 && (
        <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700 space-y-1.5">
          <p className="text-[10px] font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wide">По сотрудникам</p>
          {Object.values(empStoryMap[selectedProject.id]).sort((a: any, b: any) => b.total - a.total).map((emp: any) => (
            <div key={emp.name} className="flex items-center gap-2">
              <Avatar name={emp.name} src={emp.avatar} size={18} />
              <span className="text-xs text-surface-700 dark:text-surface-300 flex-1 truncate">{emp.name}</span>
              <span className="text-xs font-semibold text-surface-900 dark:text-surface-100">{emp.total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
