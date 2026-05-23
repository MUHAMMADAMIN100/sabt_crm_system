import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi, projectsApi, tasksApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal } from '@/components/ui'
import { useTranslation } from '@/i18n'
import TaskForm from '@/components/tasks/TaskForm'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, isSameMonth, subDays, addDays, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ChevronDown, Plus, X, User, Calendar as CalIcon, Flag, FolderKanban, Edit, Trash2, Lock, Briefcase, Globe, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// Светофорная палитра: 🟢 старт = успех, 🔴 финиш = закрытие/риск, 🟡 задача = в работе.
const TYPE_COLORS: Record<string, string> = {
  project_start: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/50',
  project_end:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50',
  task:          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50',
  client_meeting:'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50',
}

// Scope чипы для задач — нужны для визуальной идентификации в календаре.
const SCOPE_COLORS: Record<string, string> = {
  personal: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900/50',
  business: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50',
  general:  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 border-sky-200 dark:border-sky-900/50',
}

const SCOPE_LABEL: Record<string, string> = {
  personal: '🔒 Личная',
  business: '💼 Для бизнеса',
  general:  '🌐 Общая',
}

type ScopeFilter = '' | 'personal' | 'business' | 'general'

export default function CalendarPage() {
  const [current, setCurrent] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('')
  // Side modal для просмотра деталей задачи при клике на event.
  const [detailEventId, setDetailEventId] = useState<string | null>(null)
  // Edit-режим для founder: клик по своей задаче в календаре открывает
  // ту же FounderQuickTaskForm в режиме редактирования.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  // Режим календаря: месяц или неделя (с часовой сеткой).
  const [calView, setCalView] = useState<'month' | 'week'>('month')
  // День, для которого открыт модал «все задачи дня» (клик по «+N ещё»).
  const [dayModalDate, setDayModalDate] = useState<Date | null>(null)
  // Час выбранного слота в недельном виде — для префилла времени задачи.
  const [selectedSlotHour, setSelectedSlotHour] = useState<number | null>(null)
  const { t } = useTranslation()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(user?.role || '')
  // МП по продажам получают календарь как у основателя, но без типа «Общая».
  const isSalesManager = user?.role === 'sales_manager_smm' || user?.role === 'sales_manager_dev'
  const isFounderView = user?.role === 'founder' || user?.role === 'co_founder' || isSalesManager
  // Создавать задачи кликом по дню могут менеджерские роли и МП по продажам.
  const canCreate = isManagerPlus || isFounderView

  // Диапазон загрузки событий зависит от режима: месяц или неделя.
  const periodStart = calView === 'week'
    ? startOfWeek(current, { weekStartsOn: 1 })
    : startOfMonth(current)
  const periodEnd = calView === 'week'
    ? endOfWeek(current, { weekStartsOn: 1 })
    : endOfMonth(current)
  const from = format(periodStart, 'yyyy-MM-dd')
  const to = format(periodEnd, 'yyyy-MM-dd')

  const { data: events } = useQuery({
    queryKey: ['calendar', from, to, scopeFilter],
    queryFn: () => calendarApi.events({
      from, to,
      ...(scopeFilter && { scope: scopeFilter }),
    }),
  })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list(), enabled: isManagerPlus || isFounderView })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list(), enabled: isManagerPlus || isFounderView })

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

  // Полная задача для prefill edit-формы (нужны assignees + scope).
  const { data: editingTaskFull } = useQuery({
    queryKey: ['task', editingTaskId],
    queryFn: () => tasksApi.get(editingTaskId!),
    enabled: !!editingTaskId,
  })

  // Сохранение из edit-формы founder
  const editTaskMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tasksApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', editingTaskId] })
      // Принудительный refetch — карточка в календаре должна сразу
      // перекраситься в цвет нового типа задачи (scope), а не ждать
      // следующего визита. invalidate помечает stale, refetch тянет
      // данные немедленно.
      qc.refetchQueries({ queryKey: ['calendar'], type: 'active' })
      setEditingTaskId(null)
      toast.success('Изменения сохранены')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('common.error')),
  })

  // Удаление задачи из edit-формы founder
  const deleteTaskMut = useMutation({
    mutationFn: (id: string) => tasksApi.remove(id, 'Удалено основателем из календаря'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setEditingTaskId(null)
      toast.success('Задача удалена')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('common.error')),
  })

  // Подтверждение задачи на проверке — основатель/со-основатель видит её в
  // календаре и может одобрить прямо из drawer-а или из edit-модалки.
  const approveTaskMut = useMutation({
    mutationFn: (id: string) => tasksApi.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', editingTaskId] })
      setEditingTaskId(null)
      setDetailEventId(null)
      toast.success('Задача подтверждена')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('common.error')),
  })

  /** Статусы, при которых задача ждёт подтверждения основателем. */
  const isApprovableStatus = (status?: string) =>
    !!status && ['review', 'on_pm_review', 'on_client_approval'].includes(status)
  /** Может ли текущий пользователь подтверждать задачи. */
  const canApprove = ['founder', 'co_founder', 'admin'].includes(user?.role || '')

  // Drag-and-drop: при сбросе задачи на другой день — обновляем deadline.
  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tasksApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Оптимистично обновляем event в кеше — мгновенный visual feedback.
      await qc.cancelQueries({ queryKey: ['calendar'] })
      const previous = qc.getQueryData(['calendar', from, to, scopeFilter])
      qc.setQueryData(['calendar', from, to, scopeFilter], (old: any[]) => {
        if (!Array.isArray(old)) return old
        return old.map((e: any) =>
          e.taskId === id ? { ...e, date: data.deadline } : e,
        )
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(['calendar', from, to, scopeFilter], ctx?.previous)
      toast.error('Не удалось перенести задачу')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  // Personal view: пользователь видит на календаре ТОЛЬКО свои задачи
  // (где он исполнитель или создатель). Без старт/конец проектов и без чужих
  // задач команды. См. оригинальный комментарий выше.
  const PERSONAL_VIEW_ROLES = [
    'founder', 'co_founder',
    'developer', 'designer', 'smm_specialist',
    'marketer', 'targetologist', 'employee', 'sales_manager_smm', 'sales_manager_dev',
  ]
  const isPersonalView = PERSONAL_VIEW_ROLES.includes(user?.role || '')

  const projectEvents = (events || []).filter((e: any) => {
    if (isPersonalView) {
      // МП по продажам — встречи с клиентами из онбординга всегда показываем.
      if (e.type === 'client_meeting') return true
      if (e.type !== 'task') return false
      return e.assigneeId === user?.id || e.createdById === user?.id
    }
    return e.type === 'project_start' || e.type === 'project_end' || e.type === 'task' || e.type === 'client_meeting'
  })

  const eventsForDay = (day: Date) =>
    projectEvents.filter((e: any) => isSameDay(new Date(e.date), day))

  const monthStart = startOfMonth(current)
  const monthEnd = endOfMonth(current)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = (getDay(monthStart) + 6) % 7
  const endPad = (7 - ((getDay(monthEnd) + 6) % 7) - 1 + 7) % 7
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
    setSelectedSlotHour(null)
    setShowTaskForm(true)
  }

  // Клик по часовому слоту в недельном виде — создаём задачу на это время.
  const handleSlotClick = (day: Date, hour: number) => {
    if (!canCreate) return
    setSelectedDay(day)
    setSelectedSlotHour(hour)
    setShowTaskForm(true)
  }

  const navigate = useNavigate()
  // Открытие события: МП по СММ — переход на подробную страницу задачи;
  // своя задача founder'а → edit-форма; иначе → side drawer.
  const openEvent = (e: any) => {
    if (e.type === 'task') {
      if (user?.role === 'sales_manager_smm' && e.taskId) {
        navigate(`/tasks/${e.taskId}`)
        return
      }
      const isOwnTask = e.taskId && (e.createdById === user?.id || e.assigneeId === user?.id)
      if (isFounderView && isOwnTask) setEditingTaskId(e.taskId)
      else setDetailEventId(e.id)
    } else if (e.link) {
      window.location.href = e.link
    }
  }

  // Drag handlers — переносим задачу на другой день при drop.
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, event: any) => {
    if (event.type !== 'task' || !event.taskId) {
      e.preventDefault()
      return
    }
    setDraggingEventId(event.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', event.taskId)
  }
  const handleDragEnd = () => {
    setDraggingEventId(null)
    setDragOverDay(null)
  }
  const handleDayDragOver = (e: React.DragEvent, day: Date) => {
    if (!draggingEventId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDay(format(day, 'yyyy-MM-dd'))
  }
  const handleDayDragLeave = (day: Date) => {
    if (dragOverDay === format(day, 'yyyy-MM-dd')) setDragOverDay(null)
  }
  const handleDayDrop = (e: React.DragEvent, day: Date) => {
    e.preventDefault()
    setDragOverDay(null)
    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId) return
    const evt = projectEvents.find((ev: any) => ev.taskId === taskId)
    if (!evt) return
    // Сохраняем время дедлайна — меняем только дату.
    const oldDate = new Date(evt.date)
    const newDeadline = new Date(day)
    newDeadline.setHours(oldDate.getHours(), oldDate.getMinutes(), 0, 0)
    if (isSameDay(oldDate, day)) {
      setDraggingEventId(null)
      return
    }
    updateTask.mutate({ id: taskId, data: { deadline: newDeadline.toISOString() } })
    setDraggingEventId(null)
  }

  const detailEvent = detailEventId
    ? projectEvents.find((e: any) => e.id === detailEventId) || null
    : null

  // Дедлайн для формы создания: дата выбранного дня + час слота (если задан
  // через недельный вид). FounderQuickTaskForm разберёт дату и время.
  const createInitialDeadline = selectedDay
    ? (selectedSlotHour != null
        ? `${format(selectedDay, 'yyyy-MM-dd')}T${String(selectedSlotHour).padStart(2, '0')}:00`
        : format(selectedDay, 'yyyy-MM-dd'))
    : undefined

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">{t('calendar.title')}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Переключатель режима: Месяц / Неделя */}
          <div className="flex gap-1 bg-surface-100 dark:bg-surface-700 p-1 rounded-full">
            {([['month', 'Месяц'], ['week', 'Неделя']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setCalView(v)}
                className={clsx(
                  'px-3 py-1 text-xs font-semibold rounded-full transition-colors',
                  calView === v
                    ? 'bg-primary-600 text-white'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
                )}
              >{label}</button>
            ))}
          </div>
          <button
            onClick={() => setCurrent(d => calView === 'week'
              ? subWeeks(d, 1)
              : new Date(d.getFullYear(), d.getMonth() - 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
            aria-label="Назад"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center capitalize text-surface-900 dark:text-surface-100">
            {calView === 'week'
              ? `${format(periodStart, 'd MMM', { locale: ru })} – ${format(periodEnd, 'd MMM', { locale: ru })}`
              : `${format(current, 'LLLL yyyy', { locale: ru })} г.`}
          </span>
          <button
            onClick={() => setCurrent(d => calView === 'week'
              ? addWeeks(d, 1)
              : new Date(d.getFullYear(), d.getMonth() + 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
            aria-label="Вперёд"
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

      {/* Фильтр по типу задачи: Личные / Бизнес / Общие.
          Заменил собой старый фильтр по проектам — для founder/co_founder
          именно эта классификация важна, не проекты. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-surface-500 dark:text-surface-400 mr-1">Тип:</span>
        {[
          { value: '' as ScopeFilter, label: 'Все', icon: null },
          { value: 'personal' as ScopeFilter, label: 'Личные',     icon: <Lock size={11} /> },
          { value: 'business' as ScopeFilter, label: 'Для бизнеса', icon: <Briefcase size={11} /> },
          { value: 'general'  as ScopeFilter, label: 'Общие',      icon: <Globe size={11} /> },
        ].filter(opt => !isSalesManager || opt.value !== 'general').map(opt => (
          <button
            key={opt.value || 'all'}
            onClick={() => setScopeFilter(opt.value)}
            className={clsx(
              'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
              scopeFilter === opt.value
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
            )}
          >
            {opt.icon}{opt.label}
          </button>
        ))}
      </div>

      {calView === 'week' ? (
        <WeekView
          weekStart={periodStart}
          events={projectEvents}
          canCreate={canCreate}
          onSlotClick={handleSlotClick}
          onEventClick={openEvent}
          onMoveEvent={(evt, day, hour) => {
            if (!evt.taskId) return
            const oldDate = new Date(evt.date)
            const newDeadline = new Date(day)
            newDeadline.setHours(hour, oldDate.getMinutes() || 0, 0, 0)
            updateTask.mutate({ id: evt.taskId, data: { deadline: newDeadline.toISOString() } })
          }}
        />
      ) : (
      <>
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
            const dayKey = format(day, 'yyyy-MM-dd')
            const isDropTarget = dragOverDay === dayKey
            return (
              <div
                key={day.toISOString()}
                onClick={() => handleDayClick(day)}
                onDragOver={(e) => handleDayDragOver(e, day)}
                onDragLeave={() => handleDayDragLeave(day)}
                onDrop={(e) => handleDayDrop(e, day)}
                className={clsx(
                  'min-h-[120px] rounded-2xl border p-3 transition-all group overflow-hidden flex flex-col',
                  inMonth
                    ? 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700'
                    : 'bg-primary-50/40 dark:bg-primary-900/10 border-primary-100/60 dark:border-primary-900/30',
                  today && 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800',
                  canCreate && inMonth && 'cursor-pointer hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm',
                  canCreate && !inMonth && 'cursor-pointer hover:bg-primary-50/70 dark:hover:bg-primary-900/20',
                  isDropTarget && 'ring-2 ring-primary-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-900 scale-[1.02] shadow-lg',
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
                  {dayEvents.slice(0, 3).map((e: any) => {
                    const colorClass = e.type === 'task' && e.scope
                      ? SCOPE_COLORS[e.scope] || TYPE_COLORS.task
                      : (TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700')
                    const isDraggable = e.type === 'task' && !!e.taskId
                    return (
                      <button
                        key={e.id}
                        type="button"
                        draggable={isDraggable}
                        onDragStart={(ev) => handleDragStart(ev, e)}
                        onDragEnd={handleDragEnd}
                        onClick={ev => { ev.stopPropagation(); openEvent(e) }}
                        title={e.title}
                        className={clsx(
                          'flex items-center gap-1 w-full text-left text-[11px] px-1.5 py-0.5 rounded border font-medium transition-opacity',
                          colorClass,
                          isDraggable && 'cursor-grab active:cursor-grabbing',
                          draggingEventId === e.id && 'opacity-40',
                        )}
                      >
                        {e.scope === 'personal' && <Lock className="shrink-0" size={9} />}
                        <span className="truncate flex-1 min-w-0">{e.title}</span>
                        {/* Прогресс % — только для основателя/сооснователя. */}
                        {isFounderView && e.type === 'task' && typeof e.progress === 'number' && (
                          <span className={clsx(
                            'shrink-0 text-[9px] font-bold px-1 rounded',
                            e.progress >= 100
                              ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                              : e.progress > 0
                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                : 'bg-surface-400/20 text-surface-500 dark:text-surface-400',
                          )}>
                            {e.progress}%
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <button
                      type="button"
                      onClick={ev => { ev.stopPropagation(); setDayModalDate(day) }}
                      className="text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:underline px-1 text-left w-full"
                    >
                      +{dayEvents.length - 3} ещё
                    </button>
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
                    {dayEvents.map((e: any) => {
                      const colorClass = e.type === 'task' && e.scope
                        ? SCOPE_COLORS[e.scope] || TYPE_COLORS.task
                        : (TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700')
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={ev => { ev.stopPropagation(); openEvent(e) }}
                          className={clsx(
                            'text-left text-xs px-2 py-1 rounded border truncate font-medium',
                            colorClass,
                          )}
                        >
                          {e.scope === 'personal' && <Lock className="inline mr-0.5" size={10} />}
                          {e.title}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      </>
      )}

      {/* ─── Status legend (compact) ─────────────────────────────── */}
      <div className="card p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-semibold text-surface-700 dark:text-surface-200">Легенда:</span>
        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900/50">
          🔒 Личная
        </span>
        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50">
          💼 Для бизнеса
        </span>
        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 border-sky-200 dark:border-sky-900/50">
          🌐 Общая
        </span>
        {!scopeFilter && (
          <>
            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/50">
              Старт проекта
            </span>
            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50">
              Конец проекта
            </span>
          </>
        )}
        <span className="ml-auto text-[11px] text-surface-400 dark:text-surface-500">
          💡 Задачи можно перетаскивать на другой день
        </span>
      </div>

      {/* Task create modal */}
      {canCreate && showTaskForm && (
        <Modal
          open={showTaskForm}
          onClose={() => setShowTaskForm(false)}
          title={`${isSalesManager ? 'Новая задача' : isFounderView ? 'Задача от основателя' : t('calendar.addTask')}${selectedDay ? ' — ' + format(selectedDay, 'dd.MM.yyyy') : ''}`}
          size="lg"
        >
          {isFounderView ? (
            <FounderQuickTaskForm
              employees={employees || []}
              loading={createTask.isPending}
              onClose={() => setShowTaskForm(false)}
              initialDeadline={createInitialDeadline}
              allowGeneral={!isSalesManager}
              projects={isSalesManager ? (projects || []) : undefined}
              onSubmit={data => createTask.mutate({
                ...data,
                // deadline (дата+время) приходит из формы.
                // fromFounder — только для бизнес/общих задач основателя;
                // у МП по продажам задачи не помечаются «от основателя».
                fromFounder: !isSalesManager && data.scope !== 'personal',
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

      {/* Edit-модалка для founder при клике на свою задачу */}
      {isFounderView && editingTaskId && (
        <Modal
          open={!!editingTaskId}
          onClose={() => setEditingTaskId(null)}
          title={`Редактировать задачу${editingTaskFull?.deadline ? ' — ' + format(new Date(editingTaskFull.deadline), 'dd.MM.yyyy') : ''}`}
          size="lg"
        >
          {!editingTaskFull ? (
            <div className="space-y-4 py-1 animate-pulse">
              <div className="h-5 w-28 rounded bg-surface-100 dark:bg-surface-700" />
              <div className="grid grid-cols-3 gap-2">
                <div className="h-16 rounded-xl bg-surface-100 dark:bg-surface-700" />
                <div className="h-16 rounded-xl bg-surface-100 dark:bg-surface-700" />
                <div className="h-16 rounded-xl bg-surface-100 dark:bg-surface-700" />
              </div>
              <div className="h-9 rounded-xl bg-surface-100 dark:bg-surface-700" />
              <div className="h-20 rounded-xl bg-surface-100 dark:bg-surface-700" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-9 rounded-xl bg-surface-100 dark:bg-surface-700" />
                <div className="h-9 rounded-xl bg-surface-100 dark:bg-surface-700" />
              </div>
              <div className="h-9 rounded-xl bg-surface-100 dark:bg-surface-700" />
            </div>
          ) : (
            <>
            {editingTaskFull.createdAt && (
              <div className="text-[11px] text-surface-400 dark:text-surface-500 -mt-2 mb-2">
                🕐 Создана: {format(new Date(editingTaskFull.createdAt), 'dd.MM.yyyy HH:mm', { locale: ru })}
              </div>
            )}
            {/* Большой статус-баннер + кнопка подтверждения для основателя. */}
            {editingTaskFull.status && (
              <div className={clsx(
                'rounded-xl px-3 py-2 flex items-center gap-3 mb-3 text-sm',
                ['done', 'approved', 'published'].includes(editingTaskFull.status)
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : isApprovableStatus(editingTaskFull.status)
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
              )}>
                <span className="font-semibold">
                  {['done', 'approved', 'published'].includes(editingTaskFull.status) && '✅ '}
                  {isApprovableStatus(editingTaskFull.status) && '⏳ '}
                  Статус: {{
                    new: 'Новая', in_progress: 'В работе', review: 'На ревью',
                    returned: 'Возвращена', done: 'Выполнена', cancelled: 'Отменена',
                    accepted: 'Принята', on_pm_review: 'На проверке PM', on_rework: 'На доработке',
                    on_client_approval: 'У клиента', approved: 'Утверждено', published: 'Опубликовано',
                    rescheduled: 'Перенесена',
                  }[editingTaskFull.status as string] || editingTaskFull.status}
                </span>
                {canApprove && isApprovableStatus(editingTaskFull.status) && (
                  <button
                    type="button"
                    onClick={() => approveTaskMut.mutate(editingTaskFull.id)}
                    disabled={approveTaskMut.isPending}
                    className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {approveTaskMut.isPending ? 'Подтверждение…' : '✅ Подтвердить'}
                  </button>
                )}
              </div>
            )}
            <FounderQuickTaskForm
              employees={employees || []}
              loading={editTaskMut.isPending || deleteTaskMut.isPending}
              onClose={() => setEditingTaskId(null)}
              initialDeadline={editingTaskFull.deadline || undefined}
              allowGeneral={!isSalesManager}
              projects={isSalesManager ? (projects || []) : undefined}
              onDelete={() => {
                if (confirm('Удалить задачу?')) deleteTaskMut.mutate(editingTaskFull.id)
              }}
              initial={{
                id: editingTaskFull.id,
                title: editingTaskFull.title,
                description: editingTaskFull.description || undefined,
                scope: (editingTaskFull.scope || 'business') as any,
                priority: editingTaskFull.priority || 'medium',
                assigneeIds: Array.isArray(editingTaskFull.assignees) && editingTaskFull.assignees.length > 0
                  ? editingTaskFull.assignees.map((a: any) => a.userId || a.user?.id).filter(Boolean)
                  : (editingTaskFull.assigneeId ? [editingTaskFull.assigneeId] : []),
                subtasks: Array.isArray(editingTaskFull.acceptanceCriteria)
                  ? editingTaskFull.acceptanceCriteria
                  : [],
                projectId: editingTaskFull.projectId || undefined,
              }}
              onSubmit={data => editTaskMut.mutate({
                id: editingTaskFull.id,
                data: {
                  title: data.title,
                  description: data.description,
                  priority: data.priority,
                  // scope теперь редактируемый — отправляем всегда.
                  scope: data.scope,
                  acceptanceCriteria: data.acceptanceCriteria,
                  // Дедлайн (дата + время) из формы.
                  deadline: data.deadline,
                  // Исполнители — только для business; для personal/general
                  // отправляем пустой массив чтобы backend очистил.
                  assigneeIds: data.scope === 'business' ? (data.assigneeIds || []) : [],
                  assigneeId: data.scope === 'business' ? data.assigneeId : null,
                  // Проект — только в форме МП (у основателя поля нет —
                  // тогда projectId не трогаем). Для не-бизнес задач отвязываем.
                  projectId: !isSalesManager
                    ? undefined
                    : (data.scope === 'business' ? (data.projectId || null) : null),
                },
              })}
            />
            </>
          )}
        </Modal>
      )}

      {/* Side drawer с деталями задачи */}
      <TaskDetailDrawer
        event={detailEvent}
        onClose={() => setDetailEventId(null)}
        onDelete={async () => {
          if (!detailEvent?.taskId) return
          if (!confirm('Удалить задачу?')) return
          try {
            await tasksApi.remove(detailEvent.taskId, 'Удалено из календаря')
            qc.invalidateQueries({ queryKey: ['calendar'] })
            qc.invalidateQueries({ queryKey: ['tasks'] })
            toast.success('Задача удалена')
            setDetailEventId(null)
          } catch {
            toast.error(t('common.error'))
          }
        }}
        onApprove={
          canApprove && detailEvent?.taskId && isApprovableStatus(detailEvent.status)
            ? () => approveTaskMut.mutate(detailEvent.taskId)
            : undefined
        }
        approving={approveTaskMut.isPending}
      />

      {/* Модал «все задачи дня» — открывается по клику на «+N ещё». */}
      {dayModalDate && (
        <Modal
          open
          onClose={() => setDayModalDate(null)}
          title={`Задачи на ${format(dayModalDate, 'd MMMM', { locale: ru })}`}
          size="md"
        >
          <div className="space-y-1.5">
            {eventsForDay(dayModalDate).map((e: any) => {
              const colorClass = e.type === 'task' && e.scope
                ? SCOPE_COLORS[e.scope] || TYPE_COLORS.task
                : (TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700')
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { setDayModalDate(null); openEvent(e) }}
                  className={clsx(
                    'flex items-center gap-2 w-full text-left text-sm px-3 py-2 rounded-lg border font-medium',
                    colorClass,
                  )}
                >
                  {e.scope === 'personal' && <Lock size={12} className="shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">{e.title}</span>
                  {e.type === 'task' && typeof e.progress === 'number' && (
                    <span className="shrink-0 text-[10px] font-bold">{e.progress}%</span>
                  )}
                </button>
              )
            })}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Недельный вид с часовой сеткой ──────────────────────────────────
/** Видимый диапазон часов недельного вида. События вне диапазона
 *  «прижимаются» к крайнему часу, чтобы не теряться. */
const WEEK_HOURS = Array.from({ length: 14 }, (_, i) => i + 8) // 8:00..21:00
const WK_MIN = 8
const WK_MAX = 21

function WeekView({
  weekStart, events, canCreate, onSlotClick, onEventClick, onMoveEvent,
}: {
  weekStart: Date
  events: any[]
  canCreate: boolean
  onSlotClick: (day: Date, hour: number) => void
  onEventClick: (e: any) => void
  /** Перетаскивание задачи в конкретный день+час. Меняет полную дату дедлайна. */
  onMoveEvent?: (event: any, day: Date, hour: number) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const slotHour = (e: any) => {
    const h = new Date(e.date).getHours()
    return Math.min(WK_MAX, Math.max(WK_MIN, h))
  }
  const cols = { gridTemplateColumns: '60px repeat(7, minmax(0, 1fr))' }

  // События «весь день» (без времени или в полночь) — выносим в шапку,
  // чтобы не съедали часовой слот.
  const allDay = events.filter(e => {
    const d = new Date(e.date)
    return d.getHours() === 0 && d.getMinutes() === 0
  })
  const timed = events.filter(e => {
    const d = new Date(e.date)
    return !(d.getHours() === 0 && d.getMinutes() === 0)
  })

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const onDragStart = (ev: React.DragEvent, e: any) => {
    if (!onMoveEvent || e.type !== 'task' || !e.taskId) { ev.preventDefault(); return }
    setDraggingId(e.id)
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', e.id)
  }
  const onDragOverCell = (ev: React.DragEvent, key: string) => {
    if (!draggingId) return
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
    setHoverKey(key)
  }
  const onDropCell = (ev: React.DragEvent, day: Date, hour: number) => {
    ev.preventDefault()
    setHoverKey(null)
    const id = ev.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    if (!id) return
    const e = events.find((x: any) => x.id === id)
    if (e && onMoveEvent) onMoveEvent(e, day, hour)
  }

  return (
    <div className="card p-0 overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Заголовок — день недели + число (как в референсе) */}
        <div className="grid border-b border-surface-200 dark:border-surface-700 sticky top-0 z-10 bg-white dark:bg-surface-900" style={cols}>
          <div className="text-[10px] text-surface-400 dark:text-surface-500 px-2 py-2 uppercase tracking-wide flex items-end justify-end">
            GMT+5
          </div>
          {days.map(d => {
            const today = isToday(d)
            return (
              <div
                key={d.toISOString()}
                className={clsx(
                  'text-center py-2 border-l border-surface-100 dark:border-surface-700',
                  today && 'bg-primary-50 dark:bg-primary-900/20',
                )}
              >
                <div className="text-[10px] text-surface-400 dark:text-surface-500 uppercase tracking-wide">
                  {format(d, 'EEE', { locale: ru })}
                </div>
                <div className={clsx(
                  'text-base font-semibold tabular-nums',
                  today ? 'text-primary-600 dark:text-primary-400' : 'text-surface-700 dark:text-surface-200',
                )}>{format(d, 'd')}</div>
              </div>
            )
          })}
        </div>

        {/* Строка «весь день» */}
        <div className="grid border-b border-surface-100 dark:border-surface-700 bg-surface-50/40 dark:bg-surface-800/30" style={cols}>
          <div className="text-[10px] text-surface-400 dark:text-surface-500 px-2 py-1.5 text-right select-none">
            All-day
          </div>
          {days.map(d => {
            const cellEvents = allDay.filter((e: any) => isSameDay(new Date(e.date), d))
            return (
              <div
                key={d.toISOString()}
                className="border-l border-surface-100 dark:border-surface-700 min-h-[28px] p-1 space-y-0.5"
              >
                {cellEvents.map((e: any) => {
                  const colorClass = e.type === 'task' && e.scope
                    ? SCOPE_COLORS[e.scope] || TYPE_COLORS.task
                    : (TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700')
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={ev => { ev.stopPropagation(); onEventClick(e) }}
                      title={e.title}
                      className={clsx(
                        'flex items-center gap-1 w-full text-left text-[11px] px-1.5 py-0.5 rounded border font-medium',
                        colorClass,
                      )}
                    >
                      {e.scope === 'personal' && <Lock size={9} className="shrink-0" />}
                      <span className="truncate flex-1 min-w-0">{e.title}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Часовые строки */}
        {WEEK_HOURS.map(h => (
          <div
            key={h}
            className="grid border-b border-surface-50 dark:border-surface-800"
            style={cols}
          >
            <div className="text-[10px] text-surface-400 dark:text-surface-500 text-right pr-2 py-1 select-none tabular-nums">
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map(d => {
              const cellEvents = timed.filter(
                (e: any) => isSameDay(new Date(e.date), d) && slotHour(e) === h,
              )
              const key = `${format(d, 'yyyy-MM-dd')}-${h}`
              const isHover = hoverKey === key
              return (
                <div
                  key={d.toISOString()}
                  onClick={() => canCreate && onSlotClick(d, h)}
                  onDragOver={(ev) => onDragOverCell(ev, key)}
                  onDragLeave={() => { if (isHover) setHoverKey(null) }}
                  onDrop={(ev) => onDropCell(ev, d, h)}
                  className={clsx(
                    'border-l border-surface-100 dark:border-surface-700 min-h-[44px] p-1 space-y-1 transition-colors',
                    canCreate && 'cursor-pointer hover:bg-primary-50/40 dark:hover:bg-primary-900/10',
                    isHover && 'bg-primary-100/60 dark:bg-primary-900/30 ring-2 ring-primary-400 ring-inset',
                  )}
                >
                  {cellEvents.map((e: any) => {
                    const colorClass = e.type === 'task' && e.scope
                      ? SCOPE_COLORS[e.scope] || TYPE_COLORS.task
                      : (TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700')
                    const eventTime = format(new Date(e.date), 'HH:mm')
                    const draggable = !!onMoveEvent && e.type === 'task' && !!e.taskId
                    return (
                      <button
                        key={e.id}
                        type="button"
                        draggable={draggable}
                        onDragStart={(ev) => onDragStart(ev, e)}
                        onDragEnd={() => { setDraggingId(null); setHoverKey(null) }}
                        onClick={ev => { ev.stopPropagation(); onEventClick(e) }}
                        title={`${eventTime} · ${e.title}`}
                        className={clsx(
                          'flex items-center gap-1 w-full text-left text-[11px] px-1.5 py-0.5 rounded border font-medium',
                          colorClass,
                          draggable && 'cursor-grab active:cursor-grabbing',
                          draggingId === e.id && 'opacity-50',
                        )}
                      >
                        {e.scope === 'personal' && <Lock size={9} className="shrink-0" />}
                        <span className="text-[10px] tabular-nums opacity-70 shrink-0">{eventTime}</span>
                        <span className="truncate flex-1 min-w-0">{e.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Форма «Задача от основателя» — поддерживает 3 scope и режим редактирования.
 *
 *  - personal: только для founder, никаких уведомлений
 *  - business: выбор НЕСКОЛЬКИХ исполнителей через чипы, каждому 3-канальное
 *    уведомление от backend (in-app + email + telegram)
 *  - general: assignees не выбираются, backend разошлёт всем активным
 *    сотрудникам по трём каналам
 *
 *  В edit-режиме (initial задан) scope зафиксирован — менять нельзя
 *  (иначе ретроспективно разошлёт уведомления).
 */
function FounderQuickTaskForm({
  employees, loading, onClose, onSubmit, onDelete, initial, initialDeadline,
  allowGeneral = true, projects,
}: {
  employees: any[]
  loading: boolean
  onClose: () => void
  onSubmit: (data: any) => void
  onDelete?: () => void
  initial?: {
    id: string
    title?: string
    description?: string
    scope?: 'personal' | 'business' | 'general'
    priority?: 'low' | 'medium' | 'high' | 'critical'
    assigneeIds?: string[]
    subtasks?: Array<{ id: string; text: string; done: boolean; assigneeId?: string }>
    projectId?: string
  }
  // Дедлайн для префилла: полный ISO (режим правки) либо дата YYYY-MM-DD
  // выбранного дня календаря (режим создания).
  initialDeadline?: string
  // Доступен ли тип «Общая». У МП по продажам — только личная/бизнес.
  allowGeneral?: boolean
  // Список доступных проектов. Если передан — в форме появляется выбор
  // проекта (для бизнес-задач). Не передаётся форме основателя.
  projects?: any[]
}) {
  const isEdit = !!initial
  const initialScope = initial?.scope || 'business'
  const [scope, setScope] = useState<'personal' | 'business' | 'general'>(
    !allowGeneral && initialScope === 'general' ? 'business' : initialScope,
  )
  const [title, setTitle] = useState(initial?.title || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.assigneeIds || [])
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>(initial?.priority || 'medium')
  const [search, setSearch] = useState('')
  // Дропдаун исполнителей — закрыт по умолчанию, открывается по клику.
  const [pickerOpen, setPickerOpen] = useState(false)
  // Подзадачи — список пунктов внутри задачи, у каждой свой исполнитель.
  const [subtasks, setSubtasks] = useState<Array<{ id: string; text: string; done: boolean; assigneeId?: string }>>(
    initial?.subtasks || [],
  )
  const [newSubtask, setNewSubtask] = useState('')
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState('')
  // Проект задачи (для бизнес-задач). Список приходит пропом projects.
  const [projectId, setProjectId] = useState<string>(initial?.projectId || '')
  // Дата + время дедлайна. Из initialDeadline: полный ISO → дата+время,
  // короткая дата (YYYY-MM-DD) → дата + время по умолчанию 12:00.
  const initDeadline = useMemo(() => {
    if (!initialDeadline) return { date: '', time: '12:00' }
    if (initialDeadline.includes('T')) {
      const dt = new Date(initialDeadline)
      if (!isNaN(dt.getTime())) {
        return { date: format(dt, 'yyyy-MM-dd'), time: format(dt, 'HH:mm') }
      }
    }
    return { date: initialDeadline.slice(0, 10), time: '12:00' }
  }, [initialDeadline])
  const [deadlineDate, setDeadlineDate] = useState(initDeadline.date)
  const [deadlineTime, setDeadlineTime] = useState(initDeadline.time)

  const eligibleEmployees = useMemo(
    () => (employees || []).filter((emp: any) => emp.user?.id),
    [employees],
  )
  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return eligibleEmployees
    const q = search.trim().toLowerCase()
    return eligibleEmployees.filter((emp: any) =>
      (emp.fullName || '').toLowerCase().includes(q) ||
      (emp.position || '').toLowerCase().includes(q),
    )
  }, [eligibleEmployees, search])

  const toggleAssignee = (uid: string) => {
    setSelectedIds(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid])
  }

  const addSubtask = () => {
    const text = newSubtask.trim()
    if (!text) return
    setSubtasks(prev => [...prev, {
      id: crypto.randomUUID(), text, done: false,
      assigneeId: newSubtaskAssignee || undefined,
    }])
    setNewSubtask('')
    setNewSubtaskAssignee('')
  }
  const removeSubtask = (id: string) => setSubtasks(prev => prev.filter(s => s.id !== id))
  const setSubtaskAssignee = (id: string, assigneeId: string) =>
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, assigneeId: assigneeId || undefined } : s))
  const empName = (uid?: string) =>
    uid ? (eligibleEmployees.find((e: any) => e.user?.id === uid)?.fullName || '') : ''

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { toast.error('Укажите название задачи'); return }
    if (scope === 'business' && selectedIds.length === 0) {
      toast.error('Выберите хотя бы одного исполнителя')
      return
    }
    onSubmit({
      scope,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      // personal — без исполнителей (backend сам выставит создателя).
      // general — без исполнителей (backend разошлёт всем).
      // business — массив выбранных.
      assigneeId: scope === 'business' && selectedIds[0] ? selectedIds[0] : undefined,
      assigneeIds: scope === 'business' ? selectedIds : undefined,
      // Проект — только у бизнес-задач (личная задача проекта не имеет).
      projectId: scope === 'business' ? (projectId || undefined) : undefined,
      // Подзадачи сохраняем в acceptanceCriteria задачи.
      acceptanceCriteria: subtasks,
      // Дедлайн: дата + время. Собираем в локальном времени и переводим
      // в ISO, чтобы часы корректно отображались (часовой пояс Душанбе).
      deadline: deadlineDate
        ? new Date(`${deadlineDate}T${deadlineTime || '12:00'}`).toISOString()
        : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Селектор типа задачи — редактируемый и при создании, и при правке. */}
      <div>
        <label className="label">Тип задачи *</label>
        <div className={clsx('grid gap-2', allowGeneral ? 'grid-cols-3' : 'grid-cols-2')}>
          {[
            { v: 'personal' as const, icon: <Lock size={14} />,      label: 'Личная',      hint: 'Только для меня' },
            { v: 'business' as const, icon: <Briefcase size={14} />, label: 'Для бизнеса', hint: 'Выбранным сотрудникам' },
            { v: 'general'  as const, icon: <Globe size={14} />,     label: 'Общая',       hint: 'Для всей команды' },
          ].filter(opt => allowGeneral || opt.v !== 'general').map(opt => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setScope(opt.v)}
              className={clsx(
                'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all',
                scope === opt.v
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                  : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 text-surface-600 dark:text-surface-400',
              )}
            >
              {opt.icon}
              <span className="text-sm font-medium">{opt.label}</span>
              <span className="text-[10px] text-surface-400 dark:text-surface-500">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

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

      {/* Проект задачи — только для бизнес-задач и если список передан */}
      {scope === 'business' && projects && projects.length > 0 && (
        <div>
          <label className="label">Проект <span className="text-[11px] text-surface-400 font-normal">— необязательно</span></label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="input"
          >
            <option value="">— Без проекта —</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Multi-select исполнителей — дропдаун (только business) */}
      {scope === 'business' && (
        <div>
          <label className="label">Исполнители * <span className="text-[11px] text-surface-400 font-normal">— получат in-app, email, Telegram</span></label>
          {/* Чипы выбранных */}
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedIds.map(uid => {
                const emp = eligibleEmployees.find((e: any) => e.user?.id === uid)
                return (
                  <span
                    key={uid}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs"
                  >
                    {emp?.fullName || uid.slice(0, 8)}
                    <button type="button" onClick={() => toggleAssignee(uid)} className="hover:text-red-500">×</button>
                  </span>
                )
              })}
            </div>
          )}
          {/* Кнопка-селект: клик открывает список */}
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            className="input flex items-center justify-between w-full text-left"
          >
            <span className={selectedIds.length ? '' : 'text-surface-400'}>
              {selectedIds.length
                ? `Выбрано: ${selectedIds.length}`
                : 'Выберите исполнителей'}
            </span>
            <ChevronDown size={16} className={clsx('transition-transform', pickerOpen && 'rotate-180')} />
          </button>
          {pickerOpen && (
            <div className="mt-2 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по имени или должности..."
                className="input border-0 border-b border-surface-100 dark:border-surface-700 rounded-none"
                autoFocus
              />
              <div className="max-h-48 overflow-y-auto divide-y divide-surface-100 dark:divide-surface-700">
                {filteredEmployees.length === 0 ? (
                  <div className="p-3 text-xs text-surface-400 text-center">Никого не найдено</div>
                ) : filteredEmployees.map((emp: any) => {
                  const checked = selectedIds.includes(emp.user.id)
                  return (
                    <label
                      key={emp.user.id}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
                        checked ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-surface-50 dark:hover:bg-surface-700/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignee(emp.user.id)}
                        className="rounded"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{emp.fullName}</div>
                        {emp.position && <div className="text-[11px] text-surface-400 truncate">{emp.position}</div>}
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Подсказка для general */}
      {scope === 'general' && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            🌐 <strong>Общая задача:</strong> уведомление получат <strong>все активные сотрудники</strong> компании
            по 3 каналам: in-app, email и Telegram. Задача будет видна всем в их календаре.
          </p>
        </div>
      )}

      {/* Подзадачи — у каждой свой исполнитель */}
      <div>
        <label className="label">Подзадачи</label>
        {subtasks.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {subtasks.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
                <span className="text-xs text-surface-400 w-5 shrink-0">{idx + 1}.</span>
                <span className="text-sm flex-1 min-w-0 truncate">{s.text}</span>
                {/* Исполнитель подзадачи — не показываем для личных задач. */}
                {scope !== 'personal' && (
                  <select
                    value={s.assigneeId || ''}
                    onChange={e => setSubtaskAssignee(s.id, e.target.value)}
                    className="text-xs bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded px-1.5 py-1 max-w-[140px] shrink-0"
                    title={s.assigneeId ? `Исполнитель: ${empName(s.assigneeId)}` : 'Без исполнителя'}
                  >
                    <option value="">— исполнитель —</option>
                    {eligibleEmployees.map((emp: any) => (
                      <option key={emp.user.id} value={emp.user.id}>{emp.fullName}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => removeSubtask(s.id)}
                  className="text-surface-400 hover:text-red-500 shrink-0"
                ><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={newSubtask}
            onChange={e => setNewSubtask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
            placeholder="Добавить подзадачу..."
            className="input flex-1 min-w-[160px]"
          />
          {scope !== 'personal' && (
            <select
              value={newSubtaskAssignee}
              onChange={e => setNewSubtaskAssignee(e.target.value)}
              className="input w-auto shrink-0"
              title="Исполнитель новой подзадачи"
            >
              <option value="">— исполнитель —</option>
              {eligibleEmployees.map((emp: any) => (
                <option key={emp.user.id} value={emp.user.id}>{emp.fullName}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={addSubtask} className="btn-secondary px-3 shrink-0">
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* Дедлайн — дата и время (часы) */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Дата дедлайна</label>
          <input
            type="date"
            value={deadlineDate}
            onChange={e => setDeadlineDate(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Время</label>
          <input
            type="time"
            value={deadlineTime}
            onChange={e => setDeadlineTime(e.target.value)}
            className="input"
          />
        </div>
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

      <div className="flex gap-2 justify-end pt-2">
        {isEdit && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={loading}
            className="btn-secondary text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 mr-auto"
          >
            <Trash2 size={15} /> Удалить
          </button>
        )}
        <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">
          Отмена
        </button>
        <button type="submit" disabled={loading} className="btn-primary min-w-[140px] justify-center">
          {loading
            ? (isEdit ? 'Сохраняю...' : 'Создаю...')
            : isEdit
              ? 'Сохранить изменения'
              : scope === 'personal' ? 'Сохранить заметку' : scope === 'general' ? 'Разослать всей команде' : 'Отправить задачу'}
        </button>
      </div>
    </form>
  )
}

/** Side drawer справа с подробной информацией о задаче.
 *  Появляется с анимированным скольжением. ESC и клик по overlay закрывают.
 *  Заменяет переход на `/tasks/:id` для быстрого просмотра. */
/** Цвет статуса задачи для крупного баннера в drawer-е. */
const STATUS_BANNER_COLORS: Record<string, string> = {
  new:                'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  accepted:           'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  in_progress:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  review:             'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  on_pm_review:       'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  on_client_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  done:               'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  approved:           'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  published:          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  returned:           'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  on_rework:          'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cancelled:          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  rescheduled:        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

function TaskDetailDrawer({
  event,
  onClose,
  onDelete,
  onApprove,
  approving,
}: {
  event: any | null
  onClose: () => void
  onDelete: () => void
  onApprove?: () => void
  approving?: boolean
}) {
  const isOpen = !!event
  const previousActive = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    previousActive.current = document.activeElement as HTMLElement
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previousActive.current?.focus()
    }
  }, [isOpen, onClose])

  if (!event) return null

  const priorityLabels: Record<string, string> = {
    low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический',
  }
  const priorityColors: Record<string, string> = {
    low: 'text-sky-600 bg-sky-50 dark:bg-sky-900/30',
    medium: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30',
    high: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30',
    critical: 'text-red-600 bg-red-50 dark:bg-red-900/30',
  }
  const statusLabels: Record<string, string> = {
    new: 'Новая', in_progress: 'В работе', review: 'На ревью',
    returned: 'Возвращена', done: 'Выполнена', cancelled: 'Отменена',
    accepted: 'Принята', on_pm_review: 'На проверке PM', on_rework: 'На доработке',
    on_client_approval: 'У клиента', approved: 'Утверждено', published: 'Опубликовано',
    rescheduled: 'Перенесена',
  }

  return (
    <>
      {/* Overlay — сильный блюр + затемнение чтобы остальное размылось
          и фокус оставался на drawer'е. */}
      <div
        onClick={onClose}
        className={clsx(
          'fixed inset-0 z-40 bg-black/60 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        style={{ WebkitBackdropFilter: 'blur(10px)', backdropFilter: 'blur(10px)' }}
      />
      {/* Drawer справа — flex column для корректной работы footer'а
          на узких лаптопах. Ширина адаптивная по breakpoint'ам. */}
      <aside
        role="dialog"
        aria-modal="true"
        className={clsx(
          'fixed top-0 right-0 z-50 h-full bg-white dark:bg-surface-900 shadow-2xl border-l border-surface-200 dark:border-surface-700',
          'w-full sm:w-[440px] lg:w-[520px] xl:w-[600px]',
          'flex flex-col',
          'transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header — фиксирован сверху естественным flex'ом */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-surface-700 bg-white dark:bg-surface-900">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className={clsx(
              'inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap',
              SCOPE_COLORS[event.scope] || 'bg-surface-100 text-surface-600',
            )}>
              {SCOPE_LABEL[event.scope] || event.scope}
            </span>
            {event.fromFounder && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 whitespace-nowrap">
                👑 От основателя
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors shrink-0"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — растягивается и скроллится; footer не перекрывает контент */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {/* Большой статус-баннер: с одного взгляда видно, в каком состоянии задача. */}
          {event.type === 'task' && event.status && (
            <div className={clsx(
              'rounded-xl px-4 py-3 flex items-center gap-3',
              STATUS_BANNER_COLORS[event.status] || 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
            )}>
              <span className="text-sm font-semibold">
                {['done', 'approved', 'published'].includes(event.status) && '✅ '}
                {['review', 'on_pm_review', 'on_client_approval'].includes(event.status) && '⏳ '}
                {statusLabels[event.status] || event.status}
              </span>
              {onApprove && (
                <button
                  onClick={onApprove}
                  disabled={approving}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60"
                >
                  {approving ? 'Подтверждение…' : '✅ Подтвердить выполнение'}
                </button>
              )}
            </div>
          )}

          <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">{event.title}</h2>

          {event.description && (
            <p className="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap leading-relaxed">
              {event.description}
            </p>
          )}

          <div className="grid grid-cols-1 gap-2">
            {event.priority && (
              <DetailRow icon={<Flag size={14} />} label="Приоритет">
                <span className={clsx('inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full', priorityColors[event.priority] || 'bg-surface-100')}>
                  {priorityLabels[event.priority] || event.priority}
                </span>
              </DetailRow>
            )}
            {event.status && (
              <DetailRow icon={<Edit size={14} />} label="Статус">
                <span className="text-sm text-surface-700 dark:text-surface-300">
                  {statusLabels[event.status] || event.status}
                </span>
              </DetailRow>
            )}
            {event.date && (
              <DetailRow icon={<CalIcon size={14} />} label="Дедлайн">
                <span className="text-sm text-surface-700 dark:text-surface-300">
                  {format(new Date(event.date), 'd MMMM yyyy, HH:mm', { locale: ru })}
                </span>
              </DetailRow>
            )}
            {event.createdAt && (
              <DetailRow icon={<CalIcon size={14} />} label="Создана">
                <span className="text-sm text-surface-700 dark:text-surface-300">
                  {format(new Date(event.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
                </span>
              </DetailRow>
            )}
            {event.assigneeName && (
              <DetailRow icon={<User size={14} />} label="Исполнитель">
                <span className="text-sm text-surface-700 dark:text-surface-300">{event.assigneeName}</span>
              </DetailRow>
            )}
            {event.projectName && (
              <DetailRow icon={<FolderKanban size={14} />} label="Проект">
                <span className="text-sm text-surface-700 dark:text-surface-300">{event.projectName}</span>
              </DetailRow>
            )}
          </div>
        </div>

        {/* Footer actions — естественный flex bottom без absolute */}
        <div className="shrink-0 px-5 py-3 border-t border-surface-100 dark:border-surface-700 bg-white dark:bg-surface-900 flex gap-2">
          {event.taskId && (
            <a
              href={`/tasks/${event.taskId}`}
              className="btn-secondary flex-1 justify-center text-sm"
            >
              Открыть полностью
            </a>
          )}
          <button onClick={onDelete} className="btn-secondary text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20" title="Удалить">
            <Trash2 size={15} />
          </button>
        </div>
      </aside>
    </>
  )
}

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
      <span className="text-surface-400 dark:text-surface-500 shrink-0">{icon}</span>
      <span className="text-xs text-surface-500 dark:text-surface-400 min-w-[80px]">{label}</span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  )
}
