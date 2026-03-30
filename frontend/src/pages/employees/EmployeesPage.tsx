import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState, Modal, Avatar, ConfirmDialog, Pagination } from '@/components/ui'
import { Plus, Search, Trash2, Edit, Mail, Phone, List, LayoutGrid, ShieldCheck, Send } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12
  const [showCreate, setShowCreate] = useState(false)
  const [editEmp, setEditEmp] = useState<any>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: allEmployees, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })
  const allPositions = [...new Set(allEmployees?.map((e: any) => e.position).filter(Boolean) || [])] as string[]

  const employees = allEmployees?.filter((emp: any) => {
    const matchesSearch = !search || emp.fullName?.toLowerCase().includes(search.toLowerCase()) || emp.email?.toLowerCase().includes(search.toLowerCase()) || emp.position?.toLowerCase().includes(search.toLowerCase())
    const matchesPosition = !position || emp.position === position
    return matchesSearch && matchesPosition
  }) || []

  const pagedEmployees = employees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const getTelegramUrl = (tg: string) => {
    const clean = tg.replace(/https?:\/\/(www\.)?t\.me\//g, '').replace(/^@/, '')
    return `https://t.me/${clean}`
  }

  const createMut = useMutation({ mutationFn: employeesApi.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setShowCreate(false); toast.success(t('employees.added')) } })
  const updateMut = useMutation({ mutationFn: ({ id, data }: any) => employeesApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setEditEmp(null); toast.success(t('employees.saved')) } })
  const deleteMut = useMutation({ mutationFn: employeesApi.remove, onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success(t('employees.deleted')) } })
  const toggleSubAdmin = useMutation({ mutationFn: employeesApi.toggleSubAdmin, onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success(t('common.updated')) } })

  if (isLoading) return <PageLoader />

  const getInitials = (name: string) => name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('employees.title')}</h1>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-surface-100 dark:bg-surface-700 p-1 rounded-xl">
            <button onClick={() => setView('cards')} className={clsx('p-1.5 rounded-lg', view==='cards' ? 'bg-white dark:bg-surface-600 shadow-sm':'text-surface-500 dark:text-surface-400')}><LayoutGrid size={16}/></button>
            <button onClick={() => setView('table')} className={clsx('p-1.5 rounded-lg', view==='table' ? 'bg-white dark:bg-surface-600 shadow-sm':'text-surface-500 dark:text-surface-400')}><List size={16}/></button>
          </div>
          {isAdmin && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> {t('employees.add')}</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('employees.searchPlaceholder')} className="input pl-9" />
        </div>
        <select value={position} onChange={e => setPosition(e.target.value)} className="input w-44">
          <option value="">Все должности</option>
          {allPositions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {!employees?.length ? <EmptyState title={t('employees.noEmployees')} /> : view === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {pagedEmployees.map((emp: any) => (
            <div key={emp.id} onClick={() => navigate(`/employees/${emp.id}`)} className="card group cursor-pointer hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={emp.fullName} src={emp.avatar} size={44} />
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-surface-900 dark:text-surface-100">{emp.fullName}</span>
                      {emp.isSubAdmin && <ShieldCheck size={14} className="text-primary-500" aria-label="Помощник администратора" />}
                    </div>
                    <p className="text-sm text-surface-500 dark:text-surface-400">{emp.position}</p>
                    <span className="text-xs bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 px-2 py-0.5 rounded-full">{emp.department}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => toggleSubAdmin.mutate(emp.id)} className={clsx('p-1.5 rounded-lg', emp.isSubAdmin ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-surface-100 dark:hover:bg-surface-700')} title="Помощник админа">
                      <ShieldCheck size={14} className={emp.isSubAdmin ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400'} />
                    </button>
                    <button onClick={() => setEditEmp(emp)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"><Edit size={14} className="text-surface-500 dark:text-surface-400" /></button>
                    <button onClick={() => setDeleteId(emp.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400"><Mail size={11} /><span>{emp.email}</span></div>
                {emp.phone && <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400"><Phone size={11} /><span>{emp.phone}</span></div>}
                {emp.telegram && (
                  <a href={getTelegramUrl(emp.telegram)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="flex items-center gap-2 text-xs text-primary-500 hover:underline"><Send size={11} /><span>{emp.telegram}</span></a>
                )}
                {emp.instagram && (
                  <a href={`https://instagram.com/${emp.instagram.replace('@','')}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="flex items-center gap-2 text-xs text-pink-500 hover:underline"><AtSignIcon /><span>{emp.instagram}</span></a>
                )}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-50 dark:border-surface-700">
                <span className={clsx('badge', emp.status==='active' ? 'status-done' : 'status-cancelled')}>{emp.status==='active' ? t('common.active') : t('common.inactive')}</span>
                <span className="text-xs text-surface-400 dark:text-surface-500">{format(new Date(emp.hireDate), 'dd.MM.yyyy')}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100 dark:border-surface-700">
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('employees.fullName')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden md:table-cell">{t('employees.position')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden lg:table-cell">{t('employees.department')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden lg:table-cell">Telegram</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('common.status')}</th>
                {isAdmin && <th className="text-right text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {pagedEmployees.map((emp: any) => (
                <tr key={emp.id} onClick={() => navigate(`/employees/${emp.id}`)} className="border-b border-surface-50 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/50 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={emp.fullName} size={32} />
                      <div>
                        <span className="text-sm font-medium text-surface-900 dark:text-surface-100">{emp.fullName}</span>
                        {emp.isSubAdmin && <ShieldCheck size={12} className="inline ml-1 text-primary-500" />}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-sm text-surface-600 dark:text-surface-300">{emp.position}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-sm text-surface-500 dark:text-surface-400">{emp.department}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {emp.telegram && <a href={getTelegramUrl(emp.telegram)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="text-xs text-primary-500 hover:underline">{emp.telegram}</a>}
                  </td>
                  <td className="px-4 py-3"><span className={clsx('badge', emp.status==='active' ? 'status-done' : 'status-cancelled')}>{emp.status==='active' ? t('common.active') : t('common.inactive')}</span></td>
                  {isAdmin && (
                    <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => toggleSubAdmin.mutate(emp.id)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg" title="Помощник админа">
                          <ShieldCheck size={14} className={emp.isSubAdmin ? 'text-primary-600' : 'text-surface-400'} />
                        </button>
                        <button onClick={() => setEditEmp(emp)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"><Edit size={14} className="text-surface-500" /></button>
                        <button onClick={() => setDeleteId(emp.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} total={employees.length} pageSize={PAGE_SIZE} onChange={setPage} />

      <EmployeeForm open={showCreate || !!editEmp} initial={editEmp}
        onClose={() => { setShowCreate(false); setEditEmp(null) }}
        onSubmit={data => editEmp ? updateMut.mutate({ id: editEmp.id, data }) : createMut.mutate(data)}
        loading={createMut.isPending || updateMut.isPending} />
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId!)} title={t('common.delete') + '?'} danger />
    </div>
  )
}

function AtSignIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg> }

interface EmployeeFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
  initial: import('@/types/entities').Employee | null
  loading: boolean
}

function EmployeeForm({ open, onClose, onSubmit, initial, loading }: EmployeeFormProps) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm()
  const { t } = useTranslation()

  useEffect(() => {
    if (initial) {
      reset({ fullName: initial.fullName||'', position: initial.position||'', department: initial.department||'',
        email: initial.email||'', phone: initial.phone||'', telegram: initial.telegram||'', instagram: initial.instagram||'',
        hireDate: initial.hireDate ? new Date(initial.hireDate).toISOString().split('T')[0] : '', status: initial.status||'active', bio: initial.bio||'' })
    } else {
      reset({ fullName:'', position:'', department:'', email:'', phone:'', telegram:'', instagram:'', hireDate:'', status:'active', bio:'' })
    }
  }, [initial, reset])

  const submit = (data: any) => {
    onSubmit({ fullName: data.fullName, position: data.position, department: data.department,
      email: data.email, phone: data.phone||undefined, telegram: data.telegram||undefined,
      instagram: data.instagram||undefined, hireDate: data.hireDate||undefined, status: data.status, bio: data.bio||undefined })
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? t('common.edit') : t('employees.add')} size="lg">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">{t('employees.fullName')} *</label>
            <input {...register('fullName', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">{t('employees.position')} *</label>
            <input {...register('position', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">{t('employees.department')} *</label>
            <input {...register('department', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">{t('employees.email')} *</label>
            <input type="email" {...register('email', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">{t('employees.phone')}</label>
            <input {...register('phone')} className="input" placeholder="+992..." />
          </div>
          <div>
            <label className="label">Telegram</label>
            <input {...register('telegram')} className="input" placeholder="@username" />
          </div>
          <div>
            <label className="label">Instagram</label>
            <input {...register('instagram')} className="input" placeholder="@username" />
          </div>
          <div>
            <label className="label">{t('employees.hireDate')}</label>
            <input type="date" {...register('hireDate')} className="input" />
          </div>
          <div>
            <label className="label">{t('common.status')}</label>
            <select {...register('status')} className="input">
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="btn-primary">{initial ? t('common.save') : t('employees.add')}</button>
        </div>
      </form>
    </Modal>
  )
}
