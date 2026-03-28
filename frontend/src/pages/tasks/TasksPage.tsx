import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tasksApi, projectsApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, EmptyState, Modal, Avatar, ConfirmDialog } from '@/components/ui'
import StoryCalendar from '@/components/stories/StoryCalendar'
import { Plus, Search, LayoutGrid, List, Filter, Edit, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function TasksPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [projectId, setProjectId] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'manager'].includes(user?.role || '')
  const qc = useQueryClient()
  const { t } = useTranslation()

  const STATUSES = ['', 'new', 'in_progress', 'review', 'done']
  const PRIORITIES = ['', 'low', 'medium', 'high', 'critical']

  const { data: allTasks, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => isManagerPlus ? tasksApi.list() : tasksApi.my() })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  const tasks = allTasks?.filter((t: any) => {
    const matchesSearch = !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.description?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = !status || t.status === status
    const matchesPriority = !priority || t.priority === priority
    const matchesProject = !projectId || t.projectId === projectId
    // Employee sees only own tasks
    const matchesEmployee = isManagerPlus || t.assigneeId === user?.id
    return matchesSearch && matchesStatus && matchesPriority && matchesProject && matchesEmployee
  }) || []

  const createMut = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['project'] }); setShowCreate(false); setEditingTask(null); toast.success(t('tasks.created')) },
    onError: () => toast.error(t('common.error')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => tasksApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['project'] }); setEditingTask(null); setShowCreate(false); toast.success(t('tasks.updated')) },
  })

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: any) => tasksApi.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['project'] }) },
  })

  const deleteMut = useMutation({
    mutationFn: tasksApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['project'] }); setDeleteTaskId(null); toast.success(t('tasks.deleted')) },
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
              {STATUSES.map(s => (<button key={s} onClick={() => setStatus(s)} className={clsx('btn text-xs py-1', status === s ? 'btn-primary' : 'btn-secondary')}>{s ? t(`statuses.${s}`) : t('statuses.all')}</button>))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('common.priority')}</span>
            <div className="flex flex-wrap gap-1">
              {PRIORITIES.map(p => (<button key={p} onClick={() => setPriority(p)} className={clsx('btn text-xs py-1', priority === p ? 'btn-primary' : 'btn-secondary')}>{p ? t(`priorities.${p}`) : t('priorities.all')}</button>))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{t('tasks.project')}</span>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input w-48">
              <option value="">{t('common.allProjects')}</option>
              {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {!tasks?.length ? (
        <EmptyState title={t('tasks.noTasks')} description={t('tasks.createFirst')} action={
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button>
        } />
      ) : view === 'list' ? (
        <div className="card p-0 overflow-hidden">
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
              {tasks.map((task: any) => {
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
                          <Avatar name={task.assignee.name} size={22} />
                          <span className="text-sm text-surface-600 dark:text-surface-300">{task.assignee.name}</span>
                          <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded">{task.assignee.name?.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}</span>
                        </div>
                      ) : <span className="text-surface-400 dark:text-surface-500 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {task.deadline ? (
                        <span className={`text-sm ${new Date(task.deadline) < new Date() ? 'text-red-500 font-medium' : 'text-surface-500 dark:text-surface-400'}`}>{format(new Date(task.deadline), 'dd.MM.yyyy')}</span>
                      ) : <span className="text-surface-400 dark:text-surface-500 text-sm">—</span>}
                    </td>
                    {(isManagerPlus || isOwnTask) && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => { setEditingTask(task); setShowCreate(true) }} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400"><Edit size={14} /></button>
                          <button onClick={() => setDeleteTaskId(task.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tasks.map((task: any) => (
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
                      <Avatar name={task.assignee.name} size={22} />
                      <span className="text-xs text-surface-500 dark:text-surface-400 font-medium">{task.assignee.name?.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}</span>
                    </>
                  )}
                  {task.deadline && (<span className={`text-xs ${new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>{format(new Date(task.deadline), 'dd.MM')}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Story Calendar for employees (SMM tracking) */}
      {!isManagerPlus && (
        <StoryCalendar compact />
      )}

      {showCreate && (
        <Modal open onClose={() => { setShowCreate(false); setEditingTask(null) }} title={editingTask ? t('tasks.editTask') : t('tasks.newTask')} size="lg">
          <TaskForm
            onSubmit={data => { if (editingTask) updateMut.mutate({ id: editingTask.id, data }); else createMut.mutate(data) }}
            onClose={() => { setShowCreate(false); setEditingTask(null) }}
            projects={projects || []} employees={employees || []}
            loading={createMut.isPending || updateMut.isPending}
            initial={editingTask} t={t}
          />
        </Modal>
      )}

      <ConfirmDialog open={!!deleteTaskId} onClose={() => setDeleteTaskId(null)}
        onConfirm={() => deleteMut.mutate(deleteTaskId!)} title={t('tasks.deleteConfirm')} message={t('tasks.deleteMessage')} danger />

      {/* Story Calendar for employees (SMM tracking) */}
      {!isManagerPlus && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2" />
          <StoryCalendar />
        </div>
      )}
    </div>
  )
}

function TaskForm({ onSubmit, onClose, projects, employees, loading, initial, t }: any) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm()

  useEffect(() => {
    if (initial) {
      reset({ title: initial.title || '', description: initial.description || '', projectId: initial.projectId || '', assigneeId: initial.assigneeId || '', priority: initial.priority || 'medium', deadline: initial.deadline ? new Date(initial.deadline).toISOString().split('T')[0] : '' })
    } else {
      reset({ title: '', description: '', projectId: '', assigneeId: '', priority: 'medium', deadline: '' })
    }
  }, [initial, reset])

  const submit = (data: any) => {
    onSubmit({ title: data.title, description: data.description, projectId: data.projectId, assigneeId: data.assigneeId, priority: data.priority, deadline: data.deadline })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div>
        <label className="label">{t('tasks.name')} *</label>
        <input {...register('title', { required: true })} className="input" />
        {errors.title && <p className="text-xs text-red-500 mt-1">{t('tasks.name')} обязательно</p>}
      </div>
      <div>
        <label className="label">{t('tasks.description')} *</label>
        <textarea {...register('description', { required: true })} className="input resize-none" rows={3} />
        {errors.description && <p className="text-xs text-red-500 mt-1">{t('tasks.description')} обязательно</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('tasks.project')} *</label>
          <select {...register('projectId', { required: true })} className="input">
            <option value="">{t('common.selectOption')}</option>
            {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.projectId && <p className="text-xs text-red-500 mt-1">{t('tasks.project')} обязательно</p>}
        </div>
        <div>
          <label className="label">{t('tasks.assignee')} *</label>
          <select {...register('assigneeId', { required: true })} className="input">
            <option value="">{t('common.selectOption')}</option>
            {employees?.map((e: any) => <option key={e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>)}
          </select>
          {errors.assigneeId && <p className="text-xs text-red-500 mt-1">{t('tasks.assignee')} обязательно</p>}
        </div>
        <div>
          <label className="label">{t('common.priority')} *</label>
          <select {...register('priority', { required: true })} className="input">
            {['low','medium','high','critical'].map(p => <option key={p} value={p}>{t(`priorities.${p}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('tasks.deadline')} *</label>
          <input type="date" {...register('deadline', { required: true })} className="input" />
          {errors.deadline && <p className="text-xs text-red-500 mt-1">{t('tasks.deadline')} обязательно</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
        <button type="submit" disabled={loading} className="btn-primary">{initial ? t('common.save') : t('common.create')}</button>
      </div>
    </form>
  )
}
