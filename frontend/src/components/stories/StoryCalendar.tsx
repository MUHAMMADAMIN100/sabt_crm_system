import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { storiesApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isSameDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import clsx from 'clsx'

const MAX_STORIES = 3

interface StoryCalendarProps {
  /** If provided, shows readonly admin view for this employee */
  employeeId?: string
  /** Compact mode for embedding */
  compact?: boolean
}

export default function StoryCalendar({ employeeId, compact }: StoryCalendarProps) {
  const [current, setCurrent] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const user = useAuthStore(s => s.user)
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isReadonly = !!employeeId

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')

  const userId = employeeId || user?.id || ''

  const { data: stories } = useQuery({
    queryKey: ['stories', userId, from, to],
    queryFn: () => isReadonly ? storiesApi.all(from, to) : storiesApi.my(from, to),
  })

  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })

  const upsertStory = useMutation({
    mutationFn: storiesApi.upsert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories'] }),
  })

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  // Calculate stories per day
  const dayStoryMap = useMemo(() => {
    const map: Record<string, number> = {}
    const userStories = isReadonly
      ? stories?.filter((s: any) => s.employeeId === employeeId || s.userId === employeeId) || []
      : stories || []

    userStories.forEach((s: any) => {
      const dateKey = typeof s.date === 'string' ? s.date.split('T')[0] : format(new Date(s.date), 'yyyy-MM-dd')
      map[dateKey] = (map[dateKey] || 0) + (s.storiesCount || s.count || 0)
    })
    return map
  }, [stories, employeeId, isReadonly])

  // Stories for selected day broken by project
  const selectedDayStories = useMemo(() => {
    if (!selectedDay) return []
    const dateKey = format(selectedDay, 'yyyy-MM-dd')
    const userStories = isReadonly
      ? stories?.filter((s: any) => s.employeeId === employeeId || s.userId === employeeId) || []
      : stories || []
    return userStories.filter((s: any) => {
      const sd = typeof s.date === 'string' ? s.date.split('T')[0] : format(new Date(s.date), 'yyyy-MM-dd')
      return sd === dateKey
    })
  }, [selectedDay, stories, employeeId, isReadonly])

  const getDayColor = (day: Date) => {
    const dateKey = format(day, 'yyyy-MM-dd')
    const count = dayStoryMap[dateKey] || 0
    if (count === 0) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
    if (count < MAX_STORIES) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
  }

  const handleToggleStory = (projectId: string, date: string, currentCount: number) => {
    if (isReadonly) return
    const newCount = currentCount >= MAX_STORIES ? 0 : currentCount + 1
    upsertStory.mutate({ projectId, date, storiesCount: newCount })
  }

  const weekDays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']

  return (
    <div className={clsx('card', compact && 'p-3')}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={clsx('font-semibold text-surface-900 dark:text-surface-100', compact ? 'text-sm' : 'text-base')}>
          📸 {t('common.noData') === 'Нет данных' ? 'Истории' : 'Stories'}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-medium text-surface-600 dark:text-surface-300 min-w-[100px] text-center capitalize">
            {format(current, 'LLL yyyy', { locale: ru })}
          </span>
          <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Mini calendar */}
      <div className="grid grid-cols-7 gap-0.5 mb-3">
        {weekDays.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-surface-400 dark:text-surface-500 py-1">{d}</div>
        ))}
        {Array.from({ length: startPad }).map((_, i) => (
          <div key={`pad-${i}`} className="h-7" />
        ))}
        {days.map(day => {
          const today = isToday(day)
          const isPast = day < new Date() && !today
          const selected = selectedDay && isSameDay(day, selectedDay)
          const dateKey = format(day, 'yyyy-MM-dd')
          const count = dayStoryMap[dateKey] || 0

          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDay(day)}
              className={clsx(
                'h-7 w-full rounded-md text-xs font-medium transition-all flex items-center justify-center',
                selected && 'ring-2 ring-primary-500',
                today && 'ring-1 ring-primary-300',
                isPast && count === 0 && 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
                isPast && count > 0 && count < MAX_STORIES && 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
                isPast && count >= MAX_STORIES && 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
                !isPast && !today && 'bg-surface-50 dark:bg-surface-700 text-surface-500 dark:text-surface-400',
                today && count === 0 && 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
                today && count > 0 && count < MAX_STORIES && 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600',
                today && count >= MAX_STORIES && 'bg-green-50 dark:bg-green-900/20 text-green-600',
              )}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[10px] mb-3">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30" /><span className="text-surface-500 dark:text-surface-400">0</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/30" /><span className="text-surface-500 dark:text-surface-400">1-2</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30" /><span className="text-surface-500 dark:text-surface-400">3+</span></div>
      </div>

      {/* Selected day details */}
      {selectedDay && (
        <div className="border-t border-surface-100 dark:border-surface-700 pt-3">
          <p className="text-xs font-semibold text-surface-700 dark:text-surface-300 mb-2">
            {format(selectedDay, 'dd MMMM yyyy', { locale: ru })}
          </p>
          {projects?.filter((p: any) => !p.isArchived && p.status !== 'completed').length === 0 ? (
            <p className="text-xs text-surface-400 dark:text-surface-500">{t('projects.noProjects')}</p>
          ) : (
            <div className="space-y-1.5">
              {projects?.filter((p: any) => !p.isArchived && p.status !== 'completed').map((project: any) => {
                const projectStory = selectedDayStories.find((s: any) => s.projectId === project.id)
                const count = projectStory?.storiesCount || projectStory?.count || 0
                const dateStr = format(selectedDay, 'yyyy-MM-dd')

                return (
                  <div key={project.id} className="flex items-center justify-between p-2 rounded-lg bg-surface-50 dark:bg-surface-700/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{project.name}</p>
                      <div className="flex gap-1 mt-1">
                        {[1, 2, 3].map(i => (
                          <button
                            key={i}
                            disabled={isReadonly}
                            onClick={() => handleToggleStory(project.id, dateStr, i <= count ? i - 1 : i)}
                            className={clsx(
                              'w-5 h-5 rounded flex items-center justify-center transition-all text-[10px]',
                              i <= count
                                ? 'bg-green-500 text-white'
                                : 'bg-surface-200 dark:bg-surface-600 text-surface-400 dark:text-surface-500',
                              !isReadonly && 'hover:scale-110 cursor-pointer',
                              isReadonly && 'cursor-default'
                            )}
                          >
                            {i <= count ? <Check size={10} /> : i}
                          </button>
                        ))}
                      </div>
                    </div>
                    <span className={clsx(
                      'text-xs font-bold px-2 py-0.5 rounded-full',
                      count >= 3 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      count > 0 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    )}>
                      {count}/{MAX_STORIES}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
