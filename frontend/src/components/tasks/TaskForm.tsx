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

  // Filter employees: members of the selected project + project manager
  // (менеджер проекта тоже должен быть доступен в дропдауне assignee/reviewer
  // даже если он не числится в списке members).
  const filteredEmployees = useMemo(() => {
    if (!employees) return []
    if (!selectedProjectId || !projects) return employees
    const project = projects.find((p: any) => p.id === selectedProjectId)
    if (!project) return employees
    const allowedIds = new Set<string>(
      (project.members || []).map((m: any) => m.id),
    )
    if (project.managerId) allowedIds.add(project.managerId)
    if (allowedIds.size === 0) return employees
    return employees.filter((e: any) => allowedIds.has(e.userId || e.id))
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
        // Wave 17: расширенные поля задач (TZ п.5)
        reviewerId: initial.reviewerId || '',
        estimatedHours: initial.estimatedHours ?? '',
        actualCompletionHours: initial.actualCompletionHours ?? '',
        deliveryType: initial.deliveryType || '',
        qualityScore: initial.qualityScore ?? '',
        acceptedOnFirstTry: !!initial.acceptedOnFirstTry,
      })
    } else {
      reset({
        title: '',
        description: '',
        projectId: fixedProjectId || '',
        assigneeId: isAdmin ? '' : (currentUserId || ''),
        priority: 'medium',
        deadline: initialDeadline || '',
        reviewerId: '',
        estimatedHours: '',
        actualCompletionHours: '',
        deliveryType: '',
        qualityScore: '',
        acceptedOnFirstTry: false,
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
      // Wave 17 поля
      reviewerId: data.reviewerId || undefined,
      estimatedHours: data.estimatedHours !== '' ? Number(data.estimatedHours) : undefined,
      actualCompletionHours: data.actualCompletionHours !== '' ? Number(data.actualCompletionHours) : undefined,
      deliveryType: data.deliveryType || undefined,
      qualityScore: data.qualityScore !== '' ? Number(data.qualityScore) : undefined,
      acceptedOnFirstTry: !!data.acceptedOnFirstTry,
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

      {/* Wave 17: расширенные поля задачи (TZ п.5) — необязательные */}
      {isAdmin && (
        <details className="border border-surface-200 dark:border-surface-700 rounded-lg p-3 bg-surface-50 dark:bg-surface-800/50">
          <summary className="cursor-pointer text-sm font-medium select-none">Доп. поля: проверяющий, тип результата, оценка качества</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="label">Проверяющий (PM/reviewer)</label>
              <select {...register('reviewerId')} className="input">
                <option value="">— Не назначен —</option>
                {(employees || []).map((e: any) => (
                  <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Тип результата (delivery_type)</label>
              <select {...register('deliveryType')} className="input">
                <option value="">— Не указан —</option>
                <option value="post">Post</option>
                <option value="reel">Reel</option>
                <option value="story">Story</option>
                <option value="design">Design</option>
                <option value="ad">Ad</option>
                <option value="video">Video</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Estimated time (часов)</label>
              <input type="number" step="0.25" min="0" {...register('estimatedHours')} className="input" placeholder="0" />
            </div>
            <div>
              <label className="label">Actual completion (часов)</label>
              <input type="number" step="0.25" min="0" {...register('actualCompletionHours')} className="input" placeholder="0" />
            </div>
            <div>
              <label className="label">Quality score (1-10)</label>
              <input type="number" min="1" max="10" step="1" {...register('qualityScore')} className="input" placeholder="—" />
            </div>
            <label className="inline-flex items-center gap-2 mt-6 text-sm cursor-pointer select-none">
              <input type="checkbox" {...register('acceptedOnFirstTry')} className="rounded" />
              Принято с первого раза
            </label>
          </div>
        </details>
      )}

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
