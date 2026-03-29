import { useState, useMemo } from 'react'
import StoryCalendar from '@/components/stories/StoryCalendar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tasksApi, projectsApi, employeesApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, EmptyState, Modal, Avatar, ConfirmDialog, Pagination } from '@/components/ui'
import { Plus, Search, LayoutGrid, List, Filter, Edit, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import TaskForm from '@/components/tasks/TaskForm'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function TasksPage() {
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [priorities, setPriorities] = useState<string[]>([])
  const [projectId, setProjectId] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 9
  const user = useAuthStore(s => s.user)
  const isManagerPlus = user?.role === 'admin'
  const qc = useQueryClient()
  const { t } = useTranslation()

  const STATUSES = ['new', 'in_progress', 'review', 'done']
  const PRIORITIES = ['low', 'medium', 'high', 'critical']

  const { data: allTasks, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => isManagerPlus ? tasksApi.list() : tasksApi.my() })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  // Map userId -> fullName for displaying correct full names on tasks
  const empNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    employees?.forEach((e: any) => { if (e.userId) map[e.userId] = e.fullName })
    return map
  }, [employees])

  const tasks = allTasks?.filter((t: any) => {
    const matchesSearch = !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.description?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statuses.length === 0 || statuses.includes(t.status)
    const matchesPriority = priorities.length === 0 || priorities.includes(t.priority)
    const matchesProject = !projectId || t.projectId === projectId
    // Employee sees only own tasks
    const matchesEmployee = isManagerPlus || t.assigneeId === user?.id
    return matchesSearch && matchesStatus && matchesPriority && matchesProject && matchesEmployee
  }) || []

  const pagedTasks = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const createMut = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => { invalidateAfterTaskChange(qc); setShowCreate(false); setEditingTask(null); toast.success(t('tasks.created')) },
    onError: () => toast.error(t('common.error')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => tasksApi.update(id, data),
    onSuccess: () => { invalidateAfterTaskChange(qc); setEditingTask(null); setShowCreate(false); toast.success(t('tasks.updated')) },
  })

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: any) => tasksApi.update(id, { status }),
    onSuccess: () => invalidateAfterTaskChange(qc),
  })

  const deleteMut = useMutation({
    mutationFn: tasksApi.remove,
    onSuccess: () => { invalidateAfterTaskChange(qc); setDeleteTaskId(null); toast.success(t('tasks.deleted')) },
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('tasks.title')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowFilters(f => !f)} className={clsx('btn-secondary', showFilters && 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400')}>
            <Filter size={15} /> {t('common.filters')}
          </button>
          <div className="flex gap-1 bg-surface-100 dark:bg-surface-700 p-1 rounded-xl">
            <button onClick={() => setView('list')} className={clsx('p-1.5 rounded-lg', view === 'list' ? 'bg-white dark:bg-surface-600 shadow-sm' : 'text-surface-500 dark:text-surface-400')}><List size={16} /></button>
            <button onClick={() => setView('grid')} className={clsx('p-1.5 rounded-lg', view === 'grid' ? 'bg-white dark:bg-surface-600 shadow-sm' : 'text-surface-500 dark:text-surface-400')}><LayoutGrid size={16} /></button>
          </div>
          <button onClick={() => { setEditingTask(null); setShowCreate(true) }} className="btn-primary">
            <Plus size={16} /> {t('tasks.task')}
          </button>
        </div>
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
              {(isManagerPlus
                ? projects
                : projects?.filter((p: any) => p.members?.some((m: any) => m.id === user?.id))
              )?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className={clsx(!isManagerPlus && 'grid grid-cols-1 lg:grid-cols-3 gap-4')}>
      <div className={clsx(!isManagerPlus && 'lg:col-span-2')}>
      {!tasks?.length ? (
        <EmptyState title={t('tasks.noTasks')} description={t('tasks.createFirst')} action={
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button>
        } />
      ) : view === 'list' ? (
        <div key={page} className="animate-fade-in card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100 dark:border-surface-700">
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
                const canChangeStatus = isManagerPlus || isOwnTask
                return (
                  <tr key={task.id} className="border-b border-surface-50 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/tasks/${task.id}`} className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 text-sm">{task.title}</Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell"><span className="text-sm text-surface-500 dark:text-surface-400">{task.project?.name || '—'}</span></td>
                    <td className="px-4 py-3">
                      {canChangeStatus ? (
                        <select value={task.status} onChange={e => updateStatusMut.mutate({ id: task.id, status: e.target.value })}
                          className="text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 dark:text-surface-200">
                          {['new','in_progress','review','done','cancelled'].map(s => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
                        </select>
                      ) : (
                        <StatusBadge status={task.status} />
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell"><PriorityBadge priority={task.priority} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {task.assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={empNameMap[task.assigneeId] || task.assignee.name} size={22} />
                          {!isManagerPlus ? (
                            <span className="text-sm font-medium text-primary-600 dark:text-primary-400">Вы</span>
                          ) : (
                            <span className="text-sm text-surface-600 dark:text-surface-300">{empNameMap[task.assigneeId] || task.assignee.name}</span>
                          )}
                        </div>
                      ) : <span className="text-surface-400 dark:text-surface-500 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {task.deadline ? (
                        <span className={`text-sm ${new Date(task.deadline) < new Date() ? 'text-red-500 font-medium' : 'text-surface-500 dark:text-surface-400'}`}>{format(new Date(task.deadline), 'dd.MM.yyyy')}</span>
                      ) : <span className="text-surface-400 dark:text-surface-500 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setEditingTask(task); setShowCreate(true) }} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-300"><Edit size={14} /></button>
                        {isManagerPlus && (
                          <button onClick={() => setDeleteTaskId(task.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500 dark:text-red-400"><Trash2 size={14} /></button>
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
        <div key={page} className="animate-fade-in grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {pagedTasks.map((task: any) => (
            <div key={task.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-2">
                <Link to={`/tasks/${task.id}`} className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 text-sm flex-1 pr-2">{task.title}</Link>
                <div className="flex gap-0.5 shrink-0">
                  {(isManagerPlus || task.assigneeId === user?.id) && (
                    <>
                      <button onClick={() => { setEditingTask(task); setShowCreate(true) }} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400"><Edit size={13} /></button>
                      <button onClick={() => setDeleteTaskId(task.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={13} /></button>
                    </>
                  )}
                  <PriorityBadge priority={task.priority} />
                </div>
              </div>
              {task.description && <p className="text-xs text-surface-500 dark:text-surface-400 mb-3 line-clamp-2">{task.description}</p>}
              <div className="flex items-center justify-between">
                <StatusBadge status={task.status} />
                <div className="flex items-center gap-2">
                  {task.assignee && (
                    <>
                      <Avatar name={empNameMap[task.assigneeId] || task.assignee.name} size={22} />
                      <span className="text-xs text-surface-500 dark:text-surface-400 font-medium">{(empNameMap[task.assigneeId] || task.assignee.name)?.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}</span>
                    </>
                  )}
                  {task.deadline && (<span className={`text-xs ${new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>{format(new Date(task.deadline), 'dd.MM')}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} total={tasks.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>{/* end tasks col */}

      {!isManagerPlus && (
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
            projects={projects || []} employees={employees || []}
            loading={createMut.isPending || updateMut.isPending}
            initial={editingTask}
            isAdmin={isManagerPlus} currentUserId={user?.id}
          />
        </Modal>
      )}

      <ConfirmDialog open={!!deleteTaskId} onClose={() => setDeleteTaskId(null)}
        onConfirm={() => deleteMut.mutate(deleteTaskId!)} title={t('tasks.deleteConfirm')} message={t('tasks.deleteMessage')} danger />

    </div>
  )
}

