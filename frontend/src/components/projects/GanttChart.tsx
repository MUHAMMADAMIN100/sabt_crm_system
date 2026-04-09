import { useMemo, useRef } from 'react'
import { differenceInDays, addDays, format, startOfDay, isToday, isWeekend } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Link } from 'react-router-dom'
import clsx from 'clsx'

interface GanttTask {
  id: string
  title: string
  status: string
  priority: string
  startDate?: string
  createdAt: string
  deadline?: string
  assignee?: { name: string }
}

interface Props {
  tasks: GanttTask[]
  projectStart?: string
  projectEnd?: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  new:         { bg: 'bg-slate-100 dark:bg-slate-800',  text: 'text-slate-600 dark:text-slate-300',  bar: 'bg-slate-400' },
  in_progress: { bg: 'bg-blue-50 dark:bg-blue-900/20',  text: 'text-blue-600 dark:text-blue-400',   bar: 'bg-blue-500' },
  review:      { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
  done:        { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-600 dark:text-green-400', bar: 'bg-emerald-500' },
  cancelled:   { bg: 'bg-red-50 dark:bg-red-900/20',    text: 'text-red-600 dark:text-red-400',     bar: 'bg-red-400' },
  returned:    { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600 dark:text-orange-400', bar: 'bg-orange-500' },
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новая', in_progress: 'В работе', review: 'На проверке',
  done: 'Готово', cancelled: 'Отменена', returned: 'Возвращена',
}

const PRIORITY_ICON: Record<string, string> = {
  low: '○', medium: '◐', high: '●', critical: '🔴',
}

const COL_WIDTH = 44
const ROW_HEIGHT = 52
const LABEL_WIDTH = 260

export default function GanttChart({ tasks, projectStart, projectEnd }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const tasksWithDates = useMemo(
    () => tasks.filter(t => t.deadline).sort((a, b) => {
      const startA = new Date(a.startDate || a.createdAt).getTime()
      const startB = new Date(b.startDate || b.createdAt).getTime()
      return startA - startB
    }),
    [tasks]
  )

  const { rangeStart, totalDays, days } = useMemo(() => {
    if (!tasksWithDates.length) {
      const today = startOfDay(new Date())
      return { rangeStart: today, totalDays: 30, days: Array.from({ length: 30 }, (_, i) => addDays(today, i)) }
    }

    const starts = tasksWithDates.map(t => startOfDay(new Date(t.startDate || t.createdAt)))
    const ends = tasksWithDates.map(t => startOfDay(new Date(t.deadline!)))
    if (projectStart) starts.push(startOfDay(new Date(projectStart)))
    if (projectEnd) ends.push(startOfDay(new Date(projectEnd)))

    const minDate = starts.reduce((a, b) => (a < b ? a : b))
    const maxDate = ends.reduce((a, b) => (a > b ? a : b))
    const start = addDays(minDate, -3)
    const end = addDays(maxDate, 3)
    const total = differenceInDays(end, start) + 1

    return { rangeStart: start, totalDays: total, days: Array.from({ length: total }, (_, i) => addDays(start, i)) }
  }, [tasksWithDates, projectStart, projectEnd])

  const getBarStyle = (task: GanttTask) => {
    const start = startOfDay(new Date(task.startDate || task.createdAt))
    const end = task.deadline ? startOfDay(new Date(task.deadline)) : addDays(start, 1)
    const left = Math.max(0, differenceInDays(start, rangeStart)) * COL_WIDTH
    const width = Math.max(COL_WIDTH, differenceInDays(end, start) * COL_WIDTH)
    return { left, width }
  }

  const todayOffset = differenceInDays(startOfDay(new Date()), rangeStart) * COL_WIDTH

  // Group days by month for header
  const months = useMemo(() => {
    const result: { label: string; span: number }[] = []
    let current = ''
    let count = 0
    days.forEach(day => {
      const label = format(day, 'LLLL yyyy', { locale: ru })
      if (label !== current) {
        if (current) result.push({ label: current, span: count })
        current = label
        count = 1
      } else count++
    })
    if (current) result.push({ label: current, span: count })
    return result
  }, [days])

  if (!tasksWithDates.length) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">📊</div>
        <p className="text-surface-500 dark:text-surface-400 text-sm font-medium">Нет задач с дедлайном</p>
        <p className="text-surface-400 dark:text-surface-500 text-xs mt-1">Добавьте задачу с дедлайном, чтобы увидеть диаграмму</p>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50">
        <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Статусы:</span>
        {Object.entries(STATUS_LABEL).filter(([k]) => k !== 'cancelled' && k !== 'returned').map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`w-3.5 h-2.5 rounded-sm ${STATUS_COLORS[k]?.bar || 'bg-slate-400'}`} />
            <span className="text-xs text-surface-600 dark:text-surface-400">{v}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-0.5 h-4 bg-red-500 rounded-full" />
          <span className="text-xs font-medium text-red-500">Сегодня</span>
        </div>
      </div>

      <div className="flex overflow-hidden">
        {/* Task labels column */}
        <div className="shrink-0 border-r border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 z-10" style={{ width: LABEL_WIDTH }}>
          {/* Month header placeholder */}
          <div className="h-7 border-b border-surface-100 dark:border-surface-700" />
          {/* Day header placeholder */}
          <div className="h-8 border-b border-surface-200 dark:border-surface-700 px-3 flex items-center">
            <span className="text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Задача / Исполнитель</span>
          </div>
          {tasksWithDates.map(task => {
            const sc = STATUS_COLORS[task.status] || STATUS_COLORS.new
            return (
              <div key={task.id} className="flex items-center gap-2.5 px-3 border-b border-surface-50 dark:border-surface-700/50 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors" style={{ height: ROW_HEIGHT }}>
                <span className="text-xs shrink-0" title={task.priority}>{PRIORITY_ICON[task.priority] || '○'}</span>
                <div className="flex-1 min-w-0">
                  <Link to={`/tasks/${task.id}`} className="text-xs font-medium text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400 truncate block" title={task.title}>
                    {task.title}
                  </Link>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={clsx('text-[10px] font-medium px-1.5 py-0 rounded', sc.bg, sc.text)}>
                      {STATUS_LABEL[task.status]}
                    </span>
                    {task.assignee && (
                      <span className="text-[10px] text-surface-400 dark:text-surface-500 truncate">{task.assignee.name}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Timeline area */}
        <div className="overflow-x-auto flex-1" ref={scrollRef} style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <div style={{ width: totalDays * COL_WIDTH, minWidth: '100%' }}>
            {/* Month headers */}
            <div className="flex h-7 border-b border-surface-100 dark:border-surface-700">
              {months.map((m, i) => (
                <div key={i} className="border-r border-surface-100 dark:border-surface-700 flex items-center justify-center" style={{ width: m.span * COL_WIDTH }}>
                  <span className="text-[10px] font-semibold text-surface-500 dark:text-surface-400 capitalize tracking-wider">{m.label}</span>
                </div>
              ))}
            </div>

            {/* Day headers */}
            <div className="flex h-8 border-b border-surface-200 dark:border-surface-700 relative">
              {days.map((day, i) => {
                const weekend = isWeekend(day)
                const today = isToday(day)
                return (
                  <div key={i} className={clsx('shrink-0 flex flex-col items-center justify-center border-r border-surface-50 dark:border-surface-700/50',
                    weekend && 'bg-surface-100/50 dark:bg-surface-800/50',
                    today && 'bg-primary-50 dark:bg-primary-900/20'
                  )} style={{ width: COL_WIDTH }}>
                    <span className={clsx('text-[9px]', weekend ? 'text-red-400' : 'text-surface-400 dark:text-surface-500')}>
                      {format(day, 'EE', { locale: ru }).slice(0, 2)}
                    </span>
                    <span className={clsx('text-[11px] font-medium', today ? 'text-primary-600 dark:text-primary-400 font-bold' : 'text-surface-600 dark:text-surface-400')}>
                      {format(day, 'd')}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Task rows */}
            <div className="relative">
              {/* Today line */}
              {todayOffset >= 0 && todayOffset <= totalDays * COL_WIDTH && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none" style={{ left: todayOffset }}>
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-[3px] -mt-1" />
                </div>
              )}

              {tasksWithDates.map(task => {
                const { left, width } = getBarStyle(task)
                const sc = STATUS_COLORS[task.status] || STATUS_COLORS.new
                const startDate = format(new Date(task.startDate || task.createdAt), 'dd.MM')
                const endDate = task.deadline ? format(new Date(task.deadline), 'dd.MM') : ''
                const daysCount = task.deadline ? differenceInDays(new Date(task.deadline), new Date(task.startDate || task.createdAt)) : 0

                return (
                  <div key={task.id} className="relative flex items-center border-b border-surface-50 dark:border-surface-700/50" style={{ height: ROW_HEIGHT }}>
                    {/* Weekend stripes */}
                    {days.map((day, i) => isWeekend(day) ? (
                      <div key={i} className="absolute top-0 bottom-0 bg-surface-50/70 dark:bg-surface-800/30" style={{ left: i * COL_WIDTH, width: COL_WIDTH }} />
                    ) : null)}

                    {/* Task bar */}
                    <Link
                      to={`/tasks/${task.id}`}
                      className={clsx('absolute h-7 rounded-md z-10 flex items-center gap-1.5 px-2 overflow-hidden transition-all hover:brightness-110 hover:shadow-md cursor-pointer', sc.bar)}
                      style={{ left, width }}
                      title={`${task.title}\n${startDate} → ${endDate} (${daysCount} дн.)\nСтатус: ${STATUS_LABEL[task.status]}${task.assignee ? `\nИсполнитель: ${task.assignee.name}` : ''}`}
                    >
                      {width > 80 && (
                        <span className="text-white text-[11px] font-medium truncate">{task.title}</span>
                      )}
                      {width > 50 && width <= 80 && (
                        <span className="text-white text-[10px] font-medium">{daysCount}д</span>
                      )}
                    </Link>

                    {/* Date labels outside bar */}
                    {width > 0 && (
                      <>
                        <span className="absolute text-[9px] text-surface-400 dark:text-surface-500 z-10 pointer-events-none" style={{ left: left - 2, top: ROW_HEIGHT - 14 }}>
                          {startDate}
                        </span>
                        {endDate && (
                          <span className="absolute text-[9px] text-surface-400 dark:text-surface-500 z-10 pointer-events-none" style={{ left: left + width - 20, top: ROW_HEIGHT - 14 }}>
                            {endDate}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
