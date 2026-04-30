import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsApi, projectsApi } from '@/services/api.service'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isAfter } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Camera } from 'lucide-react'
import { CollapsibleSection } from '@/components/ui'
import clsx from 'clsx'

const WEEKDAYS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В']

interface ProjectCount {
  projectId: string
  projectName: string
  projectColor: string
  count: number
}

interface DayData {
  date: string
  total: number
  projects: ProjectCount[]
}

export default function GlobalStoriesCalendar() {
  const [current, setCurrent] = useState(new Date())

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')

  const { data: storiesData, isLoading } = useQuery({
    queryKey: ['stories-global', from, to],
    queryFn: () => analyticsApi.storiesGlobal(from, to),
  })

  const { data: allProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  // Active SMM projects only
  const projects = useMemo(() => {
    // Завершённые SMM-проекты тоже показываем — нужно для истории/аналитики.
    // Скрываем только архивные.
    return (allProjects || []).filter((p: any) =>
      !p.isArchived && p.projectType === 'SMM',
    )
  }, [allProjects])

  // Build per-project per-day map: projectId → dateKey → count
  const map = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const d of (storiesData || []) as DayData[]) {
      for (const p of d.projects) {
        if (!m[p.projectId]) m[p.projectId] = {}
        m[p.projectId][d.date] = (m[p.projectId][d.date] || 0) + p.count
      }
    }
    return m
  }, [storiesData])

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  return (
    <CollapsibleSection
      id="global-stories"
      title={
        <div className="flex items-center justify-between flex-wrap gap-2 w-full">
          <h2 className="section-title flex items-center gap-2">
            <Camera size={16} className="text-pink-500" /> Календарь историй (все проекты)
          </h2>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))}
              className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold min-w-[120px] text-center capitalize text-surface-900 dark:text-surface-100">
              {format(current, 'LLLL yyyy', { locale: ru })}
            </span>
            <button
              onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))}
              className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      }
    >

      {isLoading ? (
        <p className="text-sm text-surface-400 text-center py-8">Загрузка...</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-surface-400 text-center py-8">Нет активных SMM-проектов</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((p: any) => {
            const target = Math.min(Number(p?.smmData?.storiesPerDay) || 3, 12)
            const projectMap = map[p.id] || {}
            const projectTotal = Object.values(projectMap).reduce((s, n) => s + n, 0)
            return (
              <div key={p.id} className="border border-surface-100 dark:border-surface-700 rounded-xl p-3 bg-surface-50/50 dark:bg-surface-900/30">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color || '#6B4FCF' }} />
                    <p className="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate">{p.name}</p>
                  </div>
                  <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400 shrink-0">{projectTotal}</span>
                </div>

                {/* Weekday header */}
                <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                  {WEEKDAYS.map((d, i) => (
                    <div key={i} className="text-[8px] text-center text-surface-400 dark:text-surface-500">{d}</div>
                  ))}
                </div>

                {/* Mini calendar */}
                <div className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
                  {days.map(day => {
                    const dateKey = format(day, 'yyyy-MM-dd')
                    const count = projectMap[dateKey] || 0
                    const future = isAfter(day, new Date()) && !isToday(day)
                    const today = isToday(day)
                    let bg = 'bg-surface-100 dark:bg-surface-700/40'
                    let textColor = 'text-surface-400 dark:text-surface-500'
                    if (future) {
                      bg = 'bg-surface-50 dark:bg-surface-800/50'
                    } else if (count >= target) {
                      bg = 'bg-emerald-500'
                      textColor = 'text-white'
                    } else if (count > 0) {
                      const pct = count / target
                      bg = pct >= 0.5 ? 'bg-yellow-400' : 'bg-pink-400'
                      textColor = 'text-white'
                    } else {
                      bg = 'bg-red-400/70 dark:bg-red-500/40'
                      textColor = 'text-white'
                    }
                    return (
                      <div
                        key={dateKey}
                        title={count > 0 ? `${format(day, 'd MMM', { locale: ru })}: ${count} сторис` : `${format(day, 'd MMM', { locale: ru })}: нет`}
                        className={clsx(
                          'aspect-square rounded text-[8px] flex items-center justify-center font-medium relative',
                          bg, textColor,
                          today && 'ring-1 ring-primary-500',
                        )}
                      >
                        {format(day, 'd')}
                      </div>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="mt-2 pt-1.5 border-t border-surface-100 dark:border-surface-700 flex items-center justify-between text-[9px] text-surface-400 dark:text-surface-500">
                  <span>план: {target}/день</span>
                  <span className="font-medium">{projectTotal} историй</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-surface-100 dark:border-surface-700 text-[10px]">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-500" /><span className="text-surface-500">план</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-yellow-400" /><span className="text-surface-500">≥50%</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-pink-400" /><span className="text-surface-500">&lt;50%</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-400/70" /><span className="text-surface-500">не сделано</span></div>
      </div>
    </CollapsibleSection>
  )
}
