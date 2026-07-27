import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'
import { Avatar, Modal } from '@/components/ui'
import { ShieldCheck, Search, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

interface AccessUser {
  id: string; name: string; email: string; role: string
  secondaryRole?: string | null; position?: string | null
  extraPermissions: string[]; isActive: boolean
}
/** roles — роли, у которых возможность есть НАТИВНО (без персонального гранта). */
interface Cap { key: string; label: string; category: string; roles?: string[] }

/**
 * «Доступы сотрудников» — основатель/сооснователь/админ выдаёт сотрудникам
 * персональные возможности ПОВЕРХ роли (категоризированная матрица). Доступ
 * у сотрудника открывается мгновенно (socket access:changed → /auth/me).
 */
export default function EmployeeAccessPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AccessUser | null>(null)

  const { data: caps = [] } = useQuery<Cap[]>({ queryKey: ['access-catalog'], queryFn: () => usersApi.accessCatalog() })
  const { data: users = [], isLoading } = useQuery<AccessUser[]>({ queryKey: ['access-users'], queryFn: () => usersApi.listAccess() })

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
            <button key={u.id} type="button" onClick={() => setEditing(u)}
              className="card flex items-center gap-3 text-left hover:border-surface-400 dark:hover:border-surface-500 transition-colors">
              <Avatar name={u.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{u.name}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{u.position || getRoleLabel(u.role)}</p>
              </div>
              {u.extraPermissions.length > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                  +{u.extraPermissions.length} доступов
                </span>
              )}
              <SlidersHorizontal size={16} className="text-surface-400 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {editing && (
        <AccessEditorModal
          user={editing}
          caps={caps}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['access-users'] }) }}
        />
      )}
    </div>
  )
}

// ─── Модалка-редактор доступов сотрудника (категоризированная матрица) ──
function AccessEditorModal({ user, caps, onClose, onSaved }: {
  user: AccessUser; caps: Cap[]; onClose: () => void; onSaved: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(user.extraPermissions))
  useEffect(() => { setSelected(new Set(user.extraPermissions)) }, [user.id])

  const save = useMutation({
    mutationFn: () => usersApi.setAccess(user.id, [...selected]),
    onSuccess: () => { toast.success('Доступы сохранены'); onSaved() },
    onError: () => toast.error('Не удалось сохранить доступы'),
  })

  const toggle = (key: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  /** Возможность уже есть по роли (или по второй роли) — гранта не требует.
   *  Такие отмечаем галочкой и блокируем: гранты только ДОБАВЛЯЮТ доступ,
   *  снять право роли через эту матрицу нельзя, и «пустой» чекбокс у
   *  основателя (у которого есть всё) только сбивал с толку. */
  const isByRole = (c: Cap) => {
    const roles = c.roles || []
    return roles.includes(user.role) || (!!user.secondaryRole && roles.includes(user.secondaryRole))
  }

  const byRoleCount = caps.filter(isByRole).length
  const totalCount = caps.filter(c => isByRole(c) || selected.has(c.key)).length

  // Группировка возможностей по категориям (порядок появления).
  const grouped = useMemo(() => {
    const map = new Map<string, Cap[]>()
    for (const c of caps) { if (!map.has(c.category)) map.set(c.category, []); map.get(c.category)!.push(c) }
    return [...map.entries()]
  }, [caps])

  return (
    <Modal open onClose={onClose} title={`Доступы — ${user.name}`} size="xl">
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
        {user.position || getRoleLabel(user.role)} · доступно всего{' '}
        <b className="text-surface-700 dark:text-surface-300">{totalCount}</b> из {caps.length}:
        по роли — {byRoleCount}, выдано лично — {selected.size}.
        {byRoleCount > 0 && ' Права роли отмечены и снятию не подлежат — гранты только добавляют доступ.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
        {grouped.map(([category, list]) => (
          <div key={category} className="rounded-xl border border-surface-200 dark:border-surface-700 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">{category}</p>
            <div className="space-y-1.5">
              {list.map(c => {
                const native = isByRole(c)
                return (
                  <label
                    key={c.key}
                    title={native ? 'Есть по роли — снять нельзя' : undefined}
                    className={clsx(
                      'flex items-center gap-2 text-sm',
                      native
                        ? 'cursor-default text-surface-500 dark:text-surface-400'
                        : 'cursor-pointer text-surface-700 dark:text-surface-200',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 shrink-0"
                      checked={native || selected.has(c.key)}
                      disabled={native}
                      onChange={() => { if (!native) toggle(c.key) }}
                    />
                    <span className="min-w-0">{c.label}</span>
                    {native && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 shrink-0">
                        по роли
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-3 border-t border-surface-100 dark:border-surface-700">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Отмена</button>
        <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="btn-primary text-sm">
          {save.isPending ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </Modal>
  )
}
