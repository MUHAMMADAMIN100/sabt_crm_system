import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { projectsApi, employeesApi, filesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { Modal, StatusBadge, EmptyState, PageLoader, ProgressBar, ConfirmDialog, Avatar, Pagination } from '@/components/ui'
import { Plus, Search, FolderKanban, Archive, Trash2, Edit, Users, ChevronDown, X, Check } from 'lucide-react'
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

export default function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 9
  const [showCreate, setShowCreate] = useState(false)
  const [editProject, setEditProject] = useState<any>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'founder', 'project_manager'].includes(user?.role || '')
  const qc = useQueryClient()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: allProjects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, status])

  const projects = allProjects?.filter((p: any) => {
    const matchesSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = !status || p.status === status
    return matchesSearch && matchesStatus
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
      const project = await projectsApi.create(data)
      if (data.projectType === 'SMM' && data.smmData && Object.keys(data.smmData).length > 0) {
        const lines = SMM_QUESTIONS.map(q => `${q.label}:\n${data.smmData[q.key] || '—'}`).join('\n\n')
        const content = `SMM-АНКЕТА\nПроект: ${project.name}\nДата: ${new Date().toLocaleDateString('ru-RU')}\n${'─'.repeat(40)}\n\n${lines}`
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const file = new File([blob], `SMM_Анкета_${project.name}.txt`, { type: 'text/plain' })
        await filesApi.upload(file, project.id).catch(() => toast.error('Не удалось сохранить SMM-анкету как файл'))
      }
      return project
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success(t('projects.updated')) },
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
        {isManagerPlus && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> <span className="hidden sm:inline">{t('projects.newProject')}</span>
          </button>
        )}
      </div>

      {/* Filters */}
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

      {/* Projects grid */}
      {!projects?.length ? (
        <EmptyState title={t('projects.noProjects')} description={t('projects.createFirst')} action={
          isManagerPlus && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button>
        } />
      ) : (
        <div key={page} className="animate-fade-in grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pagedProjects.map((p: any) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="card group hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: p.color || '#eff2ff' }}>
                    <FolderKanban size={18} style={{ color: p.color ? '#fff' : '#6B4FCF' }} />
                  </div>
                  <div>
                    <span className="font-semibold text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 text-sm">{p.name}</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <StatusBadge status={p.status} />
                      {p.projectType && (
                        <span className="text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-1.5 py-0.5 rounded-full">{p.projectType}</span>
                      )}
                    </div>
                  </div>
                </div>
                {isManagerPlus && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); setEditProject(p) }} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-400"><Edit size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); archiveMut.mutate(p.id) }} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-400"><Archive size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteId(p.id) }} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500 dark:text-red-400"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>

              {p.description && <p className="text-xs text-surface-500 dark:text-surface-400 mb-3 line-clamp-2">{p.description}</p>}

              <div className="mb-3">
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
  const [smmAnswers, setSmmAnswers] = useState<Record<string, string>>({})
  const [showSmmForm, setShowSmmForm] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [memberDropOpen, setMemberDropOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)
  const projectType = watch('projectType')

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
          managerId: initial.managerId || '',
        })
        if (initial.smmData) setSmmAnswers(initial.smmData)
        setSelectedMembers(initial.members?.map((m: any) => m.id) || [])
      } else {
        reset({
          name: '', description: '', startDate: '', endDate: '',
          status: 'planning', color: '#6B4FCF', budget: '', projectType: '', managerId: '',
        })
        setSmmAnswers({})
        setShowSmmForm(false)
        setSelectedMembers([])
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
      color: data.color,
      budget: data.budget ? Number(data.budget) : undefined,
      projectType: data.projectType || undefined,
      managerId: data.managerId || undefined,
      memberIds: selectedMembers,
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
    onSubmit(formattedData)
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
            <select {...register('projectType', { required: true })} className="input">
              <option value="">— Выбрать тип —</option>
              {PROJECT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>
            {errors.projectType && <p className="text-xs text-red-500 mt-1">Выберите тип проекта</p>}
          </div>

          {/* Менеджер проекта */}
          <div className="sm:col-span-2">
            <label className="label">Менеджер проекта</label>
            <select {...register('managerId')} className="input">
              <option value="">— Не назначен —</option>
              {employees.map((e: any) => (
                <option key={e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>
              ))}
            </select>
          </div>

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
                  <div className="max-h-44 overflow-y-auto">
                    {employees
                      .filter((e: any) => {
                        const name = (e.fullName || e.name || '').toLowerCase()
                        return !memberSearch || name.includes(memberSearch.toLowerCase())
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
          <div>
            <label className="label">{t('projects.color')} *</label>
            <input type="color" {...register('color')} className="input h-10 p-1 cursor-pointer" />
          </div>
          <div>
            <label className="label">{t('projects.budget')}</label>
            <input type="number" {...register('budget', { min: 0 })} className="input" placeholder="0" min={0} />
          </div>
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
