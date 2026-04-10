import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/services/api.service'
import { PageLoader, EmptyState, Avatar, ConfirmDialog } from '@/components/ui'
import { Trash2, ToggleLeft, ToggleRight, Search, ShieldOff } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function UsersPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false)

  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })

  const toggleMut = useMutation({
    mutationFn: usersApi.toggleActive,
    onMutate: async (userId: string) => {
      await qc.cancelQueries({ queryKey: ['users'] })
      const previous = qc.getQueryData(['users'])
      qc.setQueryData(['users'], (old: any[]) => old?.map((u: any) => u.id === userId ? { ...u, isActive: !u.isActive } : u) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['users'], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['analytics-dashboard'] }); toast.success('Обновлено') },
  })
  const deleteMut = useMutation({
    mutationFn: usersApi.remove,
    onMutate: async (userId: string) => {
      setDeleteId(null)
      await qc.cancelQueries({ queryKey: ['users'] })
      const previous = qc.getQueryData(['users'])
      qc.setQueryData(['users'], (old: any[]) => old?.filter((u: any) => u.id !== userId) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['users'], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['analytics-dashboard'] }); toast.success('Удалён') },
  })
  const cleanupMut = useMutation({
    mutationFn: usersApi.cleanupOrphans,
    onMutate: async () => {
      setShowCleanupConfirm(false)
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['emp-eff'] })
      toast.success(res.count > 0 ? `Удалено призраков: ${res.count}` : 'Призраков не найдено')
    },
    onError: () => toast.error('Ошибка очистки'),
  })

  if (isLoading) return <PageLoader />

  const filtered = users?.filter((u: any) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  ) || []

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Администратор',
    founder: 'Основатель',
    project_manager: 'Проект-менеджер',
    smm_specialist: 'SMM специалист',
    designer: 'Дизайнер',
    targetologist: 'Таргетолог',
    sales_manager: 'Менеджер по продажам',
    developer: 'Разработчик',
    employee: 'Сотрудник',
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Пользователи</h1>
        <button
          onClick={() => setShowCleanupConfirm(true)}
          className="btn-secondary text-xs flex items-center gap-1.5 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-900/20"
          title="Удалить пользователей без профиля сотрудника"
        >
          <ShieldOff size={14} /> Очистить призраков
        </button>
      </div>
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." className="input pl-9" />
      </div>
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-100">
              <th className="text-left text-xs font-semibold text-surface-500 px-4 py-3">Пользователь</th>
              <th className="text-left text-xs font-semibold text-surface-500 px-4 py-3 hidden md:table-cell">Email</th>
              <th className="text-left text-xs font-semibold text-surface-500 px-4 py-3">Роль</th>
              <th className="text-left text-xs font-semibold text-surface-500 px-4 py-3 hidden lg:table-cell">Создан</th>
              <th className="text-left text-xs font-semibold text-surface-500 px-4 py-3">Статус</th>
              <th className="text-right text-xs font-semibold text-surface-500 px-4 py-3">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u: any) => (
              <tr key={u.id} className="border-b border-surface-50 hover:bg-surface-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={u.name} src={u.avatar} size={32} />
                    <span className="text-sm font-medium text-surface-900">{u.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-sm text-surface-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="badge bg-surface-100 text-surface-700">{ROLE_LABELS[u.role] || u.role}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-sm text-surface-400">
                  {format(new Date(u.createdAt), 'dd.MM.yyyy')}
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('badge', u.isActive ? 'status-done' : 'status-cancelled')}>
                    {u.isActive ? 'Активный' : 'Заблокирован'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => toggleMut.mutate(u.id)} className="p-1.5 hover:bg-surface-100 rounded-lg" title={u.isActive ? 'Деактивировать' : 'Активировать'}>
                      {u.isActive ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} className="text-surface-400" />}
                    </button>
                    <button onClick={() => setDeleteId(u.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <div className="py-12 text-center text-sm text-surface-400">Пользователей нет</div>}
      </div>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId!)} title="Удалить пользователя?" message="Это действие нельзя отменить." danger
      />
      <ConfirmDialog
        open={showCleanupConfirm}
        onClose={() => setShowCleanupConfirm(false)}
        onConfirm={() => cleanupMut.mutate()}
        title="Очистить призраков?"
        message="Будут удалены все пользователи-сотрудники без профиля сотрудника. Это устранит фантомные записи в аналитике."
        danger
      />
    </div>
  )
}
