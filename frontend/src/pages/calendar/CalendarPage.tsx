import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi, projectsApi, tasksApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal } from '@/components/ui'
import { useTranslation } from '@/i18n'
import TaskForm from '@/components/tasks/TaskForm'
import TaskSlidePanel from '@/components/tasks/TaskSlidePanel'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, parseISO, isBefore, isAfter } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, Info, MousePointerClick, CalendarPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const TYPE_COLORS: Record<string, string> = {
  task: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  project_start: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  project_end: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  new: 'bg-slate-400 dark:bg-slate-500',
  in_progress: 'bg-blue-500 dark:bg-blue-500',
  review: 'bg-amber-500 dark:bg-amber-500',
  done: 'bg-emerald-500 dark:bg-emerald-500',
  cancelled: 'bg-red-400 dark:bg-red-400',
  returned: 'bg-orange-500 dark:bg-orange-500',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
  cancelled: 'Отменена',
  returned: 'Возвращена',
}

export default function CalendarPage() {
  const [current, setCurrent] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [filterProjectId, setFilterProjectId] = useState('')
  const [slidePanelTaskId, setSlidePanelTaskId] = useState<string | null>(null)
  const { t } = useTranslation()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'founder', 'project_manager'].includes(user?.role || '')
  // All authenticated users can create tasks from calendar (workers create only for themselves)
  const canCreate = !!user

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')

  const { data: events } = useQuery({ queryKey: ['calendar', from, to, assigneeUserId, filterProjectId], queryFn: () => calendarApi.events({ from, to, ...(assigneeUserId && { employeeId: assigneeUserId }), ...(filterProjectId && { projectId: filterProjectId }) }) })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list(), enabled: isManagerPlus })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list(), enabled: isManagerPlus })

  const createTask = useMutation({
    mutationFn: tasksApi.create,
    onMutate: async (data: any) => {
      setShowTaskForm(false)
      await qc.cancelQueries({ queryKey: ['calendar', from, to, assigneeUserId, filterProjectId] })
      const previous = qc.getQueryData(['calendar', from, to, assigneeUserId, filterProjectId])
      const tempEvent = { id: `temp-${Date.now()}`, title: data.title || 'Новая задача', type: 'task', date: data.deadline || data.startDate, startDate: data.startDate, link: '#' }
      qc.setQueryData(['calendar', from, to, assigneeUserId, filterProjectId], (old: any[]) => old ? [...old, tempEvent] : [tempEvent])
      return { previous }
    },
    onError: (_e: any, _v: any, context: any) => {
      qc.setQueryData(['calendar', from, to, assigneeUserId, filterProjectId], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success(t('tasks.created'))
    },
  })

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  // Spanning task bars
  const spanMap: Record<string, Array<{ event: any; isStart: boolean; isEnd: boolean; isStartOfWeek: boolean; isEndOfWeek: boolean }>> = {}
  events?.filter((e: any) => e.type === 'task' && e.startDate).forEach((e: any) => {
    const start = parseISO(e.startDate)
    const end = parseISO(format(new Date(e.date), 'yyyy-MM-dd'))
    days.forEach(day => {
      if (!isBefore(day, start) && !isAfter(day, end)) {
        const key = format(day, 'yyyy-MM-dd')
        if (!spanMap[key]) spanMap[key] = []
        const dow = (getDay(day) + 6) % 7
        spanMap[key].push({
          event: e,
          isStart: isSameDay(day, start),
          isEnd: isSameDay(day, end),
          isStartOfWeek: dow === 0,
          isEndOfWeek: dow === 6,
        })
      }
    })
  })

  const getNonSpanEvents = (day: Date) =>
    events?.filter((e: any) => e.type !== 'task' && isSameDay(new Date(e.date), day)) || []

  const weekDaysArr = t('calendar.weekDays')
  const weekDays = Array.isArray(weekDaysArr) ? weekDaysArr : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  const handleDayClick = (day: Date) => {
    if (!canCreate) return
    setSelectedDay(day)
    setShowTaskForm(true)
  }

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault()
    e.stopPropagation()
    // Calendar returns IDs as "task-{uuid}", strip the prefix
    setSlidePanelTaskId(taskId.replace(/^task-/, ''))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('calendar.title')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))}
            className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center capitalize text-surface-900 dark:text-surface-100">
            {format(current, 'LLLL yyyy', { locale: ru })}
          </span>
          <button
            onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))}
            className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {isManagerPlus && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Исполнитель:</span>
          <select value={assigneeUserId} onChange={e => setAssigneeUserId(e.target.value)} className="input w-full sm:w-48 text-sm">
            <option value="">Все сотрудники</option>
            {employees?.map((e: any) => (
              <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName}</option>
            ))}
          </select>
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Проект:</span>
          <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)} className="input w-full sm:w-48 text-sm">
            <option value="">Все проекты</option>
            {projects?.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* How-to hint for new users */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-primary-50 dark:bg-primary-900/15 border border-primary-100 dark:border-primary-900/30">
        <Info size={16} className="text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-4 gap-y-1 text-xs text-surface-600 dark:text-surface-300">
          <span className="inline-flex items-center gap-1.5">
            <CalendarPlus size={12} className="text-primary-600 dark:text-primary-400" />
            <b className="text-surface-800 dark:text-surface-100">Клик по дню</b> — создать задачу
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MousePointerClick size={12} className="text-primary-600 dark:text-primary-400" />
            <b className="text-surface-800 dark:text-surface-100">Клик по задаче</b> — подробности
          </span>
          <span className="text-surface-500 dark:text-surface-400">
            Цвет полосы = статус · длина = срок выполнения
          </span>
        </div>
      </div>

      <div className="card p-0 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-surface-100 dark:border-surface-700">
          {weekDays.map((d: string) => (
            <div key={d} className="text-center text-xs font-semibold text-surface-400 dark:text-surface-500 py-3">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} className="min-h-[90px] border-r border-b border-surface-50 dark:border-surface-700" />
          ))}
          {days.map(day => {
            const dateKey = format(day, 'yyyy-MM-dd')
            const today = isToday(day)
            const spans = spanMap[dateKey] || []
            const nonSpanEvents = getNonSpanEvents(day)
            return (
              <div key={day.toISOString()} onClick={() => handleDayClick(day)}
                className={clsx('min-h-[90px] border-r border-b border-surface-50 dark:border-surface-700 p-1.5 transition-colors group overflow-hidden',
                  canCreate && 'cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/30',
                  today && 'bg-primary-50/30 dark:bg-primary-900/10')}>
                <div className="flex items-center justify-between mb-1">
                  <span className={clsx(
                    'text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full',
                    today
                      ? 'bg-primary-600 text-white shadow-sm ring-2 ring-primary-200 dark:ring-primary-900'
                      : 'text-surface-600 dark:text-surface-300',
                  )}>{format(day, 'd')}</span>
                  {canCreate && (
                    <span
                      className="flex items-center gap-0.5 text-[10px] text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium"
                      title="Кликните, чтобы создать задачу"
                    >
                      <Plus size={12} /> задача
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {/* Spanning task bars — click opens slide panel */}
                  {spans.slice(0, 3).map(({ event: e, isStart, isEnd, isStartOfWeek, isEndOfWeek }) => {
                    const roundL = isStart || isStartOfWeek
                    const roundR = isEnd || isEndOfWeek
                    const initials = e.assigneeName ? e.assigneeName.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase() : ''
                    const bgColor = TASK_STATUS_COLORS[e.status] || 'bg-blue-400 dark:bg-blue-500'
                    const statusLabel = TASK_STATUS_LABELS[e.status] || ''
                    const tooltip = `${e.title}${e.assigneeName ? ` · ${e.assigneeName}` : ''}${statusLabel ? ` · ${statusLabel}` : ''}`
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={ev => handleTaskClick(ev, e.id)}
                        title={tooltip}
                        className={clsx(
                          'flex items-center gap-1 h-[22px] text-xs text-white overflow-hidden w-full text-left',
                          bgColor,
                          roundL ? 'rounded-l pl-1.5' : '-ml-1.5 pl-1',
                          roundR ? 'rounded-r pr-1.5' : '-mr-1.5 pr-0',
                          'hover:brightness-110 transition-all cursor-pointer',
                        )}
                      >
                        {roundL && initials && (
                          <span className="w-[18px] h-[18px] rounded-full bg-white/30 flex items-center justify-center text-[9px] font-bold shrink-0">
                            {initials}
                          </span>
                        )}
                        <span className="truncate text-[11px] font-medium flex-1">{e.title}</span>
                      </button>
                    )
                  })}
                  {/* Single-day events (project start/end) */}
                  {nonSpanEvents.slice(0, 2).map((e: any) => (
                    <div key={e.id} className="flex items-center gap-0.5" title={e.title}>
                      <div
                        className={clsx(
                          'flex-1 text-[11px] px-1.5 py-0.5 rounded truncate font-medium',
                          TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {e.title}
                      </div>
                    </div>
                  ))}
                  {(spans.length + nonSpanEvents.length) > 3 && (
                    <div
                      className="text-[11px] font-medium text-surface-500 dark:text-surface-400 px-1.5"
                      title={`Ещё ${spans.length + nonSpanEvents.length - 3} событий в этот день`}
                    >
                      +{spans.length + nonSpanEvents.length - 3} ещё
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-surface-700 dark:text-surface-200 mb-2">Статусы задач (цвет полосы)</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <LegendItem color="bg-slate-400" label="Новая" />
            <LegendItem color="bg-blue-500" label="В работе" />
            <LegendItem color="bg-amber-500" label="На проверке" />
            <LegendItem color="bg-emerald-500" label="Готово" />
            <LegendItem color="bg-orange-500" label="Возвращена" />
            <LegendItem color="bg-red-400" label="Отменена" />
          </div>
        </div>
        <div className="pt-3 border-t border-surface-100 dark:border-surface-700">
          <p className="text-xs font-semibold text-surface-700 dark:text-surface-200 mb-2">События проектов</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <LegendItem colorClass="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" label={t('calendar.projectStart')} textBadge />
            <LegendItem colorClass="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" label={t('calendar.projectEnd')} textBadge />
          </div>
        </div>
      </div>

      {/* Task create modal */}
      {canCreate && showTaskForm && (
        <Modal
          open={showTaskForm}
          onClose={() => setShowTaskForm(false)}
          title={`${t('calendar.addTask')}${selectedDay ? ' — ' + format(selectedDay, 'dd.MM.yyyy') : ''}`}
          size="lg"
        >
          <TaskForm
            onSubmit={data => createTask.mutate({
              ...data,
              startDate: selectedDay ? format(selectedDay, 'yyyy-MM-dd') : undefined,
            })}
            onClose={() => setShowTaskForm(false)}
            projects={projects || []}
            employees={employees || []}
            loading={createTask.isPending}
            initialDeadline={selectedDay ? format(selectedDay, 'yyyy-MM-dd') : undefined}
            isAdmin={isManagerPlus}
            currentUserId={user?.id}
          />
        </Modal>
      )}

      {/* Task slide panel */}
      <TaskSlidePanel
        taskId={slidePanelTaskId}
        onClose={() => setSlidePanelTaskId(null)}
      />
    </div>
  )
}

function LegendItem({
  color, colorClass, label, textBadge,
}: { color?: string; colorClass?: string; label: string; textBadge?: boolean }) {
  if (textBadge) {
    return (
      <span className={clsx('inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded', colorClass)}>
        {label}
      </span>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className={clsx('w-4 h-3 rounded-sm', color)} />
      <span className="text-xs text-surface-600 dark:text-surface-300">{label}</span>
    </div>
  )
}
