import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, tasksApi, filesApi, employeesApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { PageLoader, StatusBadge, PriorityBadge, ProgressBar, Modal, Avatar, EmptyState, ConfirmDialog } from '@/components/ui'
import { ArrowLeft, Plus, Upload, Paperclip, Calendar, Users, CheckSquare, Edit, Trash2, Building2, Phone, Mail, MessageCircle, User, Briefcase } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from '@/i18n'
import TaskForm from '@/components/tasks/TaskForm'
import GanttChart from '@/components/projects/GanttChart'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const TASK_STATUSES = ['new', 'in_progress', 'review', 'done', 'cancelled']

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'tasks' | 'files' | 'about' | 'client' | 'members' | 'gantt'>('tasks')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<any>(null)
  const qc = useQueryClient()
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const isManagerPlus = user?.role === 'admin'

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
    onMutate: async (dto: any) => {
      setShowTaskForm(false)
      setEditingTask(null)
      await qc.cancelQueries({ queryKey: ['project', id] })
      const previous = qc.getQueryData(['project', id])
      qc.setQueryData(['project', id], (old: any) => {
        if (!old) return old
        const tempTask = { id: `temp-${Date.now()}`, ...dto, status: dto.status || 'new', createdAt: new Date().toISOString() }
        return { ...old, tasks: [...(old.tasks || []), tempTask] }
      })
      return { previous }
    },
    onSuccess: () => {
      invalidateAfterTaskChange(qc, id)
      toast.success(t('tasks.created'))
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['project', id], context?.previous)
      toast.error(t('common.error'))
    },
  })

  const updateTask = useMutation({
    mutationFn: ({ taskId, data }: any) => tasksApi.update(taskId, data),
    onMutate: async ({ taskId, data }: any) => {
      setShowTaskForm(false)
      setEditingTask(null)
      await qc.cancelQueries({ queryKey: ['project', id] })
      const previous = qc.getQueryData(['project', id])
      qc.setQueryData(['project', id], (old: any) => ({
        ...old,
        tasks: old?.tasks?.map((t: any) => t.id === taskId ? { ...t, ...data } : t) ?? [],
      }))
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['project', id], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      invalidateAfterTaskChange(qc, id)
      toast.success(t('tasks.updated'))
    },
  })

  // Optimistic drag-drop status update (no toast, instant UI)
  const dragStatusUpdate = useMutation({
    mutationFn: ({ taskId, data }: any) => tasksApi.update(taskId, data),
    onMutate: async ({ taskId, data }: any) => {
      await qc.cancelQueries({ queryKey: ['project', id] })
      const previous = qc.getQueryData(['project', id])
      qc.setQueryData(['project', id], (old: any) => {
        if (!old) return old
        const updatedTasks = old.tasks?.map((t: any) => t.id === taskId ? { ...t, ...data } : t) || []
        const statusWeight: Record<string, number> = { new: 0, in_progress: 30, review: 70, done: 100 }
        const activeTasks = updatedTasks.filter((t: any) => t.status !== 'cancelled')
        const totalWeight = activeTasks.reduce((sum: number, t: any) => sum + (statusWeight[t.status] ?? 0), 0)
        const progress = activeTasks.length > 0 ? Math.round(totalWeight / activeTasks.length) : 0
        return { ...old, tasks: updatedTasks, progress }
      })
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['project', id], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      // Don't invalidate project — optimistic update is already correct, socket will sync later
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics-workload'] })
    },
  })

  const deleteTask = useMutation({
    mutationFn: tasksApi.remove,
    onMutate: async (taskId: string) => {
      setDeleteTaskId(null)
      await qc.cancelQueries({ queryKey: ['project', id] })
      const previous = qc.getQueryData(['project', id])
      qc.setQueryData(['project', id], (old: any) => ({
        ...old,
        tasks: old?.tasks?.filter((t: any) => t.id !== taskId) ?? [],
      }))
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['project', id], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      invalidateAfterTaskChange(qc, id)
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

  const isMember = project.members?.some((m: any) => m.id === user?.id) ?? false
  const canCreateTask = isManagerPlus || isMember

  const tasksByStatus = TASK_STATUSES.reduce((acc: any, s) => {
    acc[s] = project.tasks?.filter((t: any) => t.status === s) || []
    return acc
  }, {})

  const uniqueAssignees = new Map()
  project.tasks?.forEach((task: any) => {
    if (task.assignee) uniqueAssignees.set(task.assignee.id || task.assigneeId, task.assignee)
  })
  const participantCount = uniqueAssignees.size

  // Drag and drop - for admins/managers and employees own tasks
  const canDrag = (task: any) => isManagerPlus || task.assigneeId === user?.id
  const handleDragStart = (e: React.DragEvent, task: any) => {
    if (!canDrag(task)) return
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
      dragStatusUpdate.mutate({ taskId: draggedTask.id, data: { status: newStatus } })
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
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="page-title">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          {project.description && <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">{project.description}</p>}
        </div>
        {canCreateTask && (
          <button onClick={() => { setEditingTask(null); setShowTaskForm(true) }} className="btn-primary shrink-0">
            <Plus size={16} /> <span className="hidden sm:inline">{t('tasks.task')}</span>
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

      <div className="flex gap-1 border-b border-surface-100 dark:border-surface-700 overflow-x-auto">
        {(['tasks', 'gantt', 'files', 'about', 'client', 'members'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              activeTab === tab ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400' : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300')}>
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'tasks' && (
        <div className="flex gap-4 overflow-x-auto pb-3 lg:grid lg:grid-cols-4 lg:overflow-x-visible">
          {TASK_STATUSES.map(status => (
            <div key={status} className="space-y-2 min-w-[260px] w-[260px] shrink-0 lg:min-w-0 lg:w-auto lg:shrink"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, status)}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">{STATUS_LABELS[status]}</h3>
                <span className="text-xs bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 px-2 py-0.5 rounded-full">{tasksByStatus[status].length}</span>
              </div>
              <div className="space-y-2 min-h-[300px] rounded-xl p-2 border-2 border-dashed border-surface-100 dark:border-surface-700 transition-colors">
                {tasksByStatus[status].map((task: any) => {
                  const isOwnTask = task.assigneeId === user?.id
                  return (
                    <div key={task.id}
                      draggable={canDrag(task)}
                      onDragStart={canDrag(task) ? (e) => handleDragStart(e, task) : undefined}
                      onDragEnd={canDrag(task) ? handleDragEnd : undefined}
                      className={clsx('card p-3 hover:shadow-md transition-all', canDrag(task) && 'cursor-grab active:cursor-grabbing')}>
                      <div className="flex items-start justify-between mb-2">
                        <Link to={`/tasks/${task.id}`} className="text-sm font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 flex-1 leading-snug">{task.title}</Link>
                        {(isManagerPlus || isOwnTask) && (
                          <div className="flex gap-0.5 ml-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setEditingTask(task); setShowTaskForm(true) }} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400"><Edit size={12} /></button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteTaskId(task.id) }} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={12} /></button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <PriorityBadge priority={task.priority} />
                        {task.assignee && (
                          <Avatar name={task.assignee.name} size={22} />
                        )}
                      </div>
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

      {activeTab === 'gantt' && (
        <GanttChart
          tasks={project.tasks || []}
          projectStart={project.startDate}
          projectEnd={project.endDate}
        />
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

      {activeTab === 'about' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card space-y-4">
            <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base border-b border-surface-100 dark:border-surface-700 pb-3">Информация о проекте</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Briefcase size={16} className="text-primary-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-surface-500 dark:text-surface-400">Название</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.name}</p>
                </div>
              </div>
              {project.projectType && (
                <div className="flex items-start gap-3">
                  <Building2 size={16} className="text-purple-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-surface-500 dark:text-surface-400">Тип проекта</p>
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.projectType}</p>
                  </div>
                </div>
              )}
              {project.description && (
                <div className="flex items-start gap-3">
                  <div className="w-4 h-4 mt-0.5 shrink-0 text-surface-400">—</div>
                  <div>
                    <p className="text-xs text-surface-500 dark:text-surface-400">Описание</p>
                    <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">{project.description}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card space-y-4">
            <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base border-b border-surface-100 dark:border-surface-700 pb-3">Сроки и статус</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Calendar size={16} className="text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-surface-500 dark:text-surface-400">Дата начала</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.startDate ? format(new Date(project.startDate), 'dd.MM.yyyy') : '—'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar size={16} className="text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-surface-500 dark:text-surface-400">Дата завершения</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.endDate ? format(new Date(project.endDate), 'dd.MM.yyyy') : '—'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckSquare size={16} className="text-primary-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-surface-500 dark:text-surface-400">Статус</p>
                  <StatusBadge status={project.status} />
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-surface-500 dark:text-surface-400 mb-1">Прогресс</p>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={project.progress} className="flex-1" />
                    <span className="text-sm font-semibold text-surface-900 dark:text-surface-100">{project.progress}%</span>
                  </div>
                </div>
              </div>
              {isManagerPlus && project.budget != null && (
                <div className="flex items-start gap-3">
                  <div className="w-4 h-4 mt-0.5 shrink-0 text-amber-500 font-bold text-xs flex items-center">₸</div>
                  <div>
                    <p className="text-xs text-surface-500 dark:text-surface-400">Бюджет</p>
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{Number(project.budget).toLocaleString()} сом</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {project.smmData && Object.keys(project.smmData).length > 0 && (
            <div className="card md:col-span-2 space-y-3">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base border-b border-surface-100 dark:border-surface-700 pb-3">SMM-анкета</h3>
              <div className="space-y-2">
                {Object.entries(project.smmData).map(([key, value]) => (
                  <div key={key} className="grid grid-cols-1 md:grid-cols-2 gap-1 py-2 border-b border-surface-50 dark:border-surface-700 last:border-0">
                    <p className="text-xs text-surface-500 dark:text-surface-400">{key}</p>
                    <p className="text-sm text-surface-800 dark:text-surface-200">{String(value) || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'client' && (
        <div className="max-w-lg">
          <div className="card space-y-4">
            <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base border-b border-surface-100 dark:border-surface-700 pb-3">Данные клиента</h3>
            {!project.clientInfo || Object.keys(project.clientInfo).length === 0 ? (
              <p className="text-sm text-surface-400 dark:text-surface-500 py-4 text-center">Данные клиента не указаны</p>
            ) : (
              <div className="space-y-3">
                {project.clientInfo.companyName && (
                  <div className="flex items-center gap-3">
                    <Building2 size={16} className="text-primary-600 shrink-0" />
                    <div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">Компания / Бренд</p>
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.clientInfo.companyName}</p>
                    </div>
                  </div>
                )}
                {project.clientInfo.contactPerson && (
                  <div className="flex items-center gap-3">
                    <User size={16} className="text-purple-500 shrink-0" />
                    <div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">Контактное лицо</p>
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.clientInfo.contactPerson}</p>
                    </div>
                  </div>
                )}
                {project.clientInfo.phone && (
                  <div className="flex items-center gap-3">
                    <Phone size={16} className="text-green-500 shrink-0" />
                    <div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">Телефон</p>
                      <a href={`tel:${project.clientInfo.phone}`} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">{project.clientInfo.phone}</a>
                    </div>
                  </div>
                )}
                {project.clientInfo.email && (
                  <div className="flex items-center gap-3">
                    <Mail size={16} className="text-primary-500 shrink-0" />
                    <div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">Email</p>
                      <a href={`mailto:${project.clientInfo.email}`} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">{project.clientInfo.email}</a>
                    </div>
                  </div>
                )}
                {project.clientInfo.whatsapp && (
                  <div className="flex items-center gap-3">
                    <MessageCircle size={16} className="text-green-600 shrink-0" />
                    <div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">WhatsApp</p>
                      <a href={`https://wa.me/${project.clientInfo.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">{project.clientInfo.whatsapp}</a>
                    </div>
                  </div>
                )}
                {project.clientInfo.instagram && (
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 shrink-0 text-pink-500 font-bold text-xs flex items-center justify-center">IG</div>
                    <div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">Instagram</p>
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{project.clientInfo.instagram}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
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

      {showTaskForm && (
        <Modal open={showTaskForm} onClose={() => { setShowTaskForm(false); setEditingTask(null) }} title={editingTask ? t('tasks.editTask') : t('tasks.newTask')}>
          <TaskForm
            onSubmit={data => {
              if (editingTask) updateTask.mutate({ taskId: editingTask.id, data })
              else createTask.mutate({ ...data, projectId: id })
            }}
            onClose={() => { setShowTaskForm(false); setEditingTask(null) }}
            employees={employees || []}
            loading={createTask.isPending || updateTask.isPending}
            initial={editingTask}
            fixedProjectId={id}
            isAdmin={isManagerPlus}
            currentUserId={user?.id}
          />
        </Modal>
      )}

      <ConfirmDialog open={!!deleteTaskId} onClose={() => setDeleteTaskId(null)}
        onConfirm={() => deleteTask.mutate(deleteTaskId!)} title={t('tasks.deleteConfirm')} message={t('tasks.deleteMessage')} danger />
    </div>
  )
}

