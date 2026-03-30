import { useMemo, useRef, useState } from 'react'
import { differenceInDays, addDays, format, startOfDay, isToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Link } from 'react-router-dom'

interface GanttTask {
  id: string
  title: string
  status: string
  priority: string
  createdAt: string
  deadline?: string
  assignee?: { name: string }
}

interface Props {
  tasks: GanttTask[]
  projectStart?: string
  projectEnd?: string
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  review: 'bg-amber-500',
  done: 'bg-emerald-500',
  cancelled: 'bg-red-400',
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'Проверка',
  done: 'Готово',
  cancelled: 'Отменено',
}

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-slate-400',
  medium: 'bg-blue-500',
  high: 'bg-amber-500',
  critical: 'bg-red-500',
}

const COL_WIDTH = 40 // px per day
const ROW_HEIGHT = 44 // px per task
const LABEL_WIDTH = 220 // px for task name column

export default function GanttChart({ tasks, projectStart, projectEnd }: Props) {
  const [tooltip, setTooltip] = useState<{ task: GanttTask; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const tasksWithDates = useMemo(
    () => tasks.filter(t => t.deadline),
    [tasks]
  )

  const { rangeStart, totalDays, days } = useMemo(() => {
    if (!tasksWithDates.length) {
      const today = startOfDay(new Date())
      return {
        rangeStart: today,
        totalDays: 30,
        days: Array.from({ length: 30 }, (_, i) => addDays(today, i)),
      }
    }

    const starts = tasksWithDates.map(t => startOfDay(new Date(t.createdAt)))
    const ends = tasksWithDates.map(t => startOfDay(new Date(t.deadline!)))
    if (projectStart) starts.push(startOfDay(new Date(projectStart)))
    if (projectEnd) ends.push(startOfDay(new Date(projectEnd)))

    const minDate = starts.reduce((a, b) => (a < b ? a : b))
    const maxDate = ends.reduce((a, b) => (a > b ? a : b))

    const start = addDays(minDate, -2)
    const end = addDays(maxDate, 2)
    const total = differenceInDays(end, start) + 1

    return {
      rangeStart: start,
      totalDays: total,
      days: Array.from({ length: total }, (_, i) => addDays(start, i)),
    }
  }, [tasksWithDates, projectStart, projectEnd])

  const getBarStyle = (task: GanttTask) => {
    const start = startOfDay(new Date(task.createdAt))
    const end = task.deadline ? startOfDay(new Date(task.deadline)) : addDays(start, 1)
    const left = Math.max(0, differenceInDays(start, rangeStart)) * COL_WIDTH
    const width = Math.max(COL_WIDTH, differenceInDays(end, start) * COL_WIDTH)
    return { left, width }
  }

  const todayOffset = differenceInDays(startOfDay(new Date()), rangeStart) * COL_WIDTH

  if (!tasksWithDates.length) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <p className="text-surface-500 dark:text-surface-400 text-sm">Нет задач с дедлайном для построения диаграммы</p>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-surface-100 dark:border-surface-700">
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-sm ${STATUS_COLORS[k]}`} />
            <span className="text-xs text-surface-500 dark:text-surface-400">{v}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-0.5 h-4 bg-red-500" />
          <span className="text-xs text-surface-500 dark:text-surface-400">Сегодня</span>
        </div>
      </div>

      <div className="flex overflow-hidden">
        {/* Task labels */}
        <div className="shrink-0 border-r border-surface-100 dark:border-surface-700" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-surface-100 dark:border-surface-700 px-3 flex items-center">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Задача</span>
          </div>
          {tasksWithDates.map(task => (
            <div key={task.id} className="flex items-center gap-2 px-3 border-b border-surface-50 dark:border-surface-700/50" style={{ height: ROW_HEIGHT }}>
              <div className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] || 'bg-slate-400'}`} />
              <Link
                to={`/tasks/${task.id}`}
                className="text-xs font-medium text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400 truncate"
                title={task.title}
              >
                {task.title}
              </Link>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="overflow-x-auto flex-1" ref={scrollRef}>
          <div style={{ width: totalDays * COL_WIDTH, minWidth: '100%' }}>
            {/* Day headers */}
            <div className="flex h-8 border-b border-surface-100 dark:border-surface-700 relative">
              {days.map((day, i) => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const showLabel = totalDays <= 60 ? true : day.getDate() === 1 || day.getDate() === 15
                return (
                  <div
                    key={i}
                    className={`shrink-0 flex items-center justify-center text-xs border-r border-surface-50 dark:border-surface-700/50 ${isWeekend ? 'bg-surface-50 dark:bg-surface-800/50' : ''}`}
                    style={{ width: COL_WIDTH }}
                  >
                    {showLabel && (
                      <span className={`${isToday(day) ? 'text-primary-600 font-bold' : 'text-surface-400 dark:text-surface-500'}`}>
                        {format(day, totalDays <= 31 ? 'd' : 'dd.MM', { locale: ru })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Rows */}
            <div className="relative">
              {/* Today line */}
              {todayOffset >= 0 && todayOffset <= totalDays * COL_WIDTH && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-70 z-10 pointer-events-none"
                  style={{ left: todayOffset }}
                />
              )}

              {tasksWithDates.map(task => {
                const { left, width } = getBarStyle(task)
                const color = STATUS_COLORS[task.status] || 'bg-slate-400'
                return (
                  <div
                    key={task.id}
                    className="relative flex items-center border-b border-surface-50 dark:border-surface-700/50"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Weekend stripes */}
                    {days.map((day, i) => {
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6
                      return isWeekend ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-surface-50 dark:bg-surface-800/30"
                          style={{ left: i * COL_WIDTH, width: COL_WIDTH }}
                        />
                      ) : null
                    })}

                    {/* Task bar */}
                    <div
                      className={`absolute h-6 rounded-md ${color} cursor-pointer transition-opacity hover:opacity-80 flex items-center px-2 overflow-hidden z-20`}
                      style={{ left, width }}
                      onMouseEnter={(e) => setTooltip({ task, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {width > 60 && (
                        <span className="text-white text-xs font-medium truncate">{task.title}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-surface-900 dark:bg-surface-700 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-xl"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <p className="font-semibold mb-1">{tooltip.task.title}</p>
          <p>Статус: {STATUS_LABEL[tooltip.task.status]}</p>
          {tooltip.task.assignee && <p>Исполнитель: {tooltip.task.assignee.name}</p>}
          <p>Начало: {format(new Date(tooltip.task.createdAt), 'dd.MM.yyyy')}</p>
          {tooltip.task.deadline && <p>Дедлайн: {format(new Date(tooltip.task.deadline), 'dd.MM.yyyy')}</p>}
        </div>
      )}
    </div>
  )
}
