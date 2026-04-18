import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/services/api.service'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Camera } from 'lucide-react'
import clsx from 'clsx'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

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
  const [hoveredDay, setHoveredDay] = useState<string | null>(null)

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')

  const { data, isLoading } = useQuery({
    queryKey: ['stories-global', from, to],
    queryFn: () => analyticsApi.storiesGlobal(from, to),
  })

  const byDate = useMemo(() => {
    const map: Record<string, DayData> = {}
    for (const d of (data || []) as DayData[]) {
      map[d.date] = d
    }
    return map
  }, [data])

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  const monthTotal = useMemo(() => (data || []).reduce((s: number, d: DayData) => s + d.total, 0), [data])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title flex items-center gap-2">
          <Camera size={16} className="text-pink-500" /> Календарь историй (все проекты)
        </h2>
        <div className="flex items-center gap-2">
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

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-[10px] text-center font-medium text-surface-400 dark:text-surface-500 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <p className="text-sm text-surface-400 text-center py-8">Загрузка...</p>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map(day => {
            const dateKey = format(day, 'yyyy-MM-dd')
            const dayData = byDate[dateKey]
            const total = dayData?.total || 0
            const projects = dayData?.projects || []
            const isHover = hoveredDay === dateKey
            return (
              <div
                key={dateKey}
                onMouseEnter={() => setHoveredDay(dateKey)}
                onMouseLeave={() => setHoveredDay(null)}
                className={clsx(
                  'relative min-h-[64px] p-1.5 rounded-lg border transition-all cursor-default',
                  isToday(day)
                    ? 'border-primary-400 bg-primary-50/50 dark:bg-primary-900/20'
                    : 'border-surface-100 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600',
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={clsx(
                    'text-[11px] font-medium',
                    isToday(day) ? 'text-primary-700 dark:text-primary-400' : 'text-surface-500 dark:text-surface-400',
                  )}>{format(day, 'd')}</span>
                  {total > 0 && (
                    <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400">{total}</span>
                  )}
                </div>
                {/* Project color dots */}
                <div className="flex flex-wrap gap-0.5">
                  {projects.slice(0, 6).map(p => (
                    <div
                      key={p.projectId}
                      title={`${p.projectName}: ${p.count}`}
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: p.projectColor }}
                    />
                  ))}
                  {projects.length > 6 && (
                    <span className="text-[8px] text-surface-400">+{projects.length - 6}</span>
                  )}
                </div>
                {/* Hover tooltip */}
                {isHover && projects.length > 0 && (
                  <div className="absolute z-10 left-1/2 -translate-x-1/2 top-full mt-1 bg-surface-900 dark:bg-surface-800 text-white p-2 rounded-lg shadow-xl min-w-[160px] text-[11px] space-y-1 pointer-events-none">
                    {projects.map(p => (
                      <div key={p.projectId} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.projectColor }} />
                          <span className="truncate">{p.projectName}</span>
                        </div>
                        <span className="font-bold text-pink-300">{p.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex justify-between items-center mt-4 pt-3 border-t border-surface-100 dark:border-surface-700">
        <span className="text-xs text-surface-500 dark:text-surface-400">Итого за месяц</span>
        <span className="text-base font-bold text-pink-600 dark:text-pink-400">{monthTotal} историй</span>
      </div>
    </div>
  )
}
