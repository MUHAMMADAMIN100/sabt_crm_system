import { useState, useMemo, useEffect } from 'react'
import StoryCalendar from '@/components/stories/StoryCalendar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shortenName } from '@/lib/name'
import { tasksApi, projectsApi, employeesApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, EmptyState, Modal, Avatar, ConfirmDialog, Pagination } from '@/components/ui'
import DeleteWithReasonDialog from '@/components/tasks/DeleteWithReasonDialog'
import { Plus, Search, LayoutGrid, List, Filter, Edit, Trash2, Download, CheckSquare, X } from 'lucide-react'
import api from '@/lib/api'
import { format } from 'date-fns'
import TaskForm from '@/components/tasks/TaskForm'
import TaskDrawer from '@/components/tasks/TaskDrawer'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// Фильтр-сегмент «Мои задачи / Общие»:
//  - all   — все задачи (как раньше)
//  - mine  — задачи где я в исполнителях/мульти-исполнителях ИЛИ личные
//            заметки, созданные мной через календарь
//  - common — задачи, которые не направлены лично мне и не моя личная заметка
//            (бизнес-задачи команды, общие задачи всей компании и т.п.)
type TaskScopeFilter = 'all' | 'mine' | 'common'

export default function TasksPage() {
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [priorities, setPriorities] = useState<string[]>([])
  const [projectId, setProjectId] = useState('')
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [scopeFilter, setScopeFilter] = useState<TaskScopeFilter>('all')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  // Right-side drawer: клик по задаче открывает её здесь, без перехода на /tasks/:id.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  // Wave 16: фильтры по новым полям задач (TZ п.13)
  const [filterReviewer, setFilterReviewer] = useState('')
  const [filterReturnReason, setFilterReturnReason] = useState('')
  const [filterReworkMin, setFilterReworkMin] = useState('')
  const [filterDeliveryType, setFilterDeliveryType] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const PAGE_SIZE = 10
  const user = useAuthStore(s => s.user)
  const isHeadSMM = user?.role === 'head_smm' || user?.role === 'smm_director'
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(user?.role || '')
  // МП по продажам: видят задачи своего направления и могут создавать
  // задачи в доступных им проектах (сервер фильтрует /tasks и /projects).
  const isSalesManager = user?.role === 'sales_manager_smm' || user?.role === 'sales_manager_dev'
  // Виджет «Истории» справа от списка задач — для всех, кто публикует контент.
  // Скрыт у admin/founder/co_founder (у них своя глобальная аналитика историй)
  // и у МП по разработке (они не публикуют контент).
  const showStoryWidget = !['admin', 'founder', 'co_founder', 'sales_manager_dev'].includes(user?.role || '')
  const isSMM = user?.role === 'smm_specialist'
  const qc = useQueryClient()
  const { t } = useTranslation()

  // Wave 17: расширенный пайплайн (TZ п.4). STATUSES = быстрые фильтр-чипы;
  // ALL_STATUSES = полный список для dropdown смены статуса задачи.
  const STATUSES = ['new', 'in_progress', 'review', 'done']
  const ALL_STATUSES = [
    'new', 'accepted', 'in_progress', 'on_pm_review', 'on_rework',
    'review', 'on_client_approval', 'approved', 'done', 'published',
    'returned', 'rescheduled', 'cancelled',
  ]
  const STATUS_LABELS: Record<string, string> = {
    new: t('statuses.new'),
    accepted: 'Принято',
    in_progress: t('statuses.in_progress'),
    on_pm_review: 'У PM',
    on_rework: 'На доработке',
    review: t('statuses.review'),
    on_client_approval: 'У клиента',
    approved: 'Утверждено',
    done: t('statuses.done'),
    published: 'Опубликовано',
    returned: t('statuses.returned'),
    rescheduled: 'Перенесено',
    cancelled: t('statuses.cancelled'),
  }
  const PRIORITIES = ['low', 'medium', 'high', 'critical']

  const { data: allTasks, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => (isManagerPlus || isSalesManager) ? tasksApi.list() : tasksApi.my(), refetchInterval: 30000 })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  // Employees only see their own projects in the task form
  const availableProjects = useMemo(() => {
    const all = projects || []
    if (isHeadSMM) return all.filter((p: any) => p.projectType === 'SMM')
    // МП — сервер уже вернул только проекты их направления.
    if (isManagerPlus || isSalesManager) return all
    return all.filter((p: any) => p.members?.some((m: any) => m.id === user?.id))
  },
    [projects, isManagerPlus, isSalesManager, isHeadSMM, user?.id]
  )

  // Map userId -> fullName for displaying correct full names on tasks
  const empNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    employees?.forEach((e: any) => { if (e.userId) map[e.userId] = e.fullName })
    return map
  }, [employees])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, statuses, priorities, projectId, assigneeUserId, scopeFilter, filterReviewer, filterReturnReason, filterReworkMin, filterDeliveryType])

  // Хелпер: задача «моя» если я в её assignees (включая multi-assignee)
  // или это моя личная заметка (scope=personal, createdById=я).
  const isTaskMine = (t: any): boolean => {
    if (!user?.id) return false
    if (t.assigneeId === user.id) return true
    if (Array.isArray(t.assignees) && t.assignees.some((a: any) => a.userId === user.id)) return true
    if (t.scope === 'personal' && t.createdById === user.id) return true
    return false
  }

  const tasks = allTasks?.filter((t: any) => {
    const matchesSearch = !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.description?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statuses.length === 0 || statuses.includes(t.status)
    const matchesPriority = priorities.length === 0 || priorities.includes(t.priority)
    const matchesProject = !projectId || t.projectId === projectId
    const matchesAssignee = !assigneeUserId || t.assigneeId === assigneeUserId
    // Employee sees only own tasks; МП — задачи своего направления (отфильтровано сервером)
    const matchesEmployee = isManagerPlus || isSalesManager || t.assigneeId === user?.id
    // Wave 16 фильтры
    const matchesReviewer = !filterReviewer || t.reviewerId === filterReviewer
    const matchesReturn = !filterReturnReason ||
      (t.returnReason || '').toLowerCase().includes(filterReturnReason.toLowerCase())
    const minRework = filterReworkMin === '' ? null : Number(filterReworkMin)
    const matchesRework = minRework == null || (t.reworkCount ?? 0) >= minRework
    const matchesDelivery = !filterDeliveryType || t.deliveryType === filterDeliveryType
    // Сегмент «Мои / Общие»
    const matchesScope =
      scopeFilter === 'all' ? true :
      scopeFilter === 'mine' ? isTaskMine(t) :
      /* common */ !isTaskMine(t) && t.scope !== 'personal'
    return matchesSearch && matchesStatus && matchesPriority && matchesProject && matchesAssignee && matchesEmployee
      && matchesReviewer && matchesReturn && matchesRework && matchesDelivery && matchesScope
  }) || []

  const pagedTasks = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const createMut = useMutation({
    mutationFn: tasksApi.create,
    onMutate: async (dto: any) => {
      setShowCreate(false)
      setEditingTask(null)
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previous = qc.getQueryData(['tasks'])
      const tempTask = { id: `temp-${Date.now()}`, ...dto, status: 'new', createdAt: new Date().toISOString() }
      qc.setQueryData(['tasks'], (old: any[]) => old ? [tempTask, ...old] : [tempTask])
      return { previous }
    },
    onSuccess: () => { invalidateAfterTaskChange(qc); toast.success(t('tasks.created')) },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['tasks'], context?.previous)
      toast.error(t('common.error'))
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => tasksApi.update(id, data),
    onMutate: async ({ id: taskId, data }: any) => {
      setEditingTask(null)
      setShowCreate(false)
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previous = qc.getQueryData(['tasks'])
      qc.setQueryData(['tasks'], (old: any[]) => old?.map((t: any) => t.id === taskId ? { ...t, ...data } : t) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['tasks'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => { invalidateAfterTaskChange(qc); toast.success(t('tasks.updated')) },
  })

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: any) => tasksApi.update(id, { status }),
    onMutate: async ({ id: taskId, status }: any) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previous = qc.getQueryData(['tasks'])
      qc.setQueryData(['tasks'], (old: any[]) => old?.map((t: any) => t.id === taskId ? { ...t, status } : t) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      if (context?.previous) qc.setQueryData(['tasks'], context.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => invalidateAfterTaskChange(qc),
  })

  const deleteMut = useMutation({
    // Wave 17: передаём reason — без него бэк вернёт 400
    mutationFn: ({ id, reason }: { id: string; reason: string }) => tasksApi.remove(id, reason),
    onMutate: async ({ id }: { id: string; reason: string }) => {
      setDeleteTaskId(null)
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previous = qc.getQueryData(['tasks'])
      qc.setQueryData(['tasks'], (old: any[]) => old?.filter((t: any) => t.id !== id) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['tasks'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => { invalidateAfterTaskChange(qc); toast.success(t('tasks.deleted')) },
  })

  const bulkMut = useMutation({
    mutationFn: ({ action, value }: { action: 'status' | 'delete' | 'assign'; value?: string }) =>
      tasksApi.bulk([...selectedIds], action, value),
    onMutate: async ({ action, value }: any) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previous = qc.getQueryData(['tasks'])
      if (action === 'delete') {
        qc.setQueryData(['tasks'], (old: any[]) => old?.filter((t: any) => !selectedIds.has(t.id)) ?? [])
      } else if (action === 'status' && value) {
        qc.setQueryData(['tasks'], (old: any[]) => old?.map((t: any) => selectedIds.has(t.id) ? { ...t, status: value } : t) ?? [])
      }
      return { previous }
    },
    onError: (e: any, _vars: any, context: any) => {
      qc.setQueryData(['tasks'], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      invalidateAfterTaskChange(qc)
      setSelectedIds(new Set())
      toast.success('Выполнено')
    },
  })

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleSelectAll = () => {
    if (selectedIds.size === pagedTasks.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pagedTasks.map((t: any) => t.id)))
    }
  }

  const exportCsv = async () => {
    const params: any = {}
    if (statuses.length === 1) params.status = statuses[0]
    if (projectId) params.projectId = projectId
    const res = await api.get('/tasks/export/csv', { params, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a'); a.href = url; a.download = 'tasks.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{t('tasks.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {isManagerPlus && (
            <button onClick={exportCsv} className="btn-secondary" title="Экспорт CSV">
              <Download size={15} /> <span className="hidden sm:inline">CSV</span>
            </button>
          )}
          <button onClick={() => setShowFilters(f => !f)} className={clsx('btn-secondary', showFilters && 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400')}>
            <Filter size={15} /> <span className="hidden sm:inline">{t('common.filters')}</span>
          </button>
          <div className="flex gap-1 bg-surface-100 dark:bg-surface-700 p-1 rounded-xl">
            <button onClick={() => setView('list')} className={clsx('p-1.5 rounded-lg', view === 'list' ? 'bg-white dark:bg-surface-600 shadow-sm' : 'text-surface-500 dark:text-surface-400')}><List size={16} /></button>
            <button onClick={() => setView('grid')} className={clsx('p-1.5 rounded-lg', view === 'grid' ? 'bg-white dark:bg-surface-600 shadow-sm' : 'text-surface-500 dark:text-surface-400')}><LayoutGrid size={16} /></button>
          </div>
          <button onClick={() => { setEditingTask(null); setShowCreate(true) }} className="btn-primary">
            <Plus size={16} /> <span className="hidden sm:inline">{t('tasks.task')}</span>
          </button>
        </div>
      </div>

      {/* Сегмент «Все / Мои задачи / Общие» — быстрый фильтр поверх остальных.
          «Мои» = задачи, где я в исполнителях ИЛИ моя личная заметка (scope=personal).
          «Общие» = задачи команды, которые не направлены лично мне. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { value: 'all'    as TaskScopeFilter, label: 'Все',         icon: '' },
          { value: 'mine'   as TaskScopeFilter, label: 'Мои задачи',  icon: '👤' },
          { value: 'common' as TaskScopeFilter, label: 'Общие',       icon: '👥' },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => setScopeFilter(opt.value)}
            className={clsx(
              'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
              scopeFilter === opt.value
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
            )}
          >
            {opt.icon && <span>{opt.icon}</span>}{opt.label}
          </button>
        ))}
        {scopeFilter !== 'all' && (
          <span className="text-[11px] text-surface-400 dark:text-surface-500 ml-1">
            {scopeFilter === 'mine'
              ? 'Задачи, направленные вам, и ваши личные заметки из календаря'
              : 'Задачи команды, не направленные лично вам'}
          </span>
        )}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('tasks.searchPlaceholder')} className="input pl-9" />
      </div>

      {showFilters && (
        <div className="card flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('common.status')}</span>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setStatuses([])} className={clsx('btn text-xs py-1', statuses.length === 0 ? 'btn-primary' : 'btn-secondary')}>{t('statuses.all')}</button>
              {STATUSES.map(s => {
                const active = statuses.includes(s)
                return (
                  <button key={s} onClick={() => setStatuses(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                    className={clsx('btn text-xs py-1', active ? 'btn-primary' : 'btn-secondary')}>
                    {t(`statuses.${s}`)}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('common.priority')}</span>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setPriorities([])} className={clsx('btn text-xs py-1', priorities.length === 0 ? 'btn-primary' : 'btn-secondary')}>{t('priorities.all')}</button>
              {PRIORITIES.map(p => {
                const active = priorities.includes(p)
                return (
                  <button key={p} onClick={() => setPriorities(prev => active ? prev.filter(x => x !== p) : [...prev, p])}
                    className={clsx('btn text-xs py-1', active ? 'btn-primary' : 'btn-secondary')}>
                    {t(`priorities.${p}`)}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('tasks.project')}</span>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input w-48">
              <option value="">{t('common.allProjects')}</option>
              {availableProjects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {isManagerPlus && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('tasks.assignee')}</span>
              <select value={assigneeUserId} onChange={e => setAssigneeUserId(e.target.value)} className="input w-48">
                <option value="">Все исполнители</option>
                {(isHeadSMM
                  ? employees?.filter((e: any) => ['smm_specialist', 'head_smm'].includes(e.user?.role || '') || ['SMM специалист', 'Главный SMM специалист'].includes(e.position || ''))
                  : employees
                )?.map((e: any) => (
                  <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName}</option>
                ))}
              </select>
            </div>
          )}
          {/* Wave 16 фильтры (TZ п.13) */}
          {isManagerPlus && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Reviewer</span>
              <select value={filterReviewer} onChange={e => setFilterReviewer(e.target.value)} className="input w-48">
                <option value="">Любой проверяющий</option>
                {employees?.map((e: any) => (
                  <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Причина возврата</span>
            <input
              value={filterReturnReason}
              onChange={e => setFilterReturnReason(e.target.value)}
              placeholder="поиск в return_reason..."
              className="input w-48"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Возвратов ≥</span>
            <input
              type="number"
              min={0}
              value={filterReworkMin}
              onChange={e => setFilterReworkMin(e.target.value)}
              placeholder="0"
              className="input w-24"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Тип результата</span>
            <select value={filterDeliveryType} onChange={e => setFilterDeliveryType(e.target.value)} className="input w-40">
              <option value="">Любой</option>
              <option value="post">Post</option>
              <option value="reel">Reel</option>
              <option value="story">Story</option>
              <option value="design">Design</option>
              <option value="ad">Ad</option>
              <option value="video">Video</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {isManagerPlus && selectedIds.size > 0 && (
        <div className="card bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-primary-700 dark:text-primary-400">
            <CheckSquare size={15} className="inline mr-1" /> Выбрано: {selectedIds.size}
          </span>
          <div className="flex flex-wrap gap-2 flex-1">
            <select
              defaultValue=""
              onChange={e => e.target.value && bulkMut.mutate({ action: 'status', value: e.target.value })}
              className="text-xs input py-1 w-auto"
            >
              <option value="">Изменить статус...</option>
              {['new','in_progress','review','returned','done','cancelled'].map(s => (
                <option key={s} value={s}>{{ new: 'Новая', in_progress: 'В работе', review: 'На проверке', returned: 'Возвращено', done: 'Готово', cancelled: 'Отменена' }[s]}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const reason = window.prompt('Причина массового удаления (обязательно):')
                const trimmed = (reason ?? '').trim()
                if (!trimmed) {
                  toast.error('Без причины массовое удаление невозможно')
                  return
                }
                bulkMut.mutate({ action: 'delete', value: trimmed })
              }}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              <Trash2 size={12} /> Удалить
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-surface-400 hover:text-surface-600">
            <X size={16} />
          </button>
        </div>
      )}

      <div className={clsx(showStoryWidget && 'grid grid-cols-1 lg:grid-cols-3 gap-4')}>
      <div className={clsx(showStoryWidget && 'lg:col-span-2')}>
      {!tasks?.length ? (
        <EmptyState title={t('tasks.noTasks')} description={t('tasks.createFirst')} action={
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button>
        } />
      ) : view === 'list' ? (
        <div key={page} className="animate-fade-in stagger-rows card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100 dark:border-surface-700">
                {isManagerPlus && (
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === pagedTasks.length && pagedTasks.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                )}
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('tasks.task')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden md:table-cell">{t('tasks.project')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('common.status')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden lg:table-cell">{t('common.priority')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden lg:table-cell">{t('tasks.assignee')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden xl:table-cell">{t('tasks.deadline')}</th>
                <th className="text-right text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pagedTasks.map((task: any) => {
                const isOwnTask = task.assigneeId === user?.id
                const canChangeStatus = isManagerPlus || isOwnTask || (isSMM && isOwnTask)
                const isSelected = selectedIds.has(task.id)
                return (
                  <tr
                    key={task.id}
                    onClick={() => setOpenTaskId(task.id)}
                    className={clsx(
                      'border-b border-surface-50 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors cursor-pointer',
                      isSelected && 'bg-primary-50/50 dark:bg-primary-900/10',
                    )}
                  >
                    {isManagerPlus && (
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(task.id)} className="rounded" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 text-sm">{task.title}</span>
                        {isManagerPlus && task.createdById && task.assigneeId && (task.createdById === task.assigneeId || task.createdBy?.name?.trim()) && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                            task.createdById === task.assigneeId
                              ? 'bg-surface-100 dark:bg-surface-700 text-surface-400 dark:text-surface-500'
                              : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          }`}>
                            {task.createdById === task.assigneeId ? 'сам' : (task.createdBy?.name?.trim().split(' ')[0] ? `от ${task.createdBy.name.trim().split(' ')[0]}` : `от ${task.createdBy.name.trim().split(' ')[0]}`)}
                          </span>
                        )}
                      </div>
                      {/* Mobile: show project under title */}
                      {task.project?.name && (
                        <div className="md:hidden text-[10px] text-surface-400 dark:text-surface-500 mt-0.5 truncate">
                          📁 {task.project.name}
                        </div>
                      )}
                      {task.createdAt && (
                        <div className="text-[10px] text-surface-400 dark:text-surface-500 mt-0.5">
                          🕐 {format(new Date(task.createdAt), 'dd.MM.yyyy HH:mm')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell"><span className="text-sm text-surface-500 dark:text-surface-400">{task.project?.name || '—'}</span></td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      {canChangeStatus ? (
                        <select value={task.status} onChange={e => updateStatusMut.mutate({ id: task.id, status: e.target.value })}
                          className="text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 dark:text-surface-200">
                          {ALL_STATUSES.map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={task.status} />
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell"><PriorityBadge priority={task.priority} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <AssigneesStack task={task} currentUserId={user?.id} />
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {task.deadline ? (
                        <span className={`text-sm ${new Date(task.deadline) < new Date() && !['done','cancelled'].includes(task.status) ? 'text-red-500 font-medium' : 'text-surface-500 dark:text-surface-400'}`}>{format(new Date(task.deadline), 'dd.MM.yyyy')}</span>
                      ) : <span className="text-surface-400 dark:text-surface-500 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {(isManagerPlus || task.assigneeId === user?.id || task.createdById === user?.id) && (
                          <>
                            <button onClick={() => { setEditingTask(task); setShowCreate(true) }} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-300"><Edit size={14} /></button>
                            <button onClick={() => setDeleteTaskId(task.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500 dark:text-red-400"><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div key={page} className="animate-fade-in stagger-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pagedTasks.map((task: any) => (
            <div key={task.id} className="card card-hoverable cursor-pointer" onClick={() => setOpenTaskId(task.id)}>
              <div className="flex items-start justify-between mb-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpenTaskId(task.id) }}
                  className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 text-sm flex-1 pr-2 text-left"
                >
                  {task.title}
                </button>
                <div className="flex gap-0.5 shrink-0">
                  {(isManagerPlus || task.assigneeId === user?.id || task.createdById === user?.id) && (
                    <>
                      <button onClick={() => { setEditingTask(task); setShowCreate(true) }} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400"><Edit size={13} /></button>
                      <button onClick={() => setDeleteTaskId(task.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={13} /></button>
                    </>
                  )}
                  <PriorityBadge priority={task.priority} />
                </div>
              </div>
              {task.description && <p className="text-xs text-surface-500 dark:text-surface-400 mb-3 line-clamp-2">{task.description}</p>}
              {task.createdAt && (
                <p className="text-[10px] text-surface-400 dark:text-surface-500 mb-2">
                  🕐 Создана: {format(new Date(task.createdAt), 'dd.MM.yyyy HH:mm')}
                </p>
              )}
              <div className="flex items-center justify-between">
                <StatusBadge status={task.status} />
                <div className="flex items-center gap-2">
                  {task.assignee && (
                    <>
                      <Avatar name={empNameMap[task.assigneeId] || task.assignee.name} src={task.assignee.avatar} size={22} />
                      <span className="text-xs text-surface-500 dark:text-surface-400 font-medium">{(empNameMap[task.assigneeId] || task.assignee.name)?.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}</span>
                    </>
                  )}
                  {task.deadline && (<span className={`text-xs ${new Date(task.deadline) < new Date() && !['done','cancelled'].includes(task.status) ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>{format(new Date(task.deadline), 'dd.MM')}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} total={tasks.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>{/* end tasks col */}

      {showStoryWidget && (
        <div className="lg:col-span-1">
          <StoryCalendar compact />
        </div>
      )}
      </div>{/* end grid */}

      {showCreate && (
        <Modal open onClose={() => { setShowCreate(false); setEditingTask(null) }} title={editingTask ? t('tasks.editTask') : t('tasks.newTask')} size="lg">
          <TaskForm
            onSubmit={data => { if (editingTask) updateMut.mutate({ id: editingTask.id, data }); else createMut.mutate(data) }}
            onClose={() => { setShowCreate(false); setEditingTask(null) }}
            projects={availableProjects} employees={employees || []}
            loading={createMut.isPending || updateMut.isPending}
            initial={editingTask}
            isAdmin={isManagerPlus || isSalesManager} currentUserId={user?.id}
          />
        </Modal>
      )}

      <DeleteWithReasonDialog
        open={!!deleteTaskId}
        loading={deleteMut.isPending}
        onClose={() => setDeleteTaskId(null)}
        onConfirm={(reason) => deleteMut.mutate({ id: deleteTaskId!, reason })}
        title={t('tasks.deleteConfirm')}
      />

      <TaskDrawer
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onEdit={(task) => { setOpenTaskId(null); setEditingTask(task); setShowCreate(true) }}
        onDelete={(id) => { setOpenTaskId(null); setDeleteTaskId(id) }}
      />

    </div>
  )
}

/** Стек аватарок исполнителей с индикатором готовности.
 *  Если ассистент 1 — показываем имя; если несколько — стек с количеством готовых. */
function AssigneesStack({ task, currentUserId }: { task: any; currentUserId?: string }) {
  const list: Array<{ userId: string; isDone: boolean; user: any }> =
    Array.isArray(task?.assignees) && task.assignees.length > 0
      ? task.assignees
      : (task?.assigneeId
          ? [{ userId: task.assigneeId, isDone: false, user: task.assignee }]
          : [])

  if (list.length === 0) return <span className="text-surface-400 dark:text-surface-500 text-sm">—</span>

  if (list.length === 1) {
    const a = list[0]
    return (
      <div className="flex items-center gap-2">
        <div className="relative">
          <Avatar name={a.user?.name} src={a.user?.avatar} size={22} />
          {a.isDone && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-surface-800" />
          )}
        </div>
        {a.userId === currentUserId ? (
          <span className="text-sm font-medium text-primary-600 dark:text-primary-400">Вы</span>
        ) : (
          <span className="text-sm text-surface-600 dark:text-surface-300">{shortenName(a.user?.name || '')}</span>
        )}
      </div>
    )
  }

  const doneCount = list.filter(a => a.isDone).length
  return (
    <div className="flex items-center gap-2" title={list.map(a => `${a.user?.name || '—'}${a.isDone ? ' ✓' : ''}`).join('\n')}>
      <div className="flex -space-x-1.5">
        {list.slice(0, 3).map(a => (
          <div key={a.userId} className="relative">
            <Avatar name={a.user?.name} src={a.user?.avatar} size={22} />
            {a.isDone && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-surface-800" />
            )}
          </div>
        ))}
        {list.length > 3 && (
          <div className="w-[22px] h-[22px] rounded-full bg-surface-200 dark:bg-surface-700 text-[10px] font-medium flex items-center justify-center text-surface-600 dark:text-surface-300 ring-2 ring-white dark:ring-surface-800">
            +{list.length - 3}
          </div>
        )}
      </div>
      <span className={clsx('text-xs', doneCount === list.length ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-surface-500 dark:text-surface-400')}>
        {doneCount}/{list.length} {doneCount === list.length ? '✓' : ''}
      </span>
    </div>
  )
}

