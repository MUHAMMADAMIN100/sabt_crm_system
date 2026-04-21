import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reportsApi, projectsApi, tasksApi, analyticsApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState, Modal, Avatar } from '@/components/ui'
import { Plus, FileText, Trash2, Download, FileBarChart, Users, FolderKanban, Search } from 'lucide-react'
import api from '@/lib/api'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { generateProjectReport, generateEmployeeReport, generateSingleProjectReport, generateSingleEmployeeReport } from '@/lib/pdfReports'

export default function ReportsPage() {
  const user = useAuthStore(s => s.user)
  const isHeadSMM = user?.role === 'head_smm'
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'project_manager', 'head_smm'].includes(user?.role || '')
  const canDownloadReports = ['founder', 'co_founder', 'admin'].includes(user?.role || '')

  const [generating, setGenerating] = useState<string | null>(null)
  const [projectsPeriod, setProjectsPeriod] = useState<'week' | 'month'>('week')
  const [employeesPeriod, setEmployeesPeriod] = useState<'week' | 'month'>('week')
  const [showProjectsModal, setShowProjectsModal] = useState(false)
  const [showEmployeesModal, setShowEmployeesModal] = useState(false)
  const [reportSearch, setReportSearch] = useState('')

  const { data: allProjectsList } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    enabled: canDownloadReports,
  })

  const { data: allEmployeesList } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
    enabled: canDownloadReports,
  })

  const downloadProjectReport = async (projectId?: string) => {
    setGenerating('projects')
    try {
      const data = await analyticsApi.reportProjects(projectsPeriod, projectId)
      if (projectId) generateSingleProjectReport(data)
      else generateProjectReport(data)
      toast.success('PDF скачан')
      setShowProjectsModal(false)
    } catch {
      toast.error('Не удалось сгенерировать отчёт')
    } finally {
      setGenerating(null)
    }
  }

  const downloadEmployeeReport = async (employeeId?: string) => {
    setGenerating('employees')
    try {
      const data = await analyticsApi.reportEmployees(employeesPeriod, employeeId)
      if (employeeId) generateSingleEmployeeReport(data)
      else generateEmployeeReport(data)
      toast.success('PDF скачан')
      setShowEmployeesModal(false)
    } catch {
      toast.error('Не удалось сгенерировать отчёт')
    } finally {
      setGenerating(null)
    }
  }

  const filteredModalProjects = (allProjectsList || []).filter((p: any) =>
    !reportSearch || p.name.toLowerCase().includes(reportSearch.toLowerCase()),
  )
  const filteredModalEmployees = (allEmployeesList || []).filter((e: any) =>
    !reportSearch || (e.fullName || '').toLowerCase().includes(reportSearch.toLowerCase()),
  )
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

  // head_smm sees only reports from SMM projects
  const filteredReports = isHeadSMM
    ? (reports || []).filter((r: any) => r.project?.projectType === 'SMM' || !r.project)
    : reports

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

      {/* PDF reports — founder/co_founder only */}
      {canDownloadReports && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <FileBarChart size={18} className="text-primary-500" />
            <h2 className="font-semibold text-surface-900 dark:text-surface-100">PDF-отчёты</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Projects report */}
            <div className="p-4 rounded-xl border border-surface-100 dark:border-surface-700 bg-gradient-to-br from-primary-50/50 to-transparent dark:from-primary-900/10">
              <div className="flex items-center gap-2 mb-2">
                <FolderKanban size={16} className="text-primary-600 dark:text-primary-400" />
                <h3 className="font-semibold text-surface-900 dark:text-surface-100">По проектам</h3>
              </div>
              <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
                Истории, задачи, прогресс — для каждого проекта за выбранный период
              </p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-1">
                  {(['week','month'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setProjectsPeriod(p)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        projectsPeriod === p
                          ? 'bg-primary-600 text-white'
                          : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300'
                      }`}
                    >{p === 'week' ? 'Неделя' : 'Месяц'}</button>
                  ))}
                </div>
                <button
                  onClick={() => { setReportSearch(''); setShowProjectsModal(true) }}
                  disabled={generating === 'projects'}
                  className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Download size={14} /> {generating === 'projects' ? 'Создаю...' : 'Скачать PDF'}
                </button>
              </div>
            </div>

            {/* Employees report */}
            <div className="p-4 rounded-xl border border-surface-100 dark:border-surface-700 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-900/10">
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} className="text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-semibold text-surface-900 dark:text-surface-100">По сотрудникам</h3>
              </div>
              <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
                Назначено, выполнено, просрочено, часы и эффективность каждого сотрудника
              </p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-1">
                  {(['week','month'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setEmployeesPeriod(p)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        employeesPeriod === p
                          ? 'bg-emerald-600 text-white'
                          : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300'
                      }`}
                    >{p === 'week' ? 'Неделя' : 'Месяц'}</button>
                  ))}
                </div>
                <button
                  onClick={() => { setReportSearch(''); setShowEmployeesModal(true) }}
                  disabled={generating === 'employees'}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors disabled:opacity-50"
                >
                  <Download size={14} /> {generating === 'employees' ? 'Создаю...' : 'Скачать PDF'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!filteredReports?.length ? (
        <EmptyState title={t('reports.noReports')} description={t('reports.noReportsDesc')} action={
          !isManagerPlus ? <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button> : undefined
        } />
      ) : (
        <div className="space-y-3">
          {filteredReports.map((r: any) => (
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

      {/* Project selection modal */}
      <Modal open={showProjectsModal} onClose={() => setShowProjectsModal(false)} title="Выберите проект для отчёта" size="md">
        <div className="space-y-3">
          <button
            onClick={() => downloadProjectReport()}
            disabled={generating === 'projects'}
            className="w-full p-3 rounded-xl border-2 border-primary-500 bg-primary-50/50 dark:bg-primary-900/10 hover:bg-primary-100/50 dark:hover:bg-primary-900/20 transition-colors text-left flex items-center gap-3 disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-primary-600 text-white flex items-center justify-center"><FolderKanban size={16} /></div>
            <div className="flex-1">
              <p className="font-semibold text-surface-900 dark:text-surface-100">Все проекты (сводный)</p>
              <p className="text-xs text-surface-500 dark:text-surface-400">Общий отчёт по всем активным проектам</p>
            </div>
            <Download size={16} className="text-primary-600" />
          </button>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              value={reportSearch}
              onChange={e => setReportSearch(e.target.value)}
              placeholder="Поиск проекта..."
              className="input pl-9 w-full text-sm"
            />
          </div>

          <div className="max-h-[400px] overflow-y-auto space-y-1.5">
            {filteredModalProjects.length === 0 ? (
              <p className="text-sm text-surface-400 text-center py-6">Нет проектов</p>
            ) : (
              filteredModalProjects.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => downloadProjectReport(p.id)}
                  disabled={generating === 'projects'}
                  className="w-full p-2.5 rounded-lg border border-surface-100 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left flex items-center gap-3 disabled:opacity-50"
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: p.color || '#6B4FCF' }}>
                    <FolderKanban size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-surface-900 dark:text-surface-100 truncate">{p.name}</p>
                    <p className="text-[11px] text-surface-400 dark:text-surface-500">{p.projectType || '—'}</p>
                  </div>
                  <Download size={14} className="text-surface-400" />
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Employee selection modal */}
      <Modal open={showEmployeesModal} onClose={() => setShowEmployeesModal(false)} title="Выберите сотрудника для отчёта" size="md">
        <div className="space-y-3">
          <button
            onClick={() => downloadEmployeeReport()}
            disabled={generating === 'employees'}
            className="w-full p-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20 transition-colors text-left flex items-center gap-3 disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center"><Users size={16} /></div>
            <div className="flex-1">
              <p className="font-semibold text-surface-900 dark:text-surface-100">Все сотрудники (сводный)</p>
              <p className="text-xs text-surface-500 dark:text-surface-400">Общий отчёт со всей командой</p>
            </div>
            <Download size={16} className="text-emerald-600" />
          </button>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              value={reportSearch}
              onChange={e => setReportSearch(e.target.value)}
              placeholder="Поиск сотрудника..."
              className="input pl-9 w-full text-sm"
            />
          </div>

          <div className="max-h-[400px] overflow-y-auto space-y-1.5">
            {filteredModalEmployees.length === 0 ? (
              <p className="text-sm text-surface-400 text-center py-6">Нет сотрудников</p>
            ) : (
              filteredModalEmployees.map((e: any) => (
                <button
                  key={e.id}
                  onClick={() => downloadEmployeeReport(e.id)}
                  disabled={generating === 'employees'}
                  className="w-full p-2.5 rounded-lg border border-surface-100 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left flex items-center gap-3 disabled:opacity-50"
                >
                  <Avatar name={e.fullName} src={e.avatar} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-surface-900 dark:text-surface-100 truncate">{e.fullName}</p>
                    <p className="text-[11px] text-surface-400 dark:text-surface-500">{e.position || '—'}</p>
                  </div>
                  <Download size={14} className="text-surface-400" />
                </button>
              ))
            )}
          </div>
        </div>
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
