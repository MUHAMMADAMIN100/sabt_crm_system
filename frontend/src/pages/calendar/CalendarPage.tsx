import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi, projectsApi, tasksApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal } from '@/components/ui'
import { useTranslation } from '@/i18n'
import TaskForm from '@/components/tasks/TaskForm'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const TYPE_COLORS: Record<string, string> = {
  project_start: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/50',
  project_end:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50',
}

export default function CalendarPage() {
  const [current, setCurrent] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [filterProjectId, setFilterProjectId] = useState('')
  const { t } = useTranslation()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isHeadSMM = user?.role === 'head_smm'
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'project_manager', 'head_smm'].includes(user?.role || '')
  const canCreate = !!user

  const from = format(startOfMonth(current), 'yyyy-MM-dd')
  const to = format(endOfMonth(current), 'yyyy-MM-dd')

  const { data: events } = useQuery({
    queryKey: ['calendar', from, to, filterProjectId],
    queryFn: () => calendarApi.events({
      from, to,
      ...(filterProjectId && { projectId: filterProjectId }),
    }),
  })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list(), enabled: isManagerPlus })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list(), enabled: isManagerPlus })

  const createTask = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setShowTaskForm(false)
      toast.success(t('tasks.created'))
    },
    onError: () => toast.error(t('common.error')),
  })

  // ВАЖНО: оставляем только события проекта (старт / конец).
  // Задачи скрываем — они есть на /tasks и в канбане проекта,
  // календарь — про проектный таймлайн, не про микро-задачи.
  const projectEvents = (events || []).filter((e: any) =>
    e.type === 'project_start' || e.type === 'project_end',
  )

  const eventsForDay = (day: Date) =>
    projectEvents.filter((e: any) => isSameDay(new Date(e.date), day))

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const startPad = (getDay(startOfMonth(current)) + 6) % 7

  const weekDaysArr = t('calendar.weekDays')
  const weekDays = Array.isArray(weekDaysArr) ? weekDaysArr : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  const handleDayClick = (day: Date) => {
    if (!canCreate) return
    setSelectedDay(day)
    setShowTaskForm(true)
  }

  const navigateToProject = (e: any) => {
    if (e.link) window.location.href = e.link
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
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
          <button
            onClick={() => setCurrent(new Date())}
            className="px-3 py-1.5 text-xs rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30"
          >
            Сегодня
          </button>
        </div>
      </div>

      {isManagerPlus && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Проект:</span>
          <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)} className="input w-full sm:w-64 text-sm">
            <option value="">Все проекты</option>
            {(isHeadSMM
              ? projects?.filter((p: any) => p.projectType === 'SMM')
              : projects
            )?.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ─── DESKTOP: grid 7 columns (sm and up) ─────────────────── */}
      <div className="hidden sm:block card p-0 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="w-full min-w-[640px]">
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
              const today = isToday(day)
              const dayEvents = eventsForDay(day)
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
                      <span className="flex items-center gap-0.5 text-[10px] text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium" title="Кликните, чтобы создать задачу">
                        <Plus size={12} /> задача
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((e: any) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={ev => { ev.stopPropagation(); navigateToProject(e) }}
                        title={e.title}
                        className={clsx(
                          'block w-full text-left text-[11px] px-1.5 py-0.5 rounded border truncate font-medium',
                          TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {e.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-surface-400 dark:text-surface-500 px-1">
                        +{dayEvents.length - 3} ещё
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── MOBILE: vertical day list (sm and below) ─────────────── */}
      <div className="sm:hidden card p-0 divide-y divide-surface-100 dark:divide-surface-700">
        {days.map(day => {
          const today = isToday(day)
          const dayEvents = eventsForDay(day)
          const dow = (getDay(day) + 6) % 7
          return (
            <div
              key={day.toISOString()}
              onClick={() => handleDayClick(day)}
              className={clsx(
                'flex items-stretch gap-3 p-3 transition-colors',
                canCreate && 'cursor-pointer active:bg-surface-50 dark:active:bg-surface-700/40',
              )}
            >
              <div className={clsx(
                'shrink-0 w-12 rounded-xl flex flex-col items-center justify-center text-center px-1 py-1.5',
                today
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-surface-50 dark:bg-surface-700/40 text-surface-700 dark:text-surface-300',
              )}>
                <span className="text-lg font-bold leading-none">{format(day, 'd')}</span>
                <span className={clsx(
                  'text-[10px] uppercase mt-0.5',
                  today ? 'text-white/80' : 'text-surface-400 dark:text-surface-500',
                )}>
                  {weekDays[dow]}
                </span>
              </div>
              <div className="flex-1 flex items-center min-w-0">
                {dayEvents.length === 0 ? (
                  <span className="text-sm text-surface-400 dark:text-surface-500">—</span>
                ) : (
                  <div className="flex flex-col gap-1 w-full">
                    {dayEvents.map((e: any) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={ev => { ev.stopPropagation(); navigateToProject(e) }}
                        className={clsx(
                          'text-left text-xs px-2 py-1 rounded border truncate font-medium',
                          TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {e.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ─── Legend (compact) ─────────────────────────────────────── */}
      <div className="card p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-semibold text-surface-700 dark:text-surface-200">Легенда:</span>
        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/50">
          Старт проекта
        </span>
        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50">
          Конец проекта
        </span>
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
    </div>
  )
}
