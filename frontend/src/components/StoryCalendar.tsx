import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { storiesApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isSameDay } from 'date-fns'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const MAX_STORIES = 3

export default function StoryCalendar({ isAdmin = false }: { isAdmin?: boolean }) {
  const [current, setCurrent] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')

  const { data: stories } = useQuery({
    queryKey: ['stories', from, to, isAdmin],
    queryFn: () => isAdmin ? storiesApi.all(from, to) : storiesApi.my(from, to),
  })

  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })

  const upsertStory = useMutation({
    mutationFn: storiesApi.upsert,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stories'] }); toast.success(t('common.updated')) },
  })

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  // Get total stories count for a day (sum of all projects)
  const getDayTotal = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd')
    const dayStories = stories?.filter((s: any) => s.date === dateStr) || []
    return dayStories.reduce((sum: number, s: any) => sum + (s.storiesCount || s.count || 0), 0)
  }

  // Get color for day
  const getDayColor = (day: Date) => {
    const total = getDayTotal(day)
    if (total === 0) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
    if (total < MAX_STORIES) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
  }

  // Get stories for selected day by project
  const getSelectedDayStories = () => {
    if (!selectedDay) return []
    const dateStr = format(selectedDay, 'yyyy-MM-dd')
    return projects?.map((p: any) => {
      const story = stories?.find((s: any) => s.date === dateStr && s.projectId === p.id)
      return { project: p, count: story?.storiesCount || story?.count || 0 }
    }) || []
  }

  const handleToggleStory = (projectId: string, currentCount: number) => {
    if (isAdmin || !selectedDay) return
    const newCount = currentCount >= MAX_STORIES ? 0 : currentCount + 1
    upsertStory.mutate({ projectId, date: format(selectedDay, 'yyyy-MM-dd'), storiesCount: newCount })
  }

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
          {isAdmin ? '📊 Истории сотрудников' : '📸 Публикации историй'}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg">
            <ChevronLeft size={14} className="text-surface-400" />
          </button>
          <span className="text-xs font-medium text-surface-600 dark:text-surface-300 min-w-[80px] text-center capitalize">
            {format(current, 'LLL yyyy')}
          </span>
          <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg">
            <ChevronRight size={14} className="text-surface-400" />
          </button>
        </div>
      </div>

      {/* Mini calendar grid */}
      <div className="grid grid-cols-7 gap-0.5 mb-3">
        {weekDays.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-surface-400 dark:text-surface-500 py-1">{d}</div>
        ))}
        {Array.from({ length: startPad }).map((_, i) => (
          <div key={`pad-${i}`} className="w-full aspect-square" />
        ))}
        {days.map(day => {
          const today = isToday(day)
          const isSelected = selectedDay && isSameDay(day, selectedDay)
          const isPast = day <= new Date()
          const total = getDayTotal(day)
          const colorClass = isPast ? getDayColor(day) : 'bg-surface-50 dark:bg-surface-700/50 text-surface-400 dark:text-surface-500'

          return (
            <button key={day.toISOString()} onClick={() => setSelectedDay(day)}
              className={clsx(
                'w-full aspect-square rounded-lg flex items-center justify-center text-xs font-medium transition-all relative',
                colorClass,
                isSelected && 'ring-2 ring-primary-500 ring-offset-1 dark:ring-offset-surface-800',
                today && 'ring-1 ring-primary-400',
              )}>
              {format(day, 'd')}
              {isPast && total > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-current flex items-center justify-center">
                  <span className="text-[7px] text-white font-bold">{total}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3 justify-center">
        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-red-200 dark:bg-red-900/40" /><span className="text-[10px] text-surface-500 dark:text-surface-400">0</span></div>
        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-yellow-200 dark:bg-yellow-900/40" /><span className="text-[10px] text-surface-500 dark:text-surface-400">1-2</span></div>
        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-green-200 dark:bg-green-900/40" /><span className="text-[10px] text-surface-500 dark:text-surface-400">3+</span></div>
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="border-t border-surface-100 dark:border-surface-700 pt-3 space-y-2">
          <p className="text-xs font-semibold text-surface-700 dark:text-surface-300">
            {format(selectedDay, 'dd.MM.yyyy')}
          </p>
          {getSelectedDayStories().map((item: any) => (
            <div key={item.project.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-50 dark:bg-surface-700/50">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-surface-900 dark:text-surface-100 truncate">{item.project.name}</p>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: MAX_STORIES }).map((_, i) => (
                  <button key={i}
                    onClick={() => !isAdmin && handleToggleStory(item.project.id, i < item.count ? i : item.count)}
                    disabled={isAdmin}
                    className={clsx(
                      'w-6 h-6 rounded-md flex items-center justify-center transition-all',
                      i < item.count
                        ? 'bg-green-500 text-white'
                        : 'bg-surface-200 dark:bg-surface-600 text-surface-400 dark:text-surface-500',
                      !isAdmin && 'hover:scale-110 cursor-pointer',
                    )}>
                    {i < item.count ? <Check size={12} /> : <span className="text-[10px]">{i + 1}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
