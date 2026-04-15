import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reportsApi, projectsApi, tasksApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState, Modal, Avatar } from '@/components/ui'
import { Plus, FileText, Trash2, Download } from 'lucide-react'
import api from '@/lib/api'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function ReportsPage() {
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'project_manager'].includes(user?.role || '')
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()
  const { t } = useTranslation()

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: isManagerPlus ? reportsApi.list : reportsApi.my,
  })

  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: myTasks } = useQuery({ queryKey: ['my-tasks'], queryFn: tasksApi.my })

  const createMut = useMutation({
    mutationFn: reportsApi.create,
    onMutate: async (data: any) => {
      setShowCreate(false)
      await qc.cancelQueries({ queryKey: ['reports'] })
      const previous = qc.getQueryData(['reports'])
      const tempReport = { id: `temp-${Date.now()}`, ...data, date: data.date || new Date().toISOString().split('T')[0], createdAt: new Date().toISOString() }
      qc.setQueryData(['reports'], (old: any[]) => old ? [tempReport, ...old] : [tempReport])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['reports'], context?.previous)
      setShowCreate(true)
      toast.error('Ошибка')
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports'] }); toast.success(t('reports.submitted')) },
  })

  const deleteMut = useMutation({
    mutationFn: reportsApi.remove,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['reports'] })
      const previous = qc.getQueryData(['reports'])
      qc.setQueryData(['reports'], (old: any[]) => old?.filter((r: any) => r.id !== id) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['reports'], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports'] }); toast.success(t('reports.deleted')) },
  })

  const exportCsv = async () => {
    const res = await api.get('/reports/export/csv', { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a'); a.href = url; a.download = 'reports.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('reports.title')}</h1>
        <div className="flex gap-2">
          {isManagerPlus && (
            <button onClick={exportCsv} className="btn-secondary" title="Экспорт CSV">
              <Download size={15} /> CSV
            </button>
          )}
          {!isManagerPlus && (
            <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> {t('reports.newReport')}</button>
          )}
        </div>
      </div>

      {!reports?.length ? (
        <EmptyState title={t('reports.noReports')} description={t('reports.noReportsDesc')} action={
          !isManagerPlus ? <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button> : undefined
        } />
      ) : (
        <div className="space-y-3">
          {reports.map((r: any) => (
            <div key={r.id} className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
                <FileText size={18} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div className="flex-1 min-w-0">
                {isManagerPlus && r.employee && (
                  <div className="flex items-center gap-2 mb-2">
                    <Avatar name={r.employee.name} size={28} />
                    <div>
                      <p className="font-semibold text-sm text-surface-900 dark:text-surface-100">{r.employee.name}</p>
                      {r.project && <p className="text-xs font-medium text-primary-600 dark:text-primary-400">{r.project.name}</p>}
                    </div>
                    <span className="ml-auto text-xs text-surface-400 dark:text-surface-500 shrink-0">{format(new Date(r.date), 'dd.MM.yyyy')}</span>
                  </div>
                )}
                {!isManagerPlus && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-surface-500 dark:text-surface-400">{format(new Date(r.date), 'dd.MM.yyyy')}</span>
                    {r.project && <span className="text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-2 py-0.5 rounded-full">{r.project.name}</span>}
                  </div>
                )}
                <p className="text-sm text-surface-700 dark:text-surface-300">{r.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-surface-400 dark:text-surface-500">
                  {r.task && <span>{t('reports.taskLabel')}: {r.task.title}</span>}
                  <span>{t('reports.timeSpent')}: <strong className="text-surface-600 dark:text-surface-300">{r.timeSpent}ч</strong></span>
                </div>
                {r.comments && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 italic">{r.comments}</p>}
              </div>
              {user?.role === 'admin' && (
                <button onClick={() => deleteMut.mutate(r.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400 shrink-0">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('reports.newReport')} size="lg">
        <ReportForm
          onSubmit={data => createMut.mutate(data)}
          onClose={() => setShowCreate(false)}
          projects={projects || []}
          tasks={myTasks || []}
          loading={createMut.isPending}
          t={t}
        />
      </Modal>
    </div>
  )
}

interface ReportFormProps {
  onSubmit: (data: Record<string, unknown>) => void
  onClose: () => void
  projects: import('@/types/entities').Project[]
  tasks: import('@/types/entities').Task[]
  loading: boolean
  t: (key: string) => string
}

function ReportForm({ onSubmit, onClose, projects, tasks, loading, t }: ReportFormProps) {
  const { register, handleSubmit, reset } = useForm<Record<string, unknown>>({ defaultValues: { date: new Date().toISOString().split('T')[0] } })
  const submit = (data: Record<string, unknown>) => { onSubmit(data); reset() }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">{t('reports.date')}</label>
          <input type="date" {...register('date', { required: true })} className="input" />
        </div>
        <div>
          <label className="label">{t('reports.timeSpent')} *</label>
          <input type="number" step="0.25" {...register('timeSpent', { required: true })} className="input" />
        </div>
        <div>
          <label className="label">{t('tasks.project')}</label>
          <select {...register('projectId')} className="input">
            <option value="">{t('common.selectOption')}</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('reports.taskLabel')}</label>
          <select {...register('taskId')} className="input">
            <option value="">{t('common.selectOption')}</option>
            {tasks.map((task: any) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label">{t('reports.workDone')} *</label>
        <textarea {...register('description', { required: true })} className="input resize-none" rows={4} />
      </div>
      <div>
        <label className="label">{t('reports.comments')}</label>
        <textarea {...register('comments')} className="input resize-none" rows={2} />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
        <button type="submit" disabled={loading} className="btn-primary">{t('reports.submit')}</button>
      </div>
    </form>
  )
}
