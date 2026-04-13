import { useEffect, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from '@/i18n'
import { useAuthStore } from '@/store/auth.store'

interface TaskFormProps {
  onSubmit: (data: any) => void
  onClose: () => void
  loading?: boolean
  initial?: any
  projects?: any[]
  employees?: any[]
  /** If set, hides project selector and uses this fixed project id */
  fixedProjectId?: string
  /** Pre-fill deadline (e.g. from calendar date click) */
  initialDeadline?: string
  isAdmin?: boolean
  currentUserId?: string
}

export default function TaskForm({
  onSubmit, onClose, loading, initial, projects, employees,
  fixedProjectId, initialDeadline, isAdmin, currentUserId,
}: TaskFormProps) {
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm()
  const { t } = useTranslation()
  const authUser = useAuthStore(s => s.user)

  // Watch the selected projectId so we can filter assignees by project members
  const selectedProjectId = useWatch({ control, name: 'projectId' }) || fixedProjectId

  // Filter employees: only those who are members of the selected project
  const filteredEmployees = useMemo(() => {
    if (!employees) return []
    if (!selectedProjectId || !projects) return employees
    const project = projects.find((p: any) => p.id === selectedProjectId)
    if (!project) return employees
    const memberIds = (project.members || []).map((m: any) => m.id)
    if (!memberIds.length) return employees
    return employees.filter((e: any) => memberIds.includes(e.userId || e.id))
  }, [employees, selectedProjectId, projects])

  useEffect(() => {
    if (initial) {
      reset({
        title: initial.title || '',
        description: initial.description || '',
        projectId: initial.projectId || fixedProjectId || '',
        assigneeId: initial.assigneeId || '',
        priority: initial.priority || 'medium',
        deadline: initial.deadline ? new Date(initial.deadline).toISOString().slice(0, 16) : (initialDeadline || ''),
        targetCount: initial.targetCount || '',
      })
    } else {
      reset({
        title: '',
        description: '',
        projectId: fixedProjectId || '',
        assigneeId: isAdmin ? '' : (currentUserId || ''),
        priority: 'medium',
        deadline: initialDeadline || '',
      })
    }
  }, [initial, reset, fixedProjectId, initialDeadline, isAdmin, currentUserId])

  const submit = (data: any) => {
    onSubmit({
      title: data.title,
      description: data.description || undefined,
      projectId: fixedProjectId || data.projectId,
      assigneeId: data.assigneeId || currentUserId,
      priority: data.priority,
      deadline: data.deadline,
      targetCount: data.targetCount ? Number(data.targetCount) : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div>
        <label className="label">{t('tasks.name')} *</label>
        <input {...register('title', { required: true })} className="input" />
        {errors.title && <p className="text-xs text-red-500 mt-1">{t('tasks.name')} обязательно</p>}
      </div>
      <div>
        <label className="label">{t('tasks.description')}</label>
        <textarea {...register('description')} className="input resize-none" rows={3} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!fixedProjectId && projects && (
          <div>
            <label className="label">{t('tasks.project')} *</label>
            <select {...register('projectId', { required: true })} className="input">
              <option value="">{t('common.selectOption')}</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {errors.projectId && <p className="text-xs text-red-500 mt-1">{t('tasks.project')} обязательно</p>}
          </div>
        )}
        {!isAdmin ? (
          <div>
            <label className="label">{t('tasks.assignee')} *</label>
            <input
              type="text"
              value={authUser?.name || ''}
              readOnly
              className="input bg-surface-50 dark:bg-surface-800 cursor-not-allowed"
              title="Сотрудники могут создавать задачи только для себя"
            />
            <input type="hidden" {...register('assigneeId')} value={currentUserId || ''} />
          </div>
        ) : employees && (
          <div>
            <label className="label">{t('tasks.assignee')} *</label>
            <select {...register('assigneeId', { required: true })} className="input" disabled={!selectedProjectId}>
              <option value="">
                {!selectedProjectId ? 'Сначала выберите проект' : (filteredEmployees.length ? t('common.selectOption') : 'Нет участников в проекте')}
              </option>
              {filteredEmployees.map((e: any) => <option key={e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>)}
            </select>
            {errors.assigneeId && <p className="text-xs text-red-500 mt-1">{t('tasks.assignee')} обязательно</p>}
            {selectedProjectId && filteredEmployees.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Сначала добавьте сотрудника как участника проекта</p>
            )}
          </div>
        )}
        <div>
          <label className="label">{t('common.priority')} *</label>
          <select {...register('priority', { required: true })} className="input">
            {['low', 'medium', 'high', 'critical'].map(p => (
              <option key={p} value={p}>{t(`priorities.${p}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('tasks.deadline')} *</label>
          <input type="datetime-local" {...register('deadline', { required: true })} className="input" />
          {errors.deadline && <p className="text-xs text-red-500 mt-1">{t('tasks.deadline')} обязательно</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">{t('common.cancel')}</button>
        <button type="submit" disabled={loading} className="btn-primary min-w-[110px] justify-center">
          {loading ? (
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" opacity="0.3"/>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="10" strokeDashoffset="0"/>
              </svg>
              {initial ? 'Сохранение...' : 'Создание...'}
            </>
          ) : (
            initial ? t('common.save') : t('common.create')
          )}
        </button>
      </div>
    </form>
  )
}
