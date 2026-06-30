import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'
import { Avatar } from '@/components/ui'
import { ShieldCheck, Search, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

interface AccessUser {
  id: string
  name: string
  email: string
  role: string
  secondaryRole?: string | null
  position?: string | null
  extraPermissions: string[]
  isActive: boolean
}
interface Cap { key: string; label: string }

/**
 * «Доступы сотрудников» — основатель/сооснователь/админ выдаёт сотрудникам
 * персональные возможности ПОВЕРХ роли (например менеджеру продаж — добавление
 * проектов или ведение контент-плана). Тумблер сохраняется мгновенно, доступ
 * у сотрудника открывается без перезахода (socket access:changed → /auth/me).
 */
export default function EmployeeAccessPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: caps = [] } = useQuery<Cap[]>({ queryKey: ['access-catalog'], queryFn: () => usersApi.accessCatalog() })
  const { data: users = [], isLoading } = useQuery<AccessUser[]>({ queryKey: ['access-users'], queryFn: () => usersApi.listAccess() })

  const setAccess = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) => usersApi.setAccess(id, permissions),
    onMutate: async ({ id, permissions }) => {
      await qc.cancelQueries({ queryKey: ['access-users'] })
      const prev = qc.getQueryData<AccessUser[]>(['access-users'])
      qc.setQueryData<AccessUser[]>(['access-users'], (old = []) =>
        old.map(u => u.id === id ? { ...u, extraPermissions: permissions } : u))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['access-users'], ctx.prev)
      toast.error('Не удалось сохранить доступ')
    },
    onSuccess: () => toast.success('Доступ обновлён'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['access-users'] }),
  })

  const toggle = (u: AccessUser, key: string) => {
    const has = u.extraPermissions.includes(key)
    const permissions = has ? u.extraPermissions.filter(k => k !== key) : [...u.extraPermissions, key]
    setAccess.mutate({ id: u.id, permissions })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (users || []).filter(u => u.isActive)
    if (!q) return list
    return list.filter(u =>
      u.name.toLowerCase().includes(q) ||
      (u.position || '').toLowerCase().includes(q) ||
      getRoleLabel(u.role).toLowerCase().includes(q))
  }, [users, search])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-primary-600" />
        <div>
          <h1 className="page-title">Доступы сотрудников</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">
            Выдавайте персональные возможности поверх роли. Доступ открывается сотруднику сразу.
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск сотрудника…" className="input pl-9" />
      </div>

      {isLoading ? (
        <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-surface-400">Сотрудники не найдены.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(u => (
            <div key={u.id} className="card">
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={u.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{u.name}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{u.position || getRoleLabel(u.role)}</p>
                </div>
                {u.extraPermissions.length > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                    +{u.extraPermissions.length}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {caps.map(c => {
                  const on = u.extraPermissions.includes(c.key)
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggle(u, c.key)}
                      disabled={setAccess.isPending}
                      className={clsx(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60',
                        on
                          ? 'bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
                          : 'bg-surface-50 text-surface-600 border-surface-200 hover:border-surface-400 dark:bg-surface-800 dark:text-surface-300 dark:border-surface-700 dark:hover:border-surface-500',
                      )}
                    >
                      {on && <Check size={12} />}
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
