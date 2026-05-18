import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { projectsApi, employeesApi, smmTariffsApi, riskApi, teamsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { Modal, StatusBadge, EmptyState, PageLoader, ProgressBar, ConfirmDialog, Avatar, Pagination } from '@/components/ui'
import { Plus, Search, FolderKanban, Archive, Trash2, Edit, Users, ChevronDown, X, Check, Banknote, Calendar as CalIcon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import SMM_QUESTIONS from '@/config/smm-questions'
import type { Project, Employee } from '@/types/entities'

interface ProjectFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
  initial: Project | null
  employees: Employee[]
  loading: boolean
}

const PROJECT_TYPE_FILTERS = [
  { value: '', label: 'Все типы' },
  { value: 'Web сайт', label: 'Web сайт' },
  { value: 'Дизайн', label: 'Дизайн' },
  { value: 'SMM', label: 'SMM' },
]

export default function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [projectType, setProjectType] = useState('')
  // Wave 16: дополнительные фильтры из ТЗ п.13
  const [filterTariff, setFilterTariff] = useState('')        // tariffId или ''
  const [filterPm, setFilterPm] = useState('')                // managerId или ''
  const [filterRisk, setFilterRisk] = useState('')            // 'red'|'yellow'|'green'|''
  const [filterPayment, setFilterPayment] = useState('')      // paymentStatus или ''
  const [filterOveruse, setFilterOveruse] = useState(false)   // только с перерасходом
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12
  const [showCreate, setShowCreate] = useState(false)
  const [editProject, setEditProject] = useState<any>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(user?.role || '')
  const isHeadSMM = user?.role === 'head_smm' || user?.role === 'smm_director'
  // Роли, привязанные к одному типу проектов (SMM-руководство/специалисты,
  // МП по продажам), видят проекты только своего типа — фильтр по типу им
  // не нужен и не показывается.
  const isSingleTypeRole = ['smm_director', 'head_smm', 'sales_manager_smm', 'sales_manager_dev']
    .includes(user?.role || '')
  // admin/founder/co-founder + smm_director/head_smm (SMM only) can create projects
  const canCreateProject = ['admin', 'founder', 'co_founder', 'smm_director', 'head_smm'].includes(user?.role || '')
  const qc = useQueryClient()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: allProjects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    refetchInterval: 60000, // refresh every 60s to update ad status indicators
  })

  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  // Wave 16: тарифы — для дропдауна фильтра
  const { data: tariffsList } = useQuery({
    queryKey: ['smm-tariffs', { isActive: undefined }],
    queryFn: () => smmTariffsApi.list(),
  })

  // Wave 16: риски всех проектов — для фильтрации по уровню
  const { data: projectRisks } = useQuery({
    queryKey: ['risks-projects'],
    queryFn: riskApi.projectRisks,
    enabled: !!filterRisk,
  })
  const riskByProject = new Map<string, string>(
    (projectRisks ?? []).map((r: any) => [r.projectId, r.level]),
  )

  // Список PM-ов: только сотрудники с менеджерскими ролями
  const pmList = (employees ?? []).filter((e: any) =>
    ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(e.user?.role),
  )

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, status, projectType, filterTariff, filterPm, filterRisk, filterPayment, filterOveruse])

  const projects = allProjects?.filter((p: any) => {
    const matchesSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = !status || p.status === status
    const matchesType = !projectType || p.projectType === projectType
    const matchesTariff = !filterTariff || p.tariffId === filterTariff
    const matchesPm = !filterPm || p.managerId === filterPm
    const matchesPayment = !filterPayment || p.paymentStatus === filterPayment
    const matchesOveruse = !filterOveruse || Number(p.tariffLimitOveruseCost ?? 0) > 0
    const matchesRisk = !filterRisk || riskByProject.get(p.id) === filterRisk
    return matchesSearch && matchesStatus && matchesType && matchesTariff && matchesPm && matchesPayment && matchesOveruse && matchesRisk
  }) || []

  const pagedProjects = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const STATUSES = [
    { value: '', label: t('statuses.all') },
    { value: 'planning', label: t('statuses.planning') },
    { value: 'in_progress', label: t('statuses.in_progress') },
    { value: 'completed', label: t('statuses.completed') },
  ]

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      // SMM questionnaire is stored in project.smmData — the dedicated PDF
      // download button on ProjectDetailPage renders it live, no need to
      // attach a text file that would eventually 404 when Railway's
      // ephemeral filesystem rotates.
      return await projectsApi.create(data)
    },
    onSuccess: async (newProject: any) => {
      setShowCreate(false)
      // Insert the real project into cache immediately so user sees it
      qc.setQueryData(['projects'], (old: any[]) => {
        if (!Array.isArray(old)) return [newProject]
        // Avoid duplicates
        if (old.some((p: any) => p.id === newProject.id)) return old
        return [newProject, ...old]
      })
      // Then refetch to get full server state (with manager, members, counts)
      await qc.refetchQueries({ queryKey: ['projects'] })
      toast.success(t('projects.created'))
    },
    onError: () => {
      setShowCreate(true)
      toast.error(t('common.error'))
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => projectsApi.update(id, data),
    onMutate: async ({ id: projId, data }: any) => {
      setEditProject(null)
      await qc.cancelQueries({ queryKey: ['projects'] })
      const previous = qc.getQueryData(['projects'])
      qc.setQueryData(['projects'], (old: any[]) => old?.map((p: any) => p.id === projId ? { ...p, ...data } : p) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['projects'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: (_, vars: any) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      // После сохранения проекта могли добавиться новые платежи —
      // инвалидируем кеш платежей чтобы форма при повторном открытии
      // подгрузила свежий список.
      qc.invalidateQueries({ queryKey: ['project-payments', vars?.id] });
      toast.success(t('projects.updated'))
    },
  })

  const archiveMut = useMutation({
    mutationFn: projectsApi.archive,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['projects'] })
      const previous = qc.getQueryData(['projects'])
      qc.setQueryData(['projects'], (old: any[]) => old?.map((p: any) => p.id === id ? { ...p, isArchived: true } : p) ?? [])
      return { previous }
    },
    onError: (_err: any, _id: any, context: any) => {
      qc.setQueryData(['projects'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['projects-archived'] }); qc.invalidateQueries({ queryKey: ['analytics-dashboard'] }); toast.success(t('projects.archived')) },
  })

  const deleteMut = useMutation({
    mutationFn: projectsApi.remove,
    onMutate: async (id: string) => {
      setDeleteId(null)
      await qc.cancelQueries({ queryKey: ['projects'] })
      const previous = qc.getQueryData(['projects'])
      qc.setQueryData(['projects'], (old: any[]) => old?.filter((p: any) => p.id !== id) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['projects'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success(t('projects.deleted')) },
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{t('projects.title')}</h1>
        {canCreateProject && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> <span className="hidden sm:inline">{t('projects.newProject')}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-2.5">
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('projects.searchPlaceholder')} className="input pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUSES.map(s => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={clsx('btn text-xs', status === s.value ? 'btn-primary' : 'btn-secondary')}
              >{s.label}</button>
            ))}
          </div>
        </div>
        {!isSingleTypeRole && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-surface-500 dark:text-surface-400 mr-1">Тип:</span>
            {PROJECT_TYPE_FILTERS.map(pt => (
              <button
                key={pt.value}
                onClick={() => setProjectType(pt.value)}
                className={clsx(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  projectType === pt.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
                )}
              >{pt.label}</button>
            ))}
          </div>
        )}

        {/* Wave 16: расширенные фильтры (TZ п.13) */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filterTariff} onChange={e => setFilterTariff(e.target.value)} className="px-2.5 py-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs">
            <option value="">Все тарифы</option>
            {(tariffsList ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select value={filterPm} onChange={e => setFilterPm(e.target.value)} className="px-2.5 py-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs">
            <option value="">Все PM</option>
            {pmList.map((e: any) => (
              <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>
            ))}
          </select>
          <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)} className="px-2.5 py-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs">
            <option value="">Любой риск</option>
            <option value="red">🔥 Red</option>
            <option value="yellow">⚠️ Yellow</option>
            <option value="green">✓ Green</option>
          </select>
          <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className="px-2.5 py-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs">
            <option value="">Все оплаты</option>
            <option value="pending">Ожидает</option>
            <option value="invoice_sent">Счёт отправлен</option>
            <option value="partially_paid">Частично</option>
            <option value="paid">Оплачено</option>
            <option value="overdue">Просрочено</option>
            <option value="frozen">Заморожено</option>
          </select>
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs cursor-pointer">
            <input type="checkbox" checked={filterOveruse} onChange={e => setFilterOveruse(e.target.checked)} />
            Только с перерасходом
          </label>
          {(filterTariff || filterPm || filterRisk || filterPayment || filterOveruse) && (
            <button onClick={() => { setFilterTariff(''); setFilterPm(''); setFilterRisk(''); setFilterPayment(''); setFilterOveruse(false) }} className="text-xs text-surface-500 hover:text-surface-700 underline">
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* Projects grid */}
      {!projects?.length ? (
        <EmptyState title={t('projects.noProjects')} description={t('projects.createFirst')} action={
          canCreateProject && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button>
        } />
      ) : (
        <div key={page} className="animate-fade-in grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 items-stretch">
          {pagedProjects.map((p: any) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="card group hover:shadow-md transition-shadow cursor-pointer relative h-full flex flex-col"
            >
              {/* Ad status dot — SMM projects only */}
              {p.projectType === 'SMM' && (
                <span
                  title={p.hasActiveAd ? 'Реклама идёт' : 'Рекламы нет или завершена'}
                  className={clsx(
                    'absolute top-3 right-3 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-surface-800',
                    p.hasActiveAd
                      ? 'bg-emerald-500 animate-pulse shadow-[0_0_0_3px_rgba(16,185,129,0.2)]'
                      : 'bg-red-500',
                  )}
                />
              )}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: p.color || '#eff2ff' }}>
                    <FolderKanban size={18} style={{ color: p.color ? '#fff' : '#6B4FCF' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-surface-900 dark:text-surface-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 text-sm truncate" title={p.name}>{p.name}</h3>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <StatusBadge status={p.status} />
                      {p.projectType && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setProjectType(p.projectType) }}
                          title={`Показать только "${p.projectType}"`}
                          className="text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-900/50 px-1.5 py-0.5 rounded-full transition-colors"
                        >{p.projectType}</button>
                      )}
                    </div>
                  </div>
                </div>
                {isManagerPlus && (
                  <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); setEditProject(p) }} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded text-surface-500 dark:text-surface-400" title="Редактировать"><Edit size={13} /></button>
                    {canCreateProject && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); archiveMut.mutate(p.id) }} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded text-surface-500 dark:text-surface-400" title="Архив"><Archive size={13} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteId(p.id) }} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 dark:text-red-400" title="Удалить"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Метки: тариф / команда / без тарифа — в отдельной строке */}
              {((p as any).tariffNameSnapshot || (p as any).teamNameSnapshot || (p.projectType === 'SMM' && !(p as any).tariffId)) && (
                <div className="flex items-center gap-1 mb-3 flex-wrap">
                  {(p as any).tariffNameSnapshot && (
                    <span title={`Тариф: ${(p as any).tariffNameSnapshot}`}
                      className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded-full max-w-[120px] truncate">
                      🏷 {(p as any).tariffNameSnapshot}
                    </span>
                  )}
                  {(p as any).teamNameSnapshot && (
                    <span title={`Команда: ${(p as any).teamNameSnapshot}`}
                      className="text-[10px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5 rounded-full max-w-[120px] truncate">
                      👥 {(p as any).teamNameSnapshot}
                    </span>
                  )}
                  {p.projectType === 'SMM' && !(p as any).tariffId && (
                    <span title="SMM-проект без тарифа"
                      className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                      ⚠ без тарифа
                    </span>
                  )}
                </div>
              )}

              {p.description && <p className="text-xs text-surface-500 dark:text-surface-400 mb-3 line-clamp-2">{p.description}</p>}

              {/* Footer прибит к низу через mt-auto чтобы все карточки были одинаковой высоты */}
              <div className="mt-auto">
                <div className="mb-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-surface-500 dark:text-surface-400">{t('projects.progress')}</span>
                    <span className="font-medium text-surface-700 dark:text-surface-300">{p.progress}%</span>
                  </div>
                  <ProgressBar value={p.progress} />
                </div>

                <div className="flex items-center justify-between text-xs text-surface-500 dark:text-surface-400">
                <div className="flex items-center gap-1">
                  <Users size={12} />
                  <span>{p.members?.length || 0} {t('projects.members')}</span>
                </div>
                {p.endDate && (
                  <span>{t('projects.until')} {format(new Date(p.endDate), 'dd.MM.yyyy')}</span>
                )}
              </div>

              {p.members?.length > 0 && (
                <div className="flex -space-x-2 mt-3">
                  {p.members.slice(0, 5).map((m: any) => (
                    <div key={m.id} title={m.name}>
                      <Avatar name={m.name} src={m.avatar} size={24} />
                    </div>
                  ))}
                  {p.members.length > 5 && (
                    <div className="w-6 h-6 rounded-full bg-surface-200 dark:bg-surface-600 flex items-center justify-center text-xs text-surface-600 dark:text-surface-300 border-2 border-white dark:border-surface-800">
                      +{p.members.length - 5}
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} total={projects.length} pageSize={PAGE_SIZE} onChange={setPage} />

      {/* Create/Edit Modal */}
      <ProjectForm
        open={showCreate || !!editProject}
        onClose={() => { setShowCreate(false); setEditProject(null) }}
        onSubmit={data => {
          if (editProject) updateMut.mutate({ id: editProject.id, data })
          else createMut.mutate(data)
        }}
        initial={editProject}
        employees={employees || []}
        loading={createMut.isPending || updateMut.isPending}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId!)}
        title={t('projects.deleteConfirm')}
        message={t('projects.deleteMessage')}
        danger
      />
    </div>
  )
}

function ProjectForm({ open, onClose, onSubmit, initial, employees, loading }: ProjectFormProps) {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm()
  const { t } = useTranslation()
  const formUser = useAuthStore(s => s.user)
  const isFormHeadSMM = formUser?.role === 'head_smm' || formUser?.role === 'smm_director'
  const canCreateProject = ['admin', 'founder', 'co_founder', 'smm_director', 'head_smm'].includes(formUser?.role || '')
  // Финансовые поля и цены тарифа видят только основатель/сооснователь.
  // smm_director, PM, head_smm и admin — управляют проектом, но цены/деньги не видят.
  const canSeeFinance = ['founder', 'co_founder'].includes(formUser?.role || '')
  // Платежи (транши) — может управлять любой кто имеет доступ к форме проекта:
  // Admin, Founder, Co-founder, SMM Director, Head SMM, Project Manager.
  // Они вносят оплаты от клиента — финансовая информация по проекту, не зарплаты.
  const canManagePayments = ['admin', 'founder', 'co_founder', 'smm_director', 'head_smm', 'project_manager']
    .includes(formUser?.role || '')
  const [smmAnswers, setSmmAnswers] = useState<Record<string, string>>({})
  const [showSmmForm, setShowSmmForm] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [memberDropOpen, setMemberDropOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  // Транши оплаты проекта: массив элементов { id?, amount, paidAt, note }.
  // Элементы с id — уже существующие платежи (read-only, можно только удалить
  // из массива чтобы не отправить повторно; реальное удаление делается в
  // финансовом табе проекта). Без id — новые, будут созданы при сохранении.
  type Tranche = { id?: string; amount: string; paidAt: string; note: string }
  const [tranches, setTranches] = useState<Tranche[]>([])
  const dropRef = useRef<HTMLDivElement>(null)
  const projectType = watch('projectType')
  const tariffId = watch('tariffId')
  const teamId = watch('teamId')
  const showAllMembers = watch('showAllMembers') as unknown as boolean
  const discountValue = Number(watch('discount') || 0)
  const discountType = (watch('discountType') as string) || 'fixed'

  // Load active tariffs only when project is SMM (avoid unnecessary requests for other types)
  const { data: tariffs } = useQuery({
    queryKey: ['smm-tariffs', { isActive: true }],
    queryFn: () => smmTariffsApi.list({ isActive: true }),
    enabled: projectType === 'SMM',
  })

  // Загружаем команды — для селектора команды и фильтрации участников
  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(),
  })

  // Загружаем существующие платежи проекта (только при редактировании)
  const { data: existingPayments } = useQuery({
    queryKey: ['project-payments', initial?.id],
    queryFn: () => projectsApi.payments(initial!.id),
    enabled: !!initial?.id && canManagePayments,
  })

  // Когда платежи загрузились или сменилось редактируемое — заполняем массив.
  useEffect(() => {
    if (open && canManagePayments && initial?.id && Array.isArray(existingPayments)) {
      setTranches(existingPayments.map((p: any) => ({
        id: p.id,
        amount: String(p.amount ?? ''),
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString().split('T')[0] : '',
        note: p.note || '',
      })))
    } else if (open && !initial) {
      setTranches([])
    }
  }, [open, initial?.id, existingPayments, canManagePayments])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setMemberDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleMember = (userId: string) => {
    setSelectedMembers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  useEffect(() => {
    if (open) {
      if (initial) {
        reset({
          name: initial.name || '',
          description: initial.description || '',
          startDate: initial.startDate ? new Date(initial.startDate).toISOString().split('T')[0] : '',
          endDate: initial.endDate ? new Date(initial.endDate).toISOString().split('T')[0] : '',
          status: initial.status || 'planning',
          color: initial.color || '#6B4FCF',
          budget: initial.budget || '',
          projectType: initial.projectType || '',
          managerId: (initial as any).managerId || (initial as any).manager?.id || '',
          salesManagerId: (initial as any).salesManagerId || (initial as any).salesManager?.id || '',
          tariffId: (initial as any).tariffId || '',
          teamId: (initial as any).teamId || '',
          showAllMembers: false,
          discount: (initial as any).discount ?? '',
          discountType: (initial as any).discountType ?? 'fixed',
        })
        if (initial.smmData) setSmmAnswers(initial.smmData)
        setSelectedMembers(initial.members?.map((m: any) => m.id) || [])
      } else {
        reset({
          name: '', description: '', startDate: '', endDate: '',
          status: 'planning', color: '#6B4FCF', budget: '', projectType: isFormHeadSMM ? 'SMM' : '', managerId: '', salesManagerId: '',
          tariffId: '',
          teamId: '',
          showAllMembers: false,
          discount: '',
          discountType: 'fixed',
        })
        setSmmAnswers({})
        setShowSmmForm(false)
        setSelectedMembers([])
        setTranches([])
      }
      setMemberDropOpen(false)
      setMemberSearch('')
    }
  }, [open, initial, reset])

  useEffect(() => {
    if (projectType === 'SMM') setShowSmmForm(true)
    else setShowSmmForm(false)
  }, [projectType])

  const submit = (data: any) => {
    if (data.startDate && data.endDate && data.endDate <= data.startDate) {
      toast.error('Дата окончания должна быть позже даты начала')
      return
    }
    if (data.budget !== '' && data.budget !== undefined && Number(data.budget) < 0) {
      toast.error('Бюджет не может быть отрицательным')
      return
    }
    const formattedData: any = {
      name: data.name,
      description: data.description || undefined,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
      status: data.status,
      // color больше не редактируется через форму — берём из initial если есть
      color: initial?.color || undefined,
      budget: data.budget ? Number(data.budget) : undefined,
      projectType: data.projectType || undefined,
      managerId: data.managerId || undefined,
      memberIds: selectedMembers,
      salesManagerId: data.salesManagerId || undefined,
    }
    if (data.projectType === 'SMM' && Object.keys(smmAnswers).length > 0) {
      formattedData.smmData = smmAnswers
      // Client info from SMM answers
      formattedData.clientInfo = {
        name: smmAnswers.companyName || '',
        contactPerson: smmAnswers.contactPerson || '',
        phone: smmAnswers.contactPhone || '',
      }
    }
    // Tariff applies only to SMM projects. Empty string → undefined to detach.
    if (data.projectType === 'SMM' && data.tariffId) {
      formattedData.tariffId = data.tariffId
    } else if (initial && data.projectType === 'SMM') {
      // Allows explicit detach via empty select option
      formattedData.tariffId = data.tariffId || null
    }
    // Team — пустая строка означает "отвязать"
    if ('teamId' in data) {
      formattedData.teamId = data.teamId || null
    }
    // Скидка — отправляем только если поле непустое (на стороне finance role)
    if (canSeeFinance && data.discount !== undefined && data.discount !== '') {
      formattedData.discount = Number(data.discount) || 0
      formattedData.discountType = data.discountType === 'percent' ? 'percent' : 'fixed'
    }
    // Транши оплаты — для всех ролей с правом редактирования проекта.
    // Бэк различит существующие (по id) от новых (без id).
    if (canManagePayments && tranches.length > 0) {
      formattedData.initialPayments = tranches
        .filter(t => Number(t.amount) > 0 && t.paidAt)
        .map(t => ({
          id: t.id,
          amount: Number(t.amount),
          paidAt: t.paidAt,
          note: t.note?.trim() || undefined,
        }))
    }
    onSubmit(formattedData)
  }

  // Helpers для секции траншей
  const addTranche = () => setTranches(prev => [
    ...prev,
    { amount: '', paidAt: new Date().toISOString().split('T')[0], note: '' },
  ])
  const updateTranche = (idx: number, patch: Partial<{ amount: string; paidAt: string; note: string }>) => {
    setTranches(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t))
  }
  const removeTranche = (idx: number) => {
    setTranches(prev => prev.filter((_, i) => i !== idx))
  }

  const STATUS_OPTIONS = ['planning', 'in_progress', 'completed', 'on_hold']
  const PROJECT_TYPES = ['Web сайт', 'Дизайн', 'SMM']

  return (
    <Modal open={open} onClose={onClose} title={initial ? t('common.edit') + ' ' + t('projects.title').toLowerCase() : t('projects.newProject')} size="xl">
      <form onSubmit={handleSubmit(submit)} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">{t('projects.name')} *</label>
            <input {...register('name', { required: true })} className="input" placeholder={t('projects.name')} />
            {errors.name && <p className="text-xs text-red-500 mt-1">Обязательное поле</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('projects.description')}</label>
            <textarea {...register('description')} className="input resize-none" rows={3} />
          </div>

          {/* Project type */}
          <div className="sm:col-span-2">
            <label className="label">Тип проекта *</label>
            {isFormHeadSMM ? (
              <>
                <input type="hidden" {...register('projectType')} value="SMM" />
                <div className="input bg-surface-50 dark:bg-surface-700 cursor-not-allowed">SMM</div>
              </>
            ) : (
              <select {...register('projectType', { required: true })} className="input">
                <option value="">— Выбрать тип —</option>
                {PROJECT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
              </select>
            )}
            {errors.projectType && <p className="text-xs text-red-500 mt-1">Выберите тип проекта</p>}
          </div>

          {/* Менеджер проекта — head_smm показываем только для SMM-проектов */}
          <div className="sm:col-span-2">
            <label className="label">Менеджер проекта</label>
            <select {...register('managerId')} className="input">
              <option value="">— Не назначен —</option>
              {employees
                .filter((e: any) => {
                  const role = e.user?.role
                  if (role === 'head_smm' && projectType !== 'SMM') return false
                  return true
                })
                .map((e: any) => (
                  <option key={e.id} value={e.userId || e.id}>
                    {e.fullName || e.name}
                    {e.user?.role === 'head_smm' ? ' — Главный SMM' : ''}
                  </option>
                ))}
            </select>
            {projectType !== 'SMM' && (
              <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
                Главный SMM специалист может быть менеджером только SMM-проектов
              </p>
            )}
          </div>

          {/* Менеджер по продажам */}
          {canCreateProject && (
          <div className="sm:col-span-2">
            <label className="label">Менеджер по продажам</label>
            <select {...register('salesManagerId')} className="input">
              <option value="">— Не назначен —</option>
              {employees.map((e: any) => (
                <option key={e.userId || e.id} value={e.userId || e.id}>
                  {e.fullName || e.name}{e.position ? ` — ${e.position}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">Получит напоминание об оплате через 2 недели после создания проекта</p>
          </div>
          )}

          {/* Команда — фильтрует список участников проекта */}
          <div className="sm:col-span-2">
            <label className="label">Команда</label>
            <select {...register('teamId')} className="input">
              <option value="">— Без команды —</option>
              {(teams || []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}{t.memberCount ? ` (${t.memberCount})` : ''}</option>
              ))}
            </select>
            {teamId ? (
              <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-1">
                👥 В список участников ниже попадают только сотрудники из этой команды.
              </p>
            ) : (
              <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
                Если команда не выбрана — в списке доступны все сотрудники.
              </p>
            )}
          </div>

          {/* SMM-тариф (только для SMM-проектов).
              Цена показывается только основателю/сооснователю. */}
          {projectType === 'SMM' && (
            <div className="sm:col-span-2">
              <label className="label">SMM-тариф</label>
              <select {...register('tariffId')} className="input">
                <option value="">— Без тарифа —</option>
                {(tariffs || []).map((t: any) => {
                  // Краткое описание deliverables для НЕ-финансовых ролей
                  const parts: string[] = []
                  if (t.storiesPerMonth > 0) parts.push(`${t.storiesPerMonth} stories`)
                  if (t.reelsPerMonth > 0) parts.push(`${t.reelsPerMonth} reels`)
                  if (t.postsPerMonth > 0) parts.push(`${t.postsPerMonth} posts`)
                  if (t.designsPerMonth > 0) parts.push(`${t.designsPerMonth} дизайнов`)
                  const deliverables = parts.length > 0 ? ` — ${parts.join(', ')}` : ''
                  return (
                    <option key={t.id} value={t.id}>
                      {canSeeFinance
                        ? `${t.name} — ${Number(t.monthlyPrice).toLocaleString('ru-RU')} сомони/мес`
                        : `${t.name}${deliverables}`}
                    </option>
                  )
                })}
              </select>
              {/* Скидка — только для основателя/сооснователя.
                  Тип (фиксированная/процентная) + значение + предварительный расчёт. */}
              {canSeeFinance && tariffId && (() => {
                const selectedTariff = (tariffs || []).find((tt: any) => tt.id === tariffId)
                const subtotal = Number(selectedTariff?.monthlyPrice || 0)
                const computedDiscount = discountType === 'percent'
                  ? (subtotal * Math.min(100, Math.max(0, discountValue))) / 100
                  : Math.max(0, discountValue)
                const finalTotal = Math.max(0, subtotal - computedDiscount)
                return (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="label text-xs">Скидка</label>
                        <select {...register('discountType')} className="input">
                          <option value="fixed">Фиксированная</option>
                          <option value="percent">Процентная</option>
                        </select>
                      </div>
                      <div>
                        <label className="label text-xs">Значение скидки</label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={discountType === 'percent' ? '100' : undefined}
                            {...register('discount')}
                            className="input pr-12"
                            placeholder="0"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-surface-500 dark:text-surface-400 pointer-events-none">
                            {discountType === 'percent' ? '%' : 'TJS'}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Предварительный расчёт */}
                    {subtotal > 0 && (
                      <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-primary-600 dark:text-primary-400 text-sm">ⓘ</span>
                          <span className="font-semibold text-primary-700 dark:text-primary-300 text-xs">Предварительный расчёт</span>
                        </div>
                        <div className="space-y-1 text-xs text-surface-700 dark:text-surface-300">
                          <div className="flex justify-between">
                            <span>Подытог:</span>
                            <span className="font-semibold">{subtotal.toLocaleString('ru-RU')} TJS</span>
                          </div>
                          {computedDiscount > 0 && (
                            <div className="flex justify-between text-amber-600 dark:text-amber-400">
                              <span>Скидка{discountType === 'percent' ? ` (${discountValue}%)` : ''}:</span>
                              <span className="font-semibold">−{computedDiscount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TJS</span>
                            </div>
                          )}
                          <div className="flex justify-between text-emerald-600 dark:text-emerald-400 pt-1 border-t border-primary-200/50 dark:border-primary-800/50">
                            <span className="font-semibold">Итого со скидкой:</span>
                            <span className="font-bold">{finalTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TJS</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] text-surface-500 dark:text-surface-400">
                      Скидка применяется к стоимости тарифа в аналитике (выручка, маржа, остаток к оплате).
                    </p>
                  </div>
                )
              })()}
              {tariffId && !initial && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                  ✨ После создания проекта будет автоматически сгенерирован контент-план из тарифа
                </p>
              )}
              {!tariffId && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  ⚠️ Без тарифа SMM-проект попадёт в риск-зону. Выберите тариф или создайте новый в разделе «SMM-тарифы».
                </p>
              )}
            </div>
          )}

          {/* SMM Questionnaire — appears right after type select */}
          {showSmmForm && (
            <div className="sm:col-span-2 border border-primary-300 dark:border-primary-700 rounded-xl p-4 bg-primary-50 dark:bg-primary-900/10 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h3 className="font-semibold text-primary-700 dark:text-primary-300 text-sm">Анкета SMM-проекта</h3>
                <span className="text-xs text-primary-600 dark:text-primary-400">Заполните для лучшего понимания проекта</span>
              </div>
              <div className="space-y-3">
                {SMM_QUESTIONS.map(q => (
                  <div key={q.key}>
                    <label className="text-xs font-medium text-surface-700 dark:text-surface-300 block mb-1">{q.label}</label>
                    {q.type === 'textarea' ? (
                      <textarea
                        value={smmAnswers[q.key] || ''}
                        onChange={e => setSmmAnswers(prev => ({ ...prev, [q.key]: e.target.value }))}
                        className="input resize-none text-sm"
                        rows={2}
                        placeholder="Введите ответ..."
                      />
                    ) : q.type === 'radio' ? (
                      <div className="flex gap-4">
                        {q.options?.map(opt => (
                          <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name={q.key}
                              value={opt}
                              checked={smmAnswers[q.key] === opt}
                              onChange={() => setSmmAnswers(prev => ({ ...prev, [q.key]: opt }))}
                              className="w-3.5 h-3.5 text-primary-600"
                            />
                            <span className="text-xs text-surface-700 dark:text-surface-300">{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={smmAnswers[q.key] || ''}
                        onChange={e => setSmmAnswers(prev => ({ ...prev, [q.key]: e.target.value }))}
                        className="input text-sm"
                        placeholder="Введите ответ..."
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="label">{t('projects.startDate')} *</label>
            <input type="date" {...register('startDate', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">{t('projects.endDate')} *</label>
            <input type="date" {...register('endDate', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">{t('common.status')} *</label>
            <select {...register('status', { required: true })} className="input">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
            </select>
          </div>

          {showSmmForm && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="label">Историй в день</label>
                <input
                  type="number" min={0}
                  value={smmAnswers.storiesPerDay || ''}
                  onChange={e => setSmmAnswers(prev => ({ ...prev, storiesPerDay: e.target.value }))}
                  className="input" placeholder="0"
                />
              </div>
              <div>
                <label className="label">Макетов в месяц</label>
                <input
                  type="number" min={0}
                  value={smmAnswers.layoutsPerMonth || ''}
                  onChange={e => setSmmAnswers(prev => ({ ...prev, layoutsPerMonth: e.target.value }))}
                  className="input" placeholder="0"
                />
              </div>
            </div>
          )}

          {/* Участники проекта */}
          <div className="sm:col-span-2" ref={dropRef}>
            <label className="label">Участники проекта</label>

            {/* Trigger */}
            <div
              onClick={() => setMemberDropOpen(v => !v)}
              className="input flex items-center justify-between cursor-pointer select-none min-h-[42px] flex-wrap gap-1.5"
            >
              {selectedMembers.length === 0 ? (
                <span className="text-surface-400 text-sm">Выбрать участников...</span>
              ) : (
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {selectedMembers.map(uid => {
                    const emp = employees.find((e: any) => (e.userId || e.id) === uid)
                    if (!emp) return null
                    return (
                      <span
                        key={uid}
                        className="flex items-center gap-1 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs px-2 py-0.5 rounded-full"
                      >
                        {emp.fullName || emp.name}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); toggleMember(uid) }}
                          className="hover:text-primary-900 dark:hover:text-primary-100"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
              <ChevronDown size={15} className={clsx('text-surface-400 shrink-0 transition-transform', memberDropOpen && 'rotate-180')} />
            </div>

            {/* Dropdown */}
            {memberDropOpen && (
              <div className="relative z-50">
                <div className="absolute top-1 left-0 right-0 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-xl shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-surface-100 dark:border-surface-700">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400" />
                      <input
                        autoFocus
                        value={memberSearch}
                        onChange={e => setMemberSearch(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Поиск..."
                        className="input py-1.5 pl-8 text-sm"
                      />
                    </div>
                  </div>
                  {/* Wave: фильтрация по команде + escape-hatch «показать всех» */}
                  {teamId && (
                    <div className="px-3 py-1.5 bg-surface-50 dark:bg-surface-900/40 border-b border-surface-100 dark:border-surface-700">
                      <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-surface-600 dark:text-surface-400">
                        <input type="checkbox" {...register('showAllMembers')} />
                        Показать сотрудников из других команд тоже
                      </label>
                    </div>
                  )}
                  <div className="max-h-44 overflow-y-auto">
                    {employees
                      .filter((e: any) => {
                        const name = (e.fullName || e.name || '').toLowerCase()
                        if (memberSearch && !name.includes(memberSearch.toLowerCase())) return false
                        // Если выбрана команда и не включён «показать всех» — фильтруем
                        if (teamId && !showAllMembers) {
                          const eid = e.userId || e.id
                          const isAlreadySelected = selectedMembers.includes(eid)
                          // Уже выбранных не прячем (на случай редактирования старого проекта)
                          if (isAlreadySelected) return true
                          return e.teamId === teamId
                        }
                        return true
                      })
                      .map((e: any) => {
                        const uid = e.userId || e.id
                        const selected = selectedMembers.includes(uid)
                        return (
                          <div
                            key={e.id}
                            onClick={() => toggleMember(uid)}
                            className={clsx(
                              'flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors',
                              selected
                                ? 'bg-primary-50 dark:bg-primary-900/20'
                                : 'hover:bg-surface-50 dark:hover:bg-surface-700'
                            )}
                          >
                            <div className={clsx(
                              'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                              selected
                                ? 'bg-primary-600 border-primary-600'
                                : 'border-surface-300 dark:border-surface-500'
                            )}>
                              {selected && <Check size={10} className="text-white" strokeWidth={3} />}
                            </div>
                            <Avatar name={e.fullName || e.name} src={e.avatar} size={28} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{e.fullName || e.name}</p>
                              {e.position && <p className="text-xs text-surface-400 truncate">{e.position}</p>}
                            </div>
                          </div>
                        )
                      })}
                    {employees.length === 0 && (
                      <p className="text-xs text-surface-400 text-center py-4">Нет сотрудников</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {selectedMembers.length > 0 && (
              <p className="text-xs text-primary-600 dark:text-primary-400 mt-1.5">
                Выбрано: {selectedMembers.length} — им придёт email уведомление
              </p>
            )}
          </div>
          {/* Поле "Цвет" убрано из формы — оно не несло смысловой нагрузки,
              перегружало форму и сбивало пользователей. Дефолтный цвет
              проекта проставляется на бэке. */}
          {/* Поле бюджета убрано из формы создания/редактирования —
              бюджет правится inline-карандашом на странице проекта. */}

          {/* Транши оплаты — для всех ролей с правом редактирования проекта:
              Admin, Founder, Co-founder, SMM Director, Head SMM, PM.
              Каждый транш = сумма + дата + комментарий. Сумма суммируется
              в paidAmount проекта. */}
          {canManagePayments && (
            <div className="sm:col-span-2 border border-emerald-300/60 dark:border-emerald-800/60 rounded-xl p-4 bg-emerald-50/50 dark:bg-emerald-900/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Banknote size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <h3 className="font-semibold text-emerald-700 dark:text-emerald-300 text-sm">
                    Платежи (транши)
                  </h3>
                  {tranches.length > 0 && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                      · {tranches.length} {tranches.length === 1 ? 'платёж' : 'платежа'}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={addTranche}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                >
                  <Plus size={13} /> Добавить
                </button>
              </div>

              {tranches.length === 0 ? (
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  Нет платежей. Нажмите «Добавить», чтобы внести первый транш с датой.
                </p>
              ) : (
                <div className="space-y-2">
                  {tranches.map((tr, idx) => (
                    <div
                      key={tr.id || `new-${idx}`}
                      className="grid grid-cols-12 gap-2 items-start p-2 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
                    >
                      <div className="col-span-12 sm:col-span-4">
                        <label className="text-[10px] uppercase font-semibold text-surface-500 dark:text-surface-400">
                          Транш #{idx + 1} (сомони)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tr.amount}
                          onChange={e => updateTranche(idx, { amount: e.target.value })}
                          disabled={!!tr.id}
                          placeholder="0"
                          className={clsx('input text-sm', tr.id && 'bg-surface-50 dark:bg-surface-700 cursor-not-allowed')}
                        />
                      </div>
                      <div className="col-span-12 sm:col-span-3">
                        <label className="text-[10px] uppercase font-semibold text-surface-500 dark:text-surface-400">
                          <CalIcon size={10} className="inline mr-0.5" />
                          Дата
                        </label>
                        <input
                          type="date"
                          value={tr.paidAt}
                          onChange={e => updateTranche(idx, { paidAt: e.target.value })}
                          disabled={!!tr.id}
                          className={clsx('input text-sm', tr.id && 'bg-surface-50 dark:bg-surface-700 cursor-not-allowed')}
                        />
                      </div>
                      <div className="col-span-10 sm:col-span-4">
                        <label className="text-[10px] uppercase font-semibold text-surface-500 dark:text-surface-400">
                          Комментарий
                        </label>
                        <input
                          type="text"
                          value={tr.note}
                          onChange={e => updateTranche(idx, { note: e.target.value })}
                          disabled={!!tr.id}
                          placeholder="Аванс, окончательный расчёт..."
                          className={clsx('input text-sm', tr.id && 'bg-surface-50 dark:bg-surface-700 cursor-not-allowed')}
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => removeTranche(idx)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          title={tr.id ? 'Скрыть из формы (не удалит платёж из БД)' : 'Удалить'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {tr.id && (
                        <div className="col-span-12 text-[10px] text-surface-400 dark:text-surface-500 italic">
                          Это уже сохранённый платёж — он не редактируется в форме. Для изменений используйте финансовый раздел проекта.
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Итог */}
                  <div className="flex items-center justify-between px-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60">
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Итого:</span>
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                      {tranches.reduce((sum, t) => sum + (Number(t.amount) || 0), 0).toLocaleString('ru-RU')} TJS
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="btn-primary min-w-[120px] justify-center">
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
    </Modal>
  )
}
