import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { projectsApi, storiesApi } from '@/services/api.service'
import { StatCard } from '@/components/ui'
import StoryCalendar from '@/components/stories/StoryCalendar'
import { Image as ImageIcon, CheckCircle2, ListChecks, CalendarDays } from 'lucide-react'
import { format, startOfMonth } from 'date-fns'
import clsx from 'clsx'

/** Дневной план сторис проекта (из smmData.storiesPerDay, дефолт 3, максимум 12). */
function dailyTarget(project: any): number {
  const v = Number(project?.smmData?.storiesPerDay)
  return Number.isFinite(v) && v > 0 ? Math.min(v, 12) : 3
}

/**
 * Дашборд сторисмейкера — оперативная сводка по сторис всех SMM-проектов:
 * что закрыто сегодня, что осталось, итог за месяц + календарь для отметки.
 */
export default function StorymakerDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })
  const { data: todayStories } = useQuery({
    queryKey: ['stories', 'all', today, today],
    queryFn: () => storiesApi.all(today, today),
    refetchInterval: 30000,
  })
  const { data: monthStories } = useQuery({
    queryKey: ['stories', 'all', monthStart, today],
    queryFn: () => storiesApi.all(monthStart, today),
  })

  // Все активные SMM-проекты — рабочее поле сторисмейкера.
  const smmProjects = useMemo(
    () => (projects || []).filter((p: any) => !p.isArchived && p.projectType === 'SMM'),
    [projects],
  )

  // Сумма сторис за сегодня по каждому проекту (командно — любой участник).
  const todayByProject = useMemo(() => {
    const map: Record<string, number> = {}
    ;(todayStories || []).forEach((s: any) => {
      map[s.projectId] = (map[s.projectId] || 0) + (s.storiesCount || s.count || 0)
    })
    return map
  }, [todayStories])

  const monthTotal = useMemo(
    () => (monthStories || []).reduce((sum: number, s: any) => sum + (s.storiesCount || s.count || 0), 0),
    [monthStories],
  )
  const todayTotal = useMemo(
    () => Object.values(todayByProject).reduce((s, c) => s + c, 0),
    [todayByProject],
  )

  // Проекты с дневным планом > 0 — только они участвуют в подсчёте «закрыто».
  const tracked = smmProjects.filter((p: any) => dailyTarget(p) > 0)
  const doneToday = tracked.filter((p: any) => (todayByProject[p.id] || 0) >= dailyTarget(p))
  const pending = tracked
    .filter((p: any) => (todayByProject[p.id] || 0) < dailyTarget(p))
    .sort((a: any, b: any) => (todayByProject[a.id] || 0) - (todayByProject[b.id] || 0))

  return (
    <div className="space-y-6">
      {/* Сводка */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Закрыто сегодня"
          value={`${doneToday.length}/${tracked.length}`}
          icon={CheckCircle2}
          color="bg-green-500"
          sub="проектов выполнили план"
        />
        <StatCard
          title="Осталось сегодня"
          value={pending.length}
          icon={ListChecks}
          color="bg-primary-600"
          sub="проектов ждут сторис"
        />
        <StatCard
          title="Историй сегодня"
          value={todayTotal}
          icon={ImageIcon}
          color="bg-surface-500"
          sub="по всем проектам"
        />
        <StatCard
          title="За месяц"
          value={monthTotal}
          icon={CalendarDays}
          color="bg-surface-500"
          sub="историй опубликовано"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Нужно сегодня */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">Нужно сегодня</h3>
            <Link to="/project-stories" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Все проекты</Link>
          </div>
          {pending.length === 0 ? (
            <p className="text-xs text-green-600 dark:text-green-400 py-6 text-center font-medium">
              ✓ Все проекты на сегодня закрыты
            </p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {pending.map((p: any) => {
                const target = dailyTarget(p)
                const count = todayByProject[p.id] || 0
                return (
                  <Link
                    key={p.id}
                    to="/project-stories"
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors"
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color || '#18181b' }} />
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200 flex-1 truncate">{p.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {Array.from({ length: target }, (_, i) => i + 1).map(i => (
                        <div key={i} className={clsx(
                          'w-3 h-3 rounded-full',
                          i <= count ? 'bg-surface-400' : 'bg-surface-200 dark:bg-surface-600',
                        )} />
                      ))}
                    </div>
                    <span className="text-[11px] font-semibold tabular-nums text-surface-500 dark:text-surface-400 w-8 text-right">{count}/{target}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Календарь — отметка сторис прямо отсюда.
            Режим сторисмейкера: хотя бы одна сторис за день — зелёный. */}
        <div className="lg:col-span-2">
          <StoryCalendar greenAnyProgress />
        </div>
      </div>
    </div>
  )
}
