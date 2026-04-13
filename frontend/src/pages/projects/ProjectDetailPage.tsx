import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, tasksApi, filesApi, employeesApi } from '@/services/api.service'
import { invalidateAfterTaskChange, invalidateAfterProjectChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { PageLoader, StatusBadge, PriorityBadge, ProgressBar, Modal, Avatar, EmptyState, ConfirmDialog } from '@/components/ui'
import { ArrowLeft, Plus, Upload, Paperclip, Calendar, Users, CheckSquare, Edit, Trash2, Building2, Phone, Mail, MessageCircle, User, Briefcase, Save, X, UserPlus, Download, DollarSign, Check } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from '@/i18n'
import TaskForm from '@/components/tasks/TaskForm'
import GanttChart from '@/components/projects/GanttChart'
import SMM_QUESTIONS from '@/config/smm-questions'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const TASK_STATUSES = ['new', 'in_progress', 'review', 'done', 'cancelled']
const API_URL = import.meta.env.VITE_API_URL || ''
const fileUrl = (path: string) => path?.startsWith('http') ? path : `${API_URL}${path}`

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'tasks' | 'files' | 'about' | 'client' | 'members' | 'gantt'>('tasks')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<any>(null)
  const [showEditProject, setShowEditProject] = useState(false)
  const [showEditClient, setShowEditClient] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showChangeManager, setShowChangeManager] = useState(false)
  const [newManagerId, setNewManagerId] = useState('')
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)
  const [projectForm, setProjectForm] = useState<any>({})
  const [clientForm, setClientForm] = useState<any>({})
  const [addMemberId, setAddMemberId] = useState('')
  const qc = useQueryClient()
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'founder', 'project_manager'].includes(user?.role || '')
  const canManagePayment = user?.role === 'founder'

  const [editingPayment, setEditingPayment] = useState(false)
  const [paymentValue, setPaymentValue] = useState('')

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
      await qc.cancelQueries({ queryKey: ['projects'] })
      const previous = qc.getQueryData(['project', id])
      const previousProjects = qc.getQueryData(['projects'])

      const statusWeight: Record<string, number> = { new: 0, in_progress: 30, returned: 25, review: 70, done: 100 }

      // Update single project detail with new task status + recalc progress
      qc.setQueryData(['project', id], (old: any) => {
        if (!old) return old
        const updatedTasks = old.tasks?.map((t: any) => t.id === taskId ? { ...t, ...data } : t) || []
        const activeTasks = updatedTasks.filter((t: any) => t.status !== 'cancelled')
        const totalWeight = activeTasks.reduce((sum: number, t: any) => sum + (statusWeight[t.status] ?? 0), 0)
        const progress = activeTasks.length > 0 ? Math.round(totalWeight / activeTasks.length) : 0
        return { ...old, tasks: updatedTasks, progress }
      })

      // Also update projects list — recalc progress for this project
      qc.setQueryData(['projects'], (oldList: any[]) => {
        if (!Array.isArray(oldList)) return oldList
        const projectData = qc.getQueryData(['project', id]) as any
        const newProgress = projectData?.progress
        return oldList.map((p: any) =>
          p.id === id ? { ...p, progress: newProgress ?? p.progress } : p
        )
      })

      return { previous, previousProjects }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['project', id], context?.previous)
      qc.setQueryData(['projects'], context?.previousProjects)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
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

  const updateProject = useMutation({
    mutationFn: (data: any) => projectsApi.update(id!, data),
    onMutate: async (data: any) => {
      setShowEditProject(false)
      setShowEditClient(false)
      setShowAddMember(false)
      setShowChangeManager(false)
      await qc.cancelQueries({ queryKey: ['project', id] })
      const previous = qc.getQueryData(['project', id])
      qc.setQueryData(['project', id], (old: any) => {
        if (!old) return old
        const updated = { ...old, ...data }
        // Update manager object when managerId changes
        if (data.managerId !== undefined) {
          if (!data.managerId) {
            updated.manager = null
            updated.managerId = null
          } else {
            const emp = (employees || []).find((e: any) => (e.userId || e.id) === data.managerId)
            if (emp) updated.manager = { id: data.managerId, name: emp.fullName || emp.name, avatar: emp.avatar }
            updated.managerId = data.managerId
          }
        }
        // Update members array when memberIds changes
        if (data.memberIds !== undefined) {
          updated.members = data.memberIds.map((mid: string) => {
            const existing = old.members?.find((m: any) => m.id === mid)
            if (existing) return existing
            const emp = (employees || []).find((e: any) => (e.userId || e.id) === mid)
            return emp ? { id: mid, name: emp.fullName || emp.name, role: emp.position, avatar: emp.avatar } : { id: mid, name: '...' }
          })
        }
        return updated
      })
      return { previous }
    },
    onError: (e: any, _vars: any, context: any) => {
      qc.setQueryData(['project', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      invalidateAfterProjectChange(qc)
      qc.invalidateQueries({ queryKey: ['project', id] })
      toast.success('Проект обновлён')
    },
  })

  const deleteFileMut = useMutation({
    mutationFn: (fileId: string) => filesApi.remove(fileId),
    onMutate: async (fileId: string) => {
      setDeleteFileId(null)
      await qc.cancelQueries({ queryKey: ['files', id] })
      const previous = qc.getQueryData(['files', id])
      qc.setQueryData(['files', id], (old: any[]) => old?.filter((f: any) => f.id !== fileId) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['files', id], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['files', id] }); qc.invalidateQueries({ queryKey: ['files-project', id] }); toast.success('Файл удалён') },
  })

  const handleSaveProject = () => {
    updateProject.mutate({
      name: projectForm.name,
      projectType: projectForm.projectType,
      description: projectForm.description,
      status: projectForm.status,
      startDate: projectForm.startDate || undefined,
      endDate: projectForm.endDate || undefined,
      budget: projectForm.budget ? Number(projectForm.budget) : undefined,
    })
  }

  const handleSavePayment = () => {
    const amount = Number(paymentValue)
    if (isNaN(amount) || amount < 0) { toast.error('Введите корректную сумму'); return }
    updateProject.mutate(
      { paidAmount: amount },
      { onSuccess: () => setEditingPayment(false) },
    )
  }

  const handleSaveClient = () => {
    updateProject.mutate({ clientInfo: clientForm })
  }

  const handleAddMember = () => {
    if (!addMemberId) return
    const currentIds = (project?.members || []).map((m: any) => m.id)
    if (currentIds.includes(addMemberId)) return
    updateProject.mutate({ memberIds: [...currentIds, addMemberId] })
    setAddMemberId('')
  }

  const handleRemoveMember = (memberId: string) => {
    const currentIds = (project?.members || []).map((m: any) => m.id).filter((mid: string) => mid !== memberId)
    updateProject.mutate({ memberIds: currentIds })
  }

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await filesApi.upload(file, id)
      qc.invalidateQueries({ queryKey: ['files', id] })
      qc.invalidateQueries({ queryKey: ['files-project', id] })
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

  const participantCount = project.members?.length || 0

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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

      {/* Payment block — visible to sales manager, admin, founder */}
      {canManagePayment && (project.budget > 0 || project.paidAmount > 0) && (
        <div className="card flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-500" />
            <span className="text-sm font-semibold text-surface-800 dark:text-surface-200">Оплата проекта</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="text-center">
              <p className="text-xs text-surface-400 dark:text-surface-500">Бюджет</p>
              <p className="text-sm font-bold text-surface-800 dark:text-surface-200">{(project.budget || 0).toLocaleString('ru-RU')} сум</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-surface-400 dark:text-surface-500">Оплачено</p>
              {editingPayment ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={paymentValue}
                    onChange={e => setPaymentValue(e.target.value)}
                    className="input py-0.5 px-2 text-sm w-32"
                    min={0}
                    autoFocus
                  />
                  <button onClick={handleSavePayment} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"><Check size={14} /></button>
                  <button onClick={() => setEditingPayment(false)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><X size={14} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <p className="text-sm font-bold text-green-600 dark:text-green-400">{(project.paidAmount || 0).toLocaleString('ru-RU')} сум</p>
                  <button onClick={() => { setPaymentValue(String(project.paidAmount || 0)); setEditingPayment(true) }} className="p-0.5 text-surface-400 hover:text-primary-600"><Edit size={12} /></button>
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="text-xs text-surface-400 dark:text-surface-500">Остаток</p>
              <p className={`text-sm font-bold ${((project.budget || 0) - (project.paidAmount || 0)) > 0 ? 'text-orange-500' : 'text-green-600 dark:text-green-400'}`}>
                {((project.budget || 0) - (project.paidAmount || 0)).toLocaleString('ru-RU')} сум
              </p>
            </div>
            <div className="flex-1 max-w-xs">
              <div className="w-full bg-surface-100 dark:bg-surface-700 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, Math.round(((project.paidAmount || 0) / (project.budget || 1)) * 100))}%` }}
                />
              </div>
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5 text-right">
                {Math.min(100, Math.round(((project.paidAmount || 0) / (project.budget || 1)) * 100))}% оплачено
              </p>
            </div>
          </div>
        </div>
      )}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {files.map((f: any) => (
                <div key={f.id} className="card flex items-center gap-3 hover:shadow-md transition-shadow group">
                  <a href={fileUrl(f.path)} target="_blank" rel="noreferrer" download={f.originalName} className="flex items-center gap-3 flex-1 min-w-0">
                    <Paperclip size={18} className="text-primary-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{f.originalName}</p>
                      <p className="text-xs text-surface-400 dark:text-surface-500">{(f.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </a>
                  {isManagerPlus && (
                    <button
                      onClick={() => setDeleteFileId(f.id)}
                      className="hidden group-hover:flex p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'about' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="card space-y-4">
            <div className="flex items-center justify-between border-b border-surface-100 dark:border-surface-700 pb-3">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base">Информация о проекте</h3>
              {isManagerPlus && (
                <button onClick={() => { setProjectForm({ name: project.name, projectType: project.projectType || '', description: project.description || '', status: project.status, startDate: project.startDate ? String(project.startDate).slice(0,10) : '', endDate: project.endDate ? String(project.endDate).slice(0,10) : '', budget: project.budget || '' }); setShowEditProject(true) }}
                  className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline">
                  <Edit size={13} /> Редактировать
                </button>
              )}
            </div>
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
              {canManagePayment && project.budget != null && (
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
              <div className="flex items-center justify-between border-b border-surface-100 dark:border-surface-700 pb-3">
                <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base">SMM-анкета</h3>
                <button
                  onClick={() => {
                    const lines = SMM_QUESTIONS.map(q => `${q.label}:\n${(project.smmData as any)[q.key] || '—'}`).join('\n\n')
                    const content = `SMM-АНКЕТА\nПроект: ${project.name}\nДата: ${new Date().toLocaleDateString('ru-RU')}\n${'─'.repeat(40)}\n\n${lines}`
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `SMM_Анкета_${project.name}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                >
                  <Download size={13} /> Скачать .txt
                </button>
              </div>
              <div className="space-y-2">
                {SMM_QUESTIONS
                  .filter(q => (project.smmData as any)[q.key])
                  .map(q => (
                    <div key={q.key} className="grid grid-cols-1 md:grid-cols-2 gap-1 py-2 border-b border-surface-50 dark:border-surface-700 last:border-0">
                      <p className="text-xs text-surface-500 dark:text-surface-400">{q.label}</p>
                      <p className="text-sm text-surface-800 dark:text-surface-200">{String((project.smmData as any)[q.key]) || '—'}</p>
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
            <div className="flex items-center justify-between border-b border-surface-100 dark:border-surface-700 pb-3">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base">Данные клиента</h3>
              {isManagerPlus && (
                <button onClick={() => { setClientForm({ companyName: project.clientInfo?.companyName || '', contactPerson: project.clientInfo?.contactPerson || '', phone: project.clientInfo?.phone || '', email: project.clientInfo?.email || '', whatsapp: project.clientInfo?.whatsapp || '', instagram: project.clientInfo?.instagram || '' }); setShowEditClient(true) }}
                  className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline">
                  <Edit size={13} /> {project.clientInfo && Object.keys(project.clientInfo).length > 0 ? 'Редактировать' : 'Добавить'}
                </button>
              )}
            </div>
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
        <div className="space-y-4">
          {isManagerPlus && (
            <div className="flex justify-end">
              <button onClick={() => { setAddMemberId(''); setShowAddMember(true) }}
                className="btn-primary flex items-center gap-2">
                <UserPlus size={15} /> Добавить участника
              </button>
            </div>
          )}

          {/* Менеджер проекта */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Менеджер проекта</h3>
              {isManagerPlus && (
                <button
                  onClick={() => { setNewManagerId((project as any).managerId || ''); setShowChangeManager(true) }}
                  className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                >
                  <Edit size={12} /> {project.manager ? 'Сменить' : 'Назначить'}
                </button>
              )}
            </div>
            {project.manager ? (
              <div className="card flex items-center gap-3 max-w-xs border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10">
                <Avatar name={project.manager.name} src={project.manager.avatar} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-surface-900 dark:text-surface-100">{project.manager.name}</p>
                  <span className="inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                    Менеджер
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-surface-400 dark:text-surface-500 italic">Менеджер не назначен</p>
            )}
          </div>

          {/* Участники */}
          <div>
            {project.manager && (
              <h3 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">Участники</h3>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(project.members || [])
                .filter((m: any) => m.id !== project.manager?.id)
                .map((m: any) => (
                  <div key={m.id} className="card flex items-center gap-3 group">
                    <Avatar name={m.name} src={m.avatar} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-surface-900 dark:text-surface-100">{m.name}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400 capitalize">{m.role || ''}</p>
                    </div>
                    {isManagerPlus && (
                      <button onClick={() => handleRemoveMember(m.id)}
                        className="hidden group-hover:flex items-center p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400 transition-colors">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              {(!project.members || project.members.filter((m: any) => m.id !== project.manager?.id).length === 0) && !project.manager && (
                <div className="col-span-3">
                  <EmptyState title={t('noMembers')} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Project */}
      <Modal open={showEditProject} onClose={() => setShowEditProject(false)} title="Редактировать проект">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Название *</label>
            <input value={projectForm.name || ''} onChange={e => setProjectForm((f: any) => ({ ...f, name: e.target.value }))} className="input w-full" />
          </div>
          <div>
            <label className="label mb-1">Тип проекта</label>
            <input value={projectForm.projectType || ''} onChange={e => setProjectForm((f: any) => ({ ...f, projectType: e.target.value }))} className="input w-full" placeholder="SMM, Web сайт, Дизайн..." />
          </div>
          <div>
            <label className="label mb-1">Описание</label>
            <textarea value={projectForm.description || ''} onChange={e => setProjectForm((f: any) => ({ ...f, description: e.target.value }))} rows={3} className="input w-full resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label mb-1">Дата начала</label>
              <input type="date" value={projectForm.startDate || ''} onChange={e => setProjectForm((f: any) => ({ ...f, startDate: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="label mb-1">Дата завершения</label>
              <input type="date" value={projectForm.endDate || ''} onChange={e => setProjectForm((f: any) => ({ ...f, endDate: e.target.value }))} className="input w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label mb-1">Статус</label>
              <select value={projectForm.status || ''} onChange={e => setProjectForm((f: any) => ({ ...f, status: e.target.value }))} className="input w-full">
                <option value="planning">Планирование</option>
                <option value="in_progress">В работе</option>
                <option value="completed">Завершён</option>
                <option value="on_hold">На паузе</option>
              </select>
            </div>
            {canManagePayment && (
              <div>
                <label className="label mb-1">Бюджет (сом)</label>
                <input type="number" value={projectForm.budget || ''} onChange={e => setProjectForm((f: any) => ({ ...f, budget: e.target.value }))} className="input w-full" placeholder="0" />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowEditProject(false)} className="btn-secondary">Отмена</button>
            <button onClick={handleSaveProject} disabled={!projectForm.name || updateProject.isPending} className="btn-primary flex items-center gap-2">
              <Save size={15} /> Сохранить
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Edit Client */}
      <Modal open={showEditClient} onClose={() => setShowEditClient(false)} title="Данные клиента">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Компания / Бренд</label>
            <input value={clientForm.companyName || ''} onChange={e => setClientForm((f: any) => ({ ...f, companyName: e.target.value }))} className="input w-full" placeholder="ООО Компания" />
          </div>
          <div>
            <label className="label mb-1">Контактное лицо</label>
            <input value={clientForm.contactPerson || ''} onChange={e => setClientForm((f: any) => ({ ...f, contactPerson: e.target.value }))} className="input w-full" placeholder="Иван Иванов" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label mb-1">Телефон</label>
              <input value={clientForm.phone || ''} onChange={e => setClientForm((f: any) => ({ ...f, phone: e.target.value }))} className="input w-full" placeholder="+7..." />
            </div>
            <div>
              <label className="label mb-1">Email</label>
              <input type="email" value={clientForm.email || ''} onChange={e => setClientForm((f: any) => ({ ...f, email: e.target.value }))} className="input w-full" placeholder="email@..." />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label mb-1">WhatsApp</label>
              <input value={clientForm.whatsapp || ''} onChange={e => setClientForm((f: any) => ({ ...f, whatsapp: e.target.value }))} className="input w-full" placeholder="+7..." />
            </div>
            <div>
              <label className="label mb-1">Instagram</label>
              <input value={clientForm.instagram || ''} onChange={e => setClientForm((f: any) => ({ ...f, instagram: e.target.value }))} className="input w-full" placeholder="@username" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowEditClient(false)} className="btn-secondary">Отмена</button>
            <button onClick={handleSaveClient} disabled={updateProject.isPending} className="btn-primary flex items-center gap-2">
              <Save size={15} /> Сохранить
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Add Member */}
      <Modal open={showAddMember} onClose={() => setShowAddMember(false)} title="Добавить участника" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Выбрать сотрудника</label>
            <select value={addMemberId} onChange={e => setAddMemberId(e.target.value)} className="input w-full">
              <option value="">— выберите —</option>
              {(employees || [])
                .filter((e: any) => !(project?.members || []).some((m: any) => m.id === (e.userId || e.id)))
                .map((e: any) => (
                  <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName}</option>
                ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddMember(false)} className="btn-secondary">Отмена</button>
            <button onClick={handleAddMember} disabled={!addMemberId || updateProject.isPending} className="btn-primary flex items-center gap-2">
              <UserPlus size={15} /> Добавить
            </button>
          </div>
        </div>
      </Modal>

      {showTaskForm && (
        <Modal open={showTaskForm} onClose={() => { setShowTaskForm(false); setEditingTask(null) }} title={editingTask ? t('tasks.editTask') : t('tasks.newTask')}>
          <TaskForm
            onSubmit={data => {
              if (editingTask) updateTask.mutate({ taskId: editingTask.id, data })
              else createTask.mutate({ ...data, projectId: id })
            }}
            onClose={() => { setShowTaskForm(false); setEditingTask(null) }}
            employees={(employees || []).filter((e: any) =>
              (project?.members || []).some((m: any) => m.id === (e.userId || e.id))
            )}
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

      <ConfirmDialog open={!!deleteFileId} onClose={() => setDeleteFileId(null)}
        onConfirm={() => deleteFileMut.mutate(deleteFileId!)} title="Удалить файл?" message="Файл будет удалён безвозвратно." danger />

      {/* Modal: Change Manager */}
      <Modal open={showChangeManager} onClose={() => setShowChangeManager(false)} title="Менеджер проекта" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Выбрать менеджера</label>
            <select value={newManagerId} onChange={e => setNewManagerId(e.target.value)} className="input w-full">
              <option value="">— Не назначен —</option>
              {(employees || []).map((e: any) => (
                <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowChangeManager(false)} className="btn-secondary">Отмена</button>
            <button
              onClick={() => { updateProject.mutate({ managerId: newManagerId || null }); setShowChangeManager(false) }}
              disabled={updateProject.isPending}
              className="btn-primary flex items-center gap-2"
            >
              <Save size={15} /> Сохранить
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

