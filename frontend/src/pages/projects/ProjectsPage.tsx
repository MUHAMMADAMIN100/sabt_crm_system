import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { projectsApi, employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { Modal, StatusBadge, EmptyState, PageLoader, ProgressBar, ConfirmDialog, Avatar } from '@/components/ui'
import { Plus, Search, FolderKanban, Archive, Trash2, Edit, Users } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editProject, setEditProject] = useState<any>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)
  const isManagerPlus = ['admin', 'manager'].includes(user?.role || '')
  const qc = useQueryClient()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: allProjects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  const projects = allProjects?.filter((p: any) => {
    const matchesSearch = !search || 
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = !status || p.status === status
    return matchesSearch && matchesStatus
  }) || []

  const STATUSES = [
    { value: '', label: t('statuses.all') },
    { value: 'planning', label: t('statuses.planning') },
    { value: 'in_progress', label: t('statuses.in_progress') },
    { value: 'completed', label: t('statuses.completed') },
  ]

  const createMut = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setShowCreate(false); toast.success(t('projects.created')) },
    onError: () => toast.error(t('common.error')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => projectsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setEditProject(null); toast.success(t('projects.updated')) },
  })

  const archiveMut = useMutation({
    mutationFn: projectsApi.archive,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success(t('projects.archived')) },
  })

  const deleteMut = useMutation({
    mutationFn: projectsApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success(t('projects.deleted')) },
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('projects.title')}</h1>
        {isManagerPlus && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> {t('projects.newProject')}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('projects.searchPlaceholder')} className="input pl-9"
          />
        </div>
        <div className="flex gap-1">
          {STATUSES.map(s => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={clsx('btn text-xs', status === s.value ? 'btn-primary' : 'btn-secondary')}
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* Projects grid - fully clickable cards */}
      {!projects?.length ? (
        <EmptyState title={t('projects.noProjects')} description={t('projects.createFirst')} action={
          isManagerPlus && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} />{t('common.create')}</button>
        } />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p: any) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="card group hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: p.color || '#eff2ff' }}>
                    <FolderKanban size={18} style={{ color: p.color ? '#fff' : '#4f6ef7' }} />
                  </div>
                  <div>
                    <span className="font-semibold text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400 text-sm">{p.name}</span>
                    <div className="mt-0.5"><StatusBadge status={p.status} /></div>
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

function ProjectForm({ open, onClose, onSubmit, initial, employees, loading }: any) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: initial || {},
  })
  const { t } = useTranslation()

  useEffect(() => {
    if (initial) {
      reset({
        ...initial,
        startDate: initial.startDate ? new Date(initial.startDate).toISOString().split('T')[0] : '',
        endDate: initial.endDate ? new Date(initial.endDate).toISOString().split('T')[0] : '',
        managerId: initial.managerId || '',
        budget: initial.budget || '',
      })
    } else {
      reset({
        name: '', description: '', startDate: '', endDate: '',
        status: 'planning', managerId: '', color: '#4f6ef7', budget: '',
      })
    }
  }, [initial, reset])

  const submit = (data: any) => {
    const formattedData = {
      name: data.name,
      description: data.description || undefined,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
      status: data.status,
      managerId: data.managerId || undefined,
      color: data.color,
      budget: data.budget ? Number(data.budget) : undefined,
    }
    onSubmit(formattedData)
  }

  const STATUS_OPTIONS = ['planning', 'in_progress', 'completed', 'on_hold']

  return (
    <Modal open={open} onClose={onClose} title={initial ? t('common.edit') + ' ' + t('projects.title').toLowerCase() : t('projects.newProject')} size="lg">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">{t('projects.name')} *</label>
            <input {...register('name', { required: true })} className="input" placeholder={t('projects.name')} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{t('projects.name')} обязательно</p>}
          </div>
          <div className="col-span-2">
            <label className="label">{t('projects.description')} *</label>
            <textarea {...register('description', { required: true })} className="input resize-none" rows={3} placeholder={t('projects.description') + '...'} />
            {errors.description && <p className="text-xs text-red-500 mt-1">{t('projects.description')} обязательно</p>}
          </div>
          <div>
            <label className="label">{t('projects.startDate')} *</label>
            <input type="date" {...register('startDate', { required: true })} className="input" />
            {errors.startDate && <p className="text-xs text-red-500 mt-1">{t('projects.startDate')} обязательно</p>}
          </div>
          <div>
            <label className="label">{t('projects.endDate')} *</label>
            <input type="date" {...register('endDate', { required: true })} className="input" />
            {errors.endDate && <p className="text-xs text-red-500 mt-1">{t('projects.endDate')} обязательно</p>}
          </div>
          <div>
            <label className="label">{t('common.status')} *</label>
            <select {...register('status', { required: true })} className="input">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('projects.manager')} *</label>
            <select {...register('managerId', { required: true })} className="input">
              <option value="">{t('common.selectOption')}</option>
              {employees.map((e: any) => <option key={e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>)}
            </select>
            {errors.managerId && <p className="text-xs text-red-500 mt-1">{t('projects.manager')} обязательно</p>}
          </div>
          <div>
            <label className="label">{t('projects.color')} *</label>
            <input type="color" {...register('color', { required: true })} className="input h-10 p-1 cursor-pointer" />
          </div>
          <div>
            <label className="label">{t('projects.budget')} *</label>
            <input type="number" {...register('budget', { required: true })} className="input" placeholder="0" />
            {errors.budget && <p className="text-xs text-red-500 mt-1">{t('projects.budget')} обязательно</p>}
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="btn-primary">
            {initial ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
