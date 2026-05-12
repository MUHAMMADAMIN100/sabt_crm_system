import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi, projectsApi, tasksApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal } from '@/components/ui'
import { useTranslation } from '@/i18n'
import TaskForm from '@/components/tasks/TaskForm'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, isSameMonth, subDays, addDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const TYPE_COLORS: Record<string, string> = {
  project_start: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/50',
  project_end:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50',
  task:          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900/50',
}

export default function CalendarPage() {
  const [current, setCurrent] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [filterProjectId, setFilterProjectId] = useState('')
  const { t } = useTranslation()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isHeadSMM = user?.role === 'head_smm' || user?.role === 'smm_director'
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(user?.role || '')
  // Создавать задачи кликом по дню могут только менеджерские роли.
  // Раньше canCreate=!!user пускал любого сотрудника, что приводило к
  // ошибкам при создании (no project/assignee выбраны автоматом).
  const canCreate = isManagerPlus

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

  // Календарь founder/co_founder показывает ТОЛЬКО собственные задачи
  // (где основатель — исполнитель или создатель). Никаких командных
  // историй/reels/проектных вех — это шум, у основателя свой фокус.
  // Остальные роли видят полный микс (старт/конец проектов + все задачи
  // с дедлайнами, попадающие в их область).
  const isFounderView = user?.role === 'founder' || user?.role === 'co_founder'
  const projectEvents = (events || []).filter((e: any) => {
    if (isFounderView) {
      if (e.type !== 'task') return false
      return e.assigneeId === user?.id || e.createdById === user?.id
    }
    return e.type === 'project_start' || e.type === 'project_end' || e.type === 'task'
  })

  const eventsForDay = (day: Date) =>
    projectEvents.filter((e: any) => isSameDay(new Date(e.date), day))

  const monthStart = startOfMonth(current)
  const monthEnd = endOfMonth(current)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = (getDay(monthStart) + 6) % 7
  const endPad = (7 - ((getDay(monthEnd) + 6) % 7) - 1 + 7) % 7
  // Дни предыдущего и следующего месяца, чтобы сетка была полной 7×N.
  const prevDays = startPad > 0
    ? eachDayOfInterval({ start: subDays(monthStart, startPad), end: subDays(monthStart, 1) })
    : []
  const nextDays = endPad > 0
    ? eachDayOfInterval({ start: addDays(monthEnd, 1), end: addDays(monthEnd, endPad) })
    : []
  const gridDays = [...prevDays, ...days, ...nextDays]

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">{t('calendar.title')}</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center capitalize text-surface-900 dark:text-surface-100">
            {format(current, 'LLLL yyyy', { locale: ru })} г.
          </span>
          <button
            onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
            aria-label="Следующий месяц"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setCurrent(new Date())}
            className="px-4 py-1.5 text-sm font-semibold rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
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
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 mb-2 px-1">
          {weekDays.map((d: string) => (
            <div key={d} className="text-xs font-medium text-surface-400 dark:text-surface-500 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {gridDays.map(day => {
            const today = isToday(day)
            const inMonth = isSameMonth(day, current)
            const dayEvents = eventsForDay(day)
            return (
              <div
                key={day.toISOString()}
                onClick={() => handleDayClick(day)}
                className={clsx(
                  'min-h-[120px] rounded-2xl border p-3 transition-all group overflow-hidden flex flex-col',
                  inMonth
                    ? 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700'
                    : 'bg-primary-50/40 dark:bg-primary-900/10 border-primary-100/60 dark:border-primary-900/30',
                  today && 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800',
                  canCreate && inMonth && 'cursor-pointer hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm',
                  canCreate && !inMonth && 'cursor-pointer hover:bg-primary-50/70 dark:hover:bg-primary-900/20',
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={clsx(
                    'text-sm leading-none',
                    today
                      ? 'text-primary-600 dark:text-primary-400 font-bold'
                      : inMonth
                        ? 'text-surface-700 dark:text-surface-200 font-medium'
                        : 'text-surface-400 dark:text-surface-500',
                  )}>{format(day, 'd')}</span>
                  {canCreate && inMonth && (
                    <span className="flex items-center gap-0.5 text-[10px] text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium" title="Кликните, чтобы создать задачу">
                      <Plus size={12} /> задача
                    </span>
                  )}
                </div>
                <div className="space-y-1 mt-1">
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
        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900/50">
          Задача / контент-план
        </span>
      </div>

      {/* Task create modal */}
      {canCreate && showTaskForm && (
        <Modal
          open={showTaskForm}
          onClose={() => setShowTaskForm(false)}
          title={`${isFounderView ? 'Задача от основателя' : t('calendar.addTask')}${selectedDay ? ' — ' + format(selectedDay, 'dd.MM.yyyy') : ''}`}
          size="lg"
        >
          {isFounderView ? (
            <FounderQuickTaskForm
              employees={employees || []}
              loading={createTask.isPending}
              onClose={() => setShowTaskForm(false)}
              onSubmit={data => createTask.mutate({
                ...data,
                // Дедлайн = день клика в календаре; время в полдень чтобы
                // не было путаницы с тайм-зонами при отображении.
                deadline: selectedDay
                  ? `${format(selectedDay, 'yyyy-MM-dd')}T12:00:00.000Z`
                  : undefined,
                fromFounder: true,
                // projectId не передаём — задача direct from founder.
              })}
            />
          ) : (
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
          )}
        </Modal>
      )}
    </div>
  )
}

/** Минимальная форма «Задача от основателя».
 *  4 поля: title / description / assignee / priority.
 *  Дедлайн = выбранный день в календаре, проект не задаётся
 *  (direct task), исполнитель получает усиленное уведомление. */
function FounderQuickTaskForm({
  employees, loading, onClose, onSubmit,
}: {
  employees: any[]
  loading: boolean
  onClose: () => void
  onSubmit: (data: any) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { toast.error('Укажите название задачи'); return }
    if (!assigneeId) { toast.error('Выберите исполнителя'); return }
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeId,
      assigneeIds: [assigneeId],
      priority,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Название задачи *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="input"
          placeholder="Что нужно сделать?"
          autoFocus
        />
      </div>
      <div>
        <label className="label">Описание</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="input min-h-[80px] resize-y"
          placeholder="Детали, контекст (необязательно)"
        />
      </div>
      <div>
        <label className="label">Исполнитель *</label>
        <select
          value={assigneeId}
          onChange={e => setAssigneeId(e.target.value)}
          className="input"
        >
          <option value="">— Выберите сотрудника —</option>
          {employees
            .filter((emp: any) => emp.user?.id)
            .map((emp: any) => (
              <option key={emp.user.id} value={emp.user.id}>
                {emp.fullName}{emp.position ? ` · ${emp.position}` : ''}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label className="label">Приоритет *</label>
        <select
          value={priority}
          onChange={e => setPriority(e.target.value as any)}
          className="input"
        >
          <option value="low">Низкий</option>
          <option value="medium">Средний</option>
          <option value="high">Высокий</option>
          <option value="critical">Критический</option>
        </select>
      </div>
      <div className="text-xs text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3">
        👑 Сотрудник получит уведомление о прямой задаче от вас — на email,
        в Telegram и внутри сайта.
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">
          Отмена
        </button>
        <button type="submit" disabled={loading} className="btn-primary min-w-[140px] justify-center">
          {loading ? 'Отправляю...' : 'Отправить задачу'}
        </button>
      </div>
    </form>
  )
}
