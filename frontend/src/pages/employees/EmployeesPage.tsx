import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { employeesApi, usersApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState, Modal, Avatar, ConfirmDialog, Pagination } from '@/components/ui'
import { Plus, Search, Trash2, Edit, Mail, Phone, List, LayoutGrid, ShieldCheck, Send, Lock, Unlock, Ban, Key, Copy, Check } from 'lucide-react'
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
  const [blockEmp, setBlockEmp] = useState<any>(null)
  const [blockReason, setBlockReason] = useState('')
  const [unblockId, setUnblockId] = useState<string | null>(null)
  const [resetPwdEmp, setResetPwdEmp] = useState<any>(null)
  const [customPwd, setCustomPwd] = useState('')
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(null)
  const [pwdCopied, setPwdCopied] = useState(false)
  const user = useAuthStore(s => s.user)
  const canManage = user?.role === 'admin' || user?.role === 'founder' || user?.role === 'co_founder'
  const isAdmin = canManage  // alias for backward compat
  const isFounderUser = user?.role === 'founder'
  const canEditEmployee = (emp: any) => {
    if (isFounderUser) return true
    // Admin cannot edit founder/co-founder employees
    const pos = emp.position?.toLowerCase() || ''
    const empRole = emp.user?.role || ''
    if (['founder', 'co_founder'].includes(empRole) || pos === 'основатель' || pos === 'сооснователь') return false
    return canManage
  }
  const qc = useQueryClient()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: allEmployees, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })
  // Canonical list of positions — mirrors the edit form so the filter always
  // lists every role even if nobody currently holds it. Custom positions
  // entered through free-text elsewhere are merged in.
  const POSITION_CANON = [
    'Основатель',
    'Сооснователь',
    'Администратор',
    'Проект-менеджер',
    'Главный SMM специалист',
    'SMM специалист',
    'Дизайнер',
    'Таргетолог',
    'Маркетолог',
    'Менеджер по продажам',
    'Разработчик',
  ]
  const existingPositions = [...new Set(allEmployees?.map((e: any) => e.position).filter(Boolean) || [])] as string[]
  const allPositions = [
    ...POSITION_CANON,
    ...existingPositions.filter(p => !POSITION_CANON.includes(p)),
  ]

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, position])

  const isHeadSMM = user?.role === 'head_smm'
  const smmPositions = ['SMM специалист', 'Главный SMM специалист']

  const employees = allEmployees?.filter((emp: any) => {
    // head_smm sees only SMM employees
    if (isHeadSMM && !smmPositions.includes(emp.position || '') && !['smm_specialist', 'head_smm'].includes(emp.user?.role || '')) return false
    const matchesSearch = !search || emp.fullName?.toLowerCase().includes(search.toLowerCase()) || emp.email?.toLowerCase().includes(search.toLowerCase()) || emp.position?.toLowerCase().includes(search.toLowerCase())
    const matchesPosition = !position || emp.position === position
    return matchesSearch && matchesPosition
  }) || []

  const pagedEmployees = employees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const getTelegramUrl = (tg: string) => {
    const clean = tg.replace(/https?:\/\/(www\.)?t\.me\//g, '').replace(/^@/, '').trim()
    // Use tg:// deep link — opens the local Telegram app directly,
    // bypasses DNS issues if t.me is blocked (works in Tajikistan)
    return `tg://resolve?domain=${clean}`
  }

  const createMut = useMutation({
    mutationFn: employeesApi.create,
    onMutate: async (data: any) => {
      setShowCreate(false)
      await qc.cancelQueries({ queryKey: ['employees'] })
      const previous = qc.getQueryData(['employees'])
      const tempEmp = { id: `temp-${Date.now()}`, ...data, status: 'active', isSubAdmin: false }
      qc.setQueryData(['employees'], (old: any[]) => old ? [...old, tempEmp] : [tempEmp])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['employees'], context?.previous)
      setShowCreate(true)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['analytics-dashboard'] }); toast.success(t('employees.added')) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => employeesApi.update(id, data),
    onMutate: async ({ id: empId, data }: any) => {
      setEditEmp(null)
      await qc.cancelQueries({ queryKey: ['employees'] })
      const previous = qc.getQueryData(['employees'])
      qc.setQueryData(['employees'], (old: any[]) => old?.map((e: any) => e.id === empId ? { ...e, ...data } : e) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['employees'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: (resp: any) => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      if (resp?._warning) {
        toast(resp._warning, { icon: '⚠️', duration: 6000 })
      } else {
        toast.success(t('employees.saved'))
      }
    },
  })
  const deleteMut = useMutation({
    mutationFn: employeesApi.remove,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['employees'] })
      const previous = qc.getQueryData(['employees'])
      qc.setQueryData(['employees'], (old: any[]) => old?.filter((e: any) => e.id !== id) ?? [])
      setDeleteId(null)
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['employees'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      toast.success(t('employees.deleted'))
    },
  })
  const toggleSubAdmin = useMutation({
    mutationFn: employeesApi.toggleSubAdmin,
    onMutate: async (empId: string) => {
      await qc.cancelQueries({ queryKey: ['employees'] })
      const previous = qc.getQueryData(['employees'])
      qc.setQueryData(['employees'], (old: any[]) => old?.map((e: any) => e.id === empId ? { ...e, isSubAdmin: !e.isSubAdmin } : e) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['employees'], context?.previous)
      toast.error(t('common.error'))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success(t('common.updated')) },
  })

  const blockMut = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) => usersApi.block(userId, reason),
    onMutate: async ({ userId }) => {
      await qc.cancelQueries({ queryKey: ['employees'] })
      const previous = qc.getQueryData(['employees'])
      qc.setQueryData(['employees'], (old: any[]) => old?.map((e: any) => e.userId === userId ? { ...e, user: { ...e.user, isBlocked: true } } : e) ?? [])
      setBlockEmp(null)
      setBlockReason('')
      return { previous }
    },
    onError: (e: any, _v, context: any) => {
      qc.setQueryData(['employees'], context?.previous)
      toast.error(e?.response?.data?.message || 'Не удалось заблокировать')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Сотрудник заблокирован')
    },
  })

  const unblockMut = useMutation({
    mutationFn: (userId: string) => usersApi.unblock(userId),
    onMutate: async (userId: string) => {
      await qc.cancelQueries({ queryKey: ['employees'] })
      const previous = qc.getQueryData(['employees'])
      qc.setQueryData(['employees'], (old: any[]) => old?.map((e: any) => e.userId === userId ? { ...e, user: { ...e.user, isBlocked: false } } : e) ?? [])
      setUnblockId(null)
      return { previous }
    },
    onError: (_e, _v, context: any) => {
      qc.setQueryData(['employees'], context?.previous)
      toast.error('Не удалось разблокировать')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Сотрудник разблокирован')
    },
  })

  const resetPwdMut = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password?: string }) => usersApi.resetPassword(userId, password),
    onSuccess: (data: any, vars) => {
      const empName = resetPwdEmp?.fullName || 'Сотрудник'
      setResetResult({ name: empName, password: data.newPassword })
      setResetPwdEmp(null)
      setCustomPwd('')
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось сбросить пароль')
    },
  })

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                    <button onClick={() => { setResetPwdEmp(emp); setCustomPwd('') }} className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg text-blue-500" title="Сбросить пароль">
                      <Key size={14} />
                    </button>
                    {emp.user?.isBlocked ? (
                      <button onClick={() => setUnblockId(emp.userId)} className="p-1.5 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg text-green-600" title="Разблокировать">
                        <Unlock size={14} />
                      </button>
                    ) : (
                      <button onClick={() => setBlockEmp(emp)} className="p-1.5 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg text-orange-500" title="Заблокировать">
                        <Lock size={14} />
                      </button>
                    )}
                    {canEditEmployee(emp) && (
                      <>
                        <button onClick={() => setEditEmp(emp)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"><Edit size={14} className="text-surface-500 dark:text-surface-400" /></button>
                        <button onClick={() => setDeleteId(emp.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500"><Trash2 size={14} /></button>
                      </>
                    )}
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
                {emp.user?.isBlocked ? (
                  <span className="badge bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1">
                    <Ban size={11} /> Заблокирован
                  </span>
                ) : (
                  <span className={clsx('badge', emp.status==='active' ? 'status-done' : 'status-cancelled')}>{emp.status==='active' ? t('common.active') : t('common.inactive')}</span>
                )}
                <span className="text-xs text-surface-400 dark:text-surface-500">{format(new Date(emp.hireDate), 'dd.MM.yyyy')}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-surface-100 dark:border-surface-700">
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('employees.fullName')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden md:table-cell">{t('employees.position')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden lg:table-cell">{t('employees.department')}</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 hidden lg:table-cell">Telegram</th>
                <th className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3">{t('common.status')}</th>
                {isAdmin && <th className="text-right text-xs font-semibold text-surface-500 dark:text-surface-400 px-4 py-3 whitespace-nowrap">{t('common.actions')}</th>}
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
                  <td className="px-4 py-3">
                    {emp.user?.isBlocked ? (
                      <span className="badge bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1 w-fit">
                        <Ban size={11} /> Заблокирован
                      </span>
                    ) : (
                      <span className={clsx('badge', emp.status==='active' ? 'status-done' : 'status-cancelled')}>{emp.status==='active' ? t('common.active') : t('common.inactive')}</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 whitespace-nowrap" onClick={e=>e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => toggleSubAdmin.mutate(emp.id)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg" title="Помощник админа">
                          <ShieldCheck size={14} className={emp.isSubAdmin ? 'text-primary-600' : 'text-surface-400'} />
                        </button>
                        <button onClick={() => { setResetPwdEmp(emp); setCustomPwd('') }} className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg text-blue-500" title="Сбросить пароль">
                          <Key size={14} />
                        </button>
                        {emp.user?.isBlocked ? (
                          <button onClick={() => setUnblockId(emp.userId)} className="p-1.5 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg text-green-600" title="Разблокировать">
                            <Unlock size={14} />
                          </button>
                        ) : (
                          <button onClick={() => setBlockEmp(emp)} className="p-1.5 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg text-orange-500" title="Заблокировать">
                            <Lock size={14} />
                          </button>
                        )}
                        {canEditEmployee(emp) && (
                          <>
                            <button onClick={() => setEditEmp(emp)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg"><Edit size={14} className="text-surface-500" /></button>
                            <button onClick={() => setDeleteId(emp.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400"><Trash2 size={14} /></button>
                          </>
                        )}
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
        onSubmit={data => editEmp ? updateMut.mutateAsync({ id: editEmp.id, data }) : createMut.mutateAsync(data as any)}
        loading={createMut.isPending || updateMut.isPending} />
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId!)} title={t('common.delete') + '?'} danger />

      {/* Block modal */}
      <Modal open={!!blockEmp} onClose={() => { setBlockEmp(null); setBlockReason('') }} title="Заблокировать сотрудника" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
            <Lock size={18} className="text-orange-500 shrink-0" />
            <p className="text-sm text-orange-800 dark:text-orange-300">
              <strong>{blockEmp?.fullName}</strong> не сможет войти в систему пока вы не разблокируете
            </p>
          </div>
          <div>
            <label className="label mb-1">Причина блокировки (необязательно)</label>
            <textarea
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              rows={3}
              placeholder="Например: нарушение дисциплины, увольнение, отпуск..."
              className="input w-full resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setBlockEmp(null); setBlockReason('') }} className="btn-secondary">Отмена</button>
            <button
              onClick={() => blockEmp?.userId && blockMut.mutate({ userId: blockEmp.userId, reason: blockReason || undefined })}
              disabled={!blockEmp?.userId || blockMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
            >
              <Lock size={15} /> Заблокировать
            </button>
          </div>
        </div>
      </Modal>

      {/* Unblock confirm */}
      <ConfirmDialog
        open={!!unblockId}
        onClose={() => setUnblockId(null)}
        onConfirm={() => unblockId && unblockMut.mutate(unblockId)}
        title="Разблокировать сотрудника?"
        message="Сотрудник снова сможет войти в систему."
      />

      {/* Reset password modal */}
      <Modal open={!!resetPwdEmp} onClose={() => { setResetPwdEmp(null); setCustomPwd('') }} title="Сбросить пароль" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
            <Key size={18} className="text-blue-500 shrink-0" />
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Сбросить пароль для <strong>{resetPwdEmp?.fullName}</strong>?<br/>
              <span className="text-xs">Старый пароль перестанет работать</span>
            </p>
          </div>
          <div>
            <label className="label mb-1">Новый пароль (или оставьте пустым для авто-генерации)</label>
            <input
              type="text"
              value={customPwd}
              onChange={e => setCustomPwd(e.target.value)}
              placeholder="Случайный пароль будет сгенерирован"
              className="input w-full"
              minLength={8}
            />
            <p className="text-[10px] text-surface-400 mt-1">Минимум 8 символов</p>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setResetPwdEmp(null); setCustomPwd('') }} className="btn-secondary">Отмена</button>
            <button
              onClick={() => resetPwdEmp?.userId && resetPwdMut.mutate({ userId: resetPwdEmp.userId, password: customPwd || undefined })}
              disabled={!resetPwdEmp?.userId || resetPwdMut.isPending || (customPwd.length > 0 && customPwd.length < 8)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
            >
              <Key size={15} /> Сбросить
            </button>
          </div>
        </div>
      </Modal>

      {/* Reset result modal — shows the new password */}
      <Modal open={!!resetResult} onClose={() => { setResetResult(null); setPwdCopied(false) }} title="Пароль изменён" size="sm">
        {resetResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
              <Check size={18} className="text-green-500 shrink-0" />
              <p className="text-sm text-green-800 dark:text-green-300">
                Новый пароль для <strong>{resetResult.name}</strong>:
              </p>
            </div>
            <div className="bg-surface-100 dark:bg-surface-800 rounded-xl p-4 border-2 border-dashed border-primary-300 dark:border-primary-700">
              <div className="flex items-center justify-between gap-3">
                <code className="text-lg font-mono font-bold text-primary-700 dark:text-primary-300 select-all break-all">{resetResult.password}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(resetResult.password)
                    setPwdCopied(true)
                    setTimeout(() => setPwdCopied(false), 2000)
                  }}
                  className="shrink-0 p-2 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-lg text-surface-600 dark:text-surface-300"
                  title="Скопировать"
                >
                  {pwdCopied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
            </div>
            <p className="text-xs text-orange-600 dark:text-orange-400 flex items-start gap-1">
              <span>⚠️</span>
              <span>Запишите или скопируйте пароль и передайте сотруднику. После закрытия окна вы больше не сможете его увидеть.</span>
            </p>
            <div className="flex justify-end">
              <button onClick={() => { setResetResult(null); setPwdCopied(false) }} className="btn-primary">Закрыть</button>
            </div>
          </div>
        )}
      </Modal>
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
  const { register, handleSubmit, reset, setValue, setError, formState: { errors } } = useForm()
  const { t } = useTranslation()
  const actorRole = useAuthStore(s => s.user?.role)
  const isFounderActor = actorRole === 'founder'

  useEffect(() => {
    if (initial) {
      reset({ fullName: initial.fullName||'', position: initial.position||'',
        email: initial.email||'', phone: initial.phone||'', telegram: initial.telegram ? (initial.telegram.startsWith('@') ? initial.telegram : '@' + initial.telegram) : '@', instagram: initial.instagram||'',
        hireDate: initial.hireDate ? new Date(initial.hireDate).toISOString().split('T')[0] : '', status: initial.status||'active', bio: initial.bio||'' })
    } else {
      reset({ fullName:'', position:'', email:'', phone:'', telegram:'@', instagram:'', hireDate:'', status:'active', bio:'' })
    }
  }, [initial, open, reset])

  const handleTelegramChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value
    if (!val.startsWith('@')) val = '@' + val.replace(/@/g, '')
    setValue('telegram', val, { shouldValidate: true })
  }

  const handleEmailBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (val && !val.includes('@')) setValue('email', val + '@gmail.com', { shouldValidate: true })
  }

  const submit = async (data: any) => {
    // Map position label → role enum value
    const positionToRoleMap: Record<string, string> = {
      'SMM специалист': 'smm_specialist',
      'Дизайнер': 'designer',
      'Таргетолог': 'targetologist',
      'Менеджер по продажам': 'sales_manager',
      'Проект-менеджер': 'project_manager',
      'Разработчик': 'developer',
      'Сотрудник': 'employee',
      'Основатель': 'founder',
      'Сооснователь': 'co_founder',
    }
    const role = positionToRoleMap[data.position]
    try {
      await onSubmit({ fullName: data.fullName, position: data.position, department: 'Общий',
        email: data.email, phone: data.phone, telegram: data.telegram !== '@' ? data.telegram : undefined,
        instagram: data.instagram||undefined, hireDate: data.hireDate, status: data.status, bio: data.bio||undefined,
        ...(role && { role }) })
    } catch (e: any) {
      const msg: string = e?.response?.data?.message || ''
      if (msg.toLowerCase().includes('email')) {
        setError('email', { message: 'Этот email уже используется' })
      } else if (msg.toLowerCase().includes('телефон') || msg.toLowerCase().includes('phone')) {
        setError('phone', { message: 'Этот номер уже используется' })
      } else if (msg) {
        toast.error(msg)
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? t('common.edit') : t('employees.add')} size="lg">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">{t('employees.fullName')} *</label>
            <input {...register('fullName', { required: 'Обязательное поле' })} className={`input ${errors.fullName ? 'border-red-400' : ''}`} />
            {errors.fullName && <p className="text-xs text-red-400 mt-1">{String(errors.fullName.message)}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('employees.position')} *</label>
            <select {...register('position', { required: 'Выберите должность' })} className={`input ${errors.position ? 'border-red-400' : ''}`}>
              <option value="">Выберите должность</option>
              {[
                'Главный SMM специалист',
                'SMM специалист',
                'Дизайнер',
                'Таргетолог',
                'Маркетолог',
                'Менеджер по продажам',
                'Проект-менеджер',
                'Разработчик',
                'Администратор',
                'Основатель',
                'Сооснователь',
              ]
                .filter(p => isFounderActor || (p !== 'Сооснователь' && p !== 'Основатель') || p === initial?.position)
                .map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {errors.position && <p className="text-xs text-red-400 mt-1">{String(errors.position.message)}</p>}
          </div>
          <div>
            <label className="label">{t('employees.email')} *</label>
            <input type="email" {...register('email', { required: 'Обязательное поле' })} onBlur={handleEmailBlur} placeholder="username" className={`input ${errors.email ? 'border-red-400' : ''}`} />
            {errors.email && <p className="text-xs text-red-400 mt-1">{String(errors.email.message)}</p>}
          </div>
          <div>
            <label className="label">{t('employees.phone')} *</label>
            <input {...register('phone', { required: 'Обязательное поле' })} className={`input ${errors.phone ? 'border-red-400' : ''}`} placeholder="+992..." />
            {errors.phone && <p className="text-xs text-red-400 mt-1">{String(errors.phone.message)}</p>}
          </div>
          <div>
            <label className="label">Telegram *</label>
            <input {...register('telegram', { required: 'Обязательное поле', validate: v => v !== '@' || 'Введите username' })}
              onChange={handleTelegramChange} className={`input ${errors.telegram ? 'border-red-400' : ''}`} placeholder="@username" />
            {errors.telegram && <p className="text-xs text-red-400 mt-1">{String(errors.telegram.message)}</p>}
          </div>
          <div>
            <label className="label">Instagram</label>
            <input {...register('instagram')} className="input" placeholder="@username" />
          </div>
          <div>
            <label className="label">{t('employees.hireDate')} *</label>
            <input type="date" {...register('hireDate', { required: 'Обязательное поле' })} className={`input ${errors.hireDate ? 'border-red-400' : ''}`} />
            {errors.hireDate && <p className="text-xs text-red-400 mt-1">{String(errors.hireDate.message)}</p>}
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
