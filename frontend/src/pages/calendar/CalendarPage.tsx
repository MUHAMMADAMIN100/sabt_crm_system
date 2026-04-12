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
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
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
    setSlidePanelTaskId(taskId)
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
                  <span className={clsx('text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full', today ? 'bg-primary-600 text-white' : 'text-surface-500 dark:text-surface-400')}>{format(day, 'd')}</span>
                  {canCreate && <Plus size={14} className="text-surface-300 dark:text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
                <div className="space-y-0.5">
                  {/* Spanning task bars — click opens slide panel */}
                  {spans.slice(0, 3).map(({ event: e, isStart, isEnd, isStartOfWeek, isEndOfWeek }) => {
                    const showLabel = isStart || isStartOfWeek
                    const roundL = isStart || isStartOfWeek
                    const roundR = isEnd || isEndOfWeek
                    const initials = e.assigneeName ? e.assigneeName.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase() : ''
                    const bgColor = TASK_STATUS_COLORS[e.status] || 'bg-blue-400 dark:bg-blue-500'
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={ev => handleTaskClick(ev, e.id)}
                        title={e.title}
                        className={clsx(
                          'flex items-center h-5 text-xs text-white overflow-hidden w-full text-left',
                          bgColor,
                          roundL ? 'rounded-l pl-1.5' : '-ml-1.5 pl-0',
                          roundR ? 'rounded-r pr-1' : '-mr-1.5 pr-0',
                          !roundL && !roundR && 'px-0',
                          'hover:brightness-110 transition-all cursor-pointer',
                        )}
                      >
                        {showLabel && (
                          <>
                            {initials && (
                              <span className="w-3.5 h-3.5 rounded-full bg-white/30 flex items-center justify-center text-[7px] font-bold shrink-0 mr-0.5">
                                {initials}
                              </span>
                            )}
                            <span className="truncate text-[10px] font-medium">{e.title}</span>
                          </>
                        )}
                      </button>
                    )
                  })}
                  {/* Single-day events (project start/end) */}
                  {nonSpanEvents.slice(0, 2).map((e: any) => (
                    <div key={e.id} className="flex items-center gap-0.5">
                      <div
                        className={clsx(
                          'flex-1 text-xs px-1.5 py-0.5 rounded truncate',
                          TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {e.title}
                      </div>
                    </div>
                  ))}
                  {(spans.length + nonSpanEvents.length) > 3 && (
                    <div className="text-xs text-surface-400 dark:text-surface-500 px-1.5">
                      +{spans.length + nonSpanEvents.length - 3}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        </div>
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Задачи:</span>
          <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded-sm bg-slate-400" /><span className="text-xs text-surface-500 dark:text-surface-400">Новая</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded-sm bg-blue-500" /><span className="text-xs text-surface-500 dark:text-surface-400">В работе</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded-sm bg-amber-500" /><span className="text-xs text-surface-500 dark:text-surface-400">На проверке</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded-sm bg-emerald-500" /><span className="text-xs text-surface-500 dark:text-surface-400">Готово</span></div>
          <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 ml-2">Проект:</span>
          <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded-sm bg-green-200 dark:bg-green-800" /><span className="text-xs text-surface-500 dark:text-surface-400">{t('calendar.projectStart')}</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-2 rounded-sm bg-red-200 dark:bg-red-800" /><span className="text-xs text-surface-500 dark:text-surface-400">{t('calendar.projectEnd')}</span></div>
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
