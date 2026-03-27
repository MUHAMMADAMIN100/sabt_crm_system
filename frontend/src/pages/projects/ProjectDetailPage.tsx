import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, tasksApi, filesApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { PageLoader, StatusBadge, PriorityBadge, ProgressBar, Modal, Avatar, EmptyState, ConfirmDialog } from '@/components/ui'
import { ArrowLeft, Plus, Upload, Paperclip, Calendar, Users, CheckSquare, Edit, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { useTranslation } from '@/i18n'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const TASK_STATUSES = ['new', 'in_progress', 'review', 'done']

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<'tasks' | 'files' | 'members'>('tasks')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<any>(null)
  const qc = useQueryClient()
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'manager'].includes(user?.role || '')

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
  })

  const { data: files } = useQuery({
    queryKey: ['files', id],
    queryFn: () => filesApi.byProject(id!),
    enabled: activeTab === 'files',
  })

  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  const createTask = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setShowTaskForm(false)
      setEditingTask(null)
      toast.success(t('tasks.created'))
    },
  })

  const updateTask = useMutation({
    mutationFn: ({ taskId, data }: any) => tasksApi.update(taskId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setShowTaskForm(false)
      setEditingTask(null)
      toast.success(t('tasks.updated'))
    },
  })

  const deleteTask = useMutation({
    mutationFn: tasksApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setDeleteTaskId(null)
      toast.success(t('tasks.deleted'))
    },
  })

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await filesApi.upload(file, id)
      qc.invalidateQueries({ queryKey: ['files', id] })
      toast.success(t('files.uploaded'))
    } catch { toast.error(t('files.uploadError')) }
  }

  if (isLoading) return <PageLoader />
  if (!project) return <div className="text-surface-600 dark:text-surface-400">{t('projects.notFound')}</div>

  const tasksByStatus = TASK_STATUSES.reduce((acc: any, s) => {
    acc[s] = project.tasks?.filter((t: any) => t.status === s) || []
    return acc
  }, {})

  const uniqueAssignees = new Map()
  project.tasks?.forEach((task: any) => {
    if (task.assignee) uniqueAssignees.set(task.assignee.id || task.assigneeId, task.assignee)
  })
  const participantCount = uniqueAssignees.size

  // Drag and drop - only for admins/managers
  const handleDragStart = (e: React.DragEvent, task: any) => {
    if (!isManagerPlus) return
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    ;(e.currentTarget as HTMLElement).classList.add('dragging')
  }
  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedTask(null)
    ;(e.currentTarget as HTMLElement).classList.remove('dragging')
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; (e.currentTarget as HTMLElement).classList.add('drag-over') }
  const handleDragLeave = (e: React.DragEvent) => { (e.currentTarget as HTMLElement).classList.remove('drag-over') }
  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).classList.remove('drag-over')
    if (draggedTask && draggedTask.status !== newStatus) {
      updateTask.mutate({ taskId: draggedTask.id, data: { status: newStatus } })
    }
    setDraggedTask(null)
  }

  // Employee can only change status of own task
  const handleEmployeeStatusChange = (taskId: string, taskAssigneeId: string, newStatus: string) => {
    if (taskAssigneeId === user?.id) {
      updateTask.mutate({ taskId, data: { status: newStatus } })
    }
  }

  const STATUS_LABELS: Record<string, string> = {
    new: t('statuses.new'), in_progress: t('statuses.in_progress'), review: t('statuses.review'), done: t('statuses.done'),
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/projects" className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="page-title">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          {project.description && <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">{project.description}</p>}
        </div>
        {isManagerPlus && (
          <button onClick={() => { setEditingTask(null); setShowTaskForm(true) }} className="btn-primary">
            <Plus size={16} /> {t('tasks.task')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <CheckSquare size={18} className="text-primary-600 mx-auto mb-1" />
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{project.tasks?.length || 0}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">{t('projects.tasks')}</p>
        </div>
        <div className="card text-center">
          <Users size={18} className="text-green-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{participantCount}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">{t('projects.participants')}</p>
        </div>
        <div className="card text-center">
          <Calendar size={18} className="text-amber-500 mx-auto mb-1" />
          <p className="text-sm font-bold text-surface-900 dark:text-surface-100">{project.endDate ? format(new Date(project.endDate), 'dd.MM.yyyy') : '—'}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">{t('projects.deadline')}</p>
        </div>
        <div className="card">
          <div className="flex justify-between mb-1">
            <span className="text-xs text-surface-500 dark:text-surface-400">{t('projects.progress')}</span>
            <span className="text-sm font-bold text-surface-900 dark:text-surface-100">{project.progress}%</span>
          </div>
          <ProgressBar value={project.progress} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-surface-100 dark:border-surface-700">
        {(['tasks', 'files', 'members'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400' : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300')}>
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'tasks' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {TASK_STATUSES.map(status => (
            <div key={status} className="space-y-2"
              onDragOver={isManagerPlus ? handleDragOver : undefined}
              onDragLeave={isManagerPlus ? handleDragLeave : undefined}
              onDrop={isManagerPlus ? (e) => handleDrop(e, status) : undefined}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">{STATUS_LABELS[status]}</h3>
                <span className="text-xs bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 px-2 py-0.5 rounded-full">{tasksByStatus[status].length}</span>
              </div>
              <div className="space-y-2 min-h-[300px] rounded-xl p-2 border-2 border-dashed border-surface-100 dark:border-surface-700 transition-colors">
                {tasksByStatus[status].map((task: any) => {
                  const isOwnTask = task.assigneeId === user?.id
                  return (
                    <div key={task.id}
                      draggable={isManagerPlus}
                      onDragStart={isManagerPlus ? (e) => handleDragStart(e, task) : undefined}
                      onDragEnd={isManagerPlus ? handleDragEnd : undefined}
                      className={clsx('card p-3 hover:shadow-md transition-all', isManagerPlus && 'cursor-grab active:cursor-grabbing')}>
                      <div className="flex items-start justify-between mb-2">
                        <Link to={`/tasks/${task.id}`} className="text-sm font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 flex-1">{task.title}</Link>
                        {isManagerPlus && (
                          <div className="flex gap-0.5 ml-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setEditingTask(task); setShowTaskForm(true) }} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400"><Edit size={12} /></button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteTaskId(task.id) }} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={12} /></button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <PriorityBadge priority={task.priority} />
                        {task.assignee && (
                          <div className="flex items-center gap-1">
                            <Avatar name={task.assignee.name} size={20} />
                            <span className="text-xs text-surface-500 dark:text-surface-400 font-medium">{task.assignee.name?.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}</span>
                          </div>
                        )}
                      </div>
                      {/* Employee: change own task status via select */}
                      {!isManagerPlus && isOwnTask && (
                        <select value={task.status} onChange={e => handleEmployeeStatusChange(task.id, task.assigneeId, e.target.value)}
                          className="mt-2 text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 dark:text-surface-200 w-full">
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                        </select>
                      )}
                      {task.deadline && (
                        <p className={`text-xs mt-1 ${new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>{format(new Date(task.deadline), 'dd.MM')}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'files' && (
        <div className="space-y-4">
          <label className="btn-secondary cursor-pointer">
            <Upload size={16} /> {t('files.upload')}
            <input type="file" className="hidden" onChange={uploadFile} />
          </label>
          {!files?.length ? <EmptyState title={t('files.noFiles')} /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {files.map((f: any) => (
                <a key={f.id} href={f.path} target="_blank" rel="noreferrer" className="card flex items-center gap-3 hover:shadow-md transition-shadow">
                  <Paperclip size={18} className="text-primary-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{f.originalName}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500">{(f.size / 1024).toFixed(1)} KB</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from(uniqueAssignees.values()).map((m: any) => (
            <div key={m.id} className="card flex items-center gap-3">
              <Avatar name={m.name} src={m.avatar} size={40} />
              <div>
                <p className="font-medium text-surface-900 dark:text-surface-100">{m.name}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400 capitalize">{m.role || ''}</p>
              </div>
            </div>
          ))}
          {uniqueAssignees.size === 0 && <EmptyState title={t('noMembers')} />}
        </div>
      )}

      {/* Task create/edit modal - FIX: separate open state from editing */}
      {showTaskForm && (
        <TaskFormModal
          open={showTaskForm}
          onClose={() => { setShowTaskForm(false); setEditingTask(null) }}
          onSubmit={data => {
            if (editingTask) updateTask.mutate({ taskId: editingTask.id, data })
            else createTask.mutate({ ...data, projectId: id })
          }}
          employees={employees || []}
          loading={createTask.isPending || updateTask.isPending}
          initial={editingTask}
          t={t}
        />
      )}

      <ConfirmDialog open={!!deleteTaskId} onClose={() => setDeleteTaskId(null)}
        onConfirm={() => deleteTask.mutate(deleteTaskId!)} title={t('tasks.deleteConfirm')} message={t('tasks.deleteMessage')} danger />
    </div>
  )
}

function TaskFormModal({ open, onClose, onSubmit, employees, loading, initial, t }: any) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm()

  useEffect(() => {
    if (initial) {
      reset({
        title: initial.title || '',
        description: initial.description || '',
        assigneeId: initial.assigneeId || '',
        priority: initial.priority || 'medium',
        deadline: initial.deadline ? new Date(initial.deadline).toISOString().split('T')[0] : '',
        estimatedHours: initial.estimatedHours || '',
      })
    } else {
      reset({ title: '', description: '', assigneeId: '', priority: 'medium', deadline: '', estimatedHours: '' })
    }
  }, [initial, reset])

  const submit = (data: any) => {
    onSubmit({
      title: data.title,
      description: data.description || undefined,
      assigneeId: data.assigneeId,
      priority: data.priority,
      deadline: data.deadline,
      estimatedHours: data.estimatedHours ? Number(data.estimatedHours) : undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? t('tasks.editTask') : t('tasks.newTask')}>
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
          <div>
            <label className="label">{t('tasks.estimatedHours')}</label>
            <input type="number" {...register('estimatedHours')} className="input" />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="btn-primary">{initial ? t('common.save') : t('common.create')}</button>
        </div>
      </form>
    </Modal>
  )
}
