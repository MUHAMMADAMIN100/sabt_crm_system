import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/services/api.service'
import { getRoleLabel, ROLE_LABELS } from '@/lib/permissions'
import { Avatar, Modal } from '@/components/ui'
import { ShieldCheck, Search, SlidersHorizontal, AlertTriangle, Users, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

interface AccessUser {
  id: string; name: string; email: string; role: string
  secondaryRole?: string | null; position?: string | null
  extraPermissions: string[]; deniedPermissions?: string[]; isActive: boolean
}
/** roles — роли, у которых возможность есть НАТИВНО (без персонального гранта). */
interface Cap { key: string; label: string; category: string; roles?: string[]; danger?: boolean }

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

      {!isLoading && <RolesAudit users={users} />}

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
              {(u.deniedPermissions?.length || 0) > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 shrink-0">
                  −{u.deniedPermissions!.length} снято
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

// ─── «Роли: кто на них сидит» ────────────────────────────────────────────
/**
 * Сводка по ролям для ревизии должностей: на каждой роли — сколько людей и
 * кто именно (основная роль и вторая считаются вместе, вторая помечена
 * «2-я»). Пустые роли вынесены отдельно: такую роль можно убирать из
 * списка должностей, никого не задев.
 *
 * Считаем только активных сотрудников — уволенные роль уже не занимают.
 */
function RolesAudit({ users }: { users: AccessUser[] }) {
  const [open, setOpen] = useState(true)

  const { busy, empty } = useMemo(() => {
    const map = new Map<string, { main: string[]; second: string[] }>()
    const bucket = (role: string) => {
      let b = map.get(role)
      if (!b) { b = { main: [], second: [] }; map.set(role, b) }
      return b
    }
    // Сначала все известные роли — чтобы пустые тоже попали в список.
    Object.keys(ROLE_LABELS).forEach(r => bucket(r))
    ;(users || []).filter(u => u.isActive).forEach(u => {
      bucket(u.role).main.push(u.name)
      if (u.secondaryRole) bucket(u.secondaryRole).second.push(u.name)
    })
    const rows = [...map.entries()].map(([role, v]) => ({
      role, main: v.main, second: v.second, total: v.main.length + v.second.length,
    }))
    return {
      busy: rows.filter(r => r.total > 0).sort((a, b) => b.total - a.total),
      empty: rows.filter(r => r.total === 0).sort((a, b) => getRoleLabel(a.role).localeCompare(getRoleLabel(b.role))),
    }
  }, [users])

  return (
    <div className="card">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left">
        <Users size={16} className="text-primary-600 shrink-0" />
        <span className="text-sm font-semibold text-surface-900 dark:text-surface-100">Роли: кто на них сидит</span>
        <span className="text-xs text-surface-500 dark:text-surface-400">
          занято {busy.length} · пустых {empty.length}
        </span>
        <ChevronDown size={16} className={clsx('ml-auto text-surface-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-3 space-y-1">
          {busy.map(r => (
            <div key={r.role} className="flex items-start gap-2 py-1.5 border-t border-surface-100 dark:border-surface-700">
              <span className="text-sm text-surface-700 dark:text-surface-200 w-48 shrink-0">{getRoleLabel(r.role)}</span>
              <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 w-6 shrink-0 tabular-nums">{r.total}</span>
              <span className="text-xs text-surface-600 dark:text-surface-300 min-w-0 flex-1">
                {[...r.main, ...r.second.map(n => `${n} (2-я)`)].join(', ')}
              </span>
            </div>
          ))}

          {empty.length > 0 && (
            <div className="pt-3 mt-1 border-t border-surface-200 dark:border-surface-600">
              <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-1.5">
                Никого нет — роль можно убрать
              </p>
              <p className="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
                {empty.map(r => getRoleLabel(r.role)).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Модалка-редактор доступов сотрудника (категоризированная матрица) ──
function AccessEditorModal({ user, caps, onClose, onSaved }: {
  user: AccessUser; caps: Cap[]; onClose: () => void; onSaved: () => void
}) {
  // granted — выдано лично поверх роли, denied — отнято из того, что даёт роль.
  const [granted, setGranted] = useState<Set<string>>(new Set(user.extraPermissions))
  const [denied, setDenied] = useState<Set<string>>(new Set(user.deniedPermissions))
  useEffect(() => {
    setGranted(new Set(user.extraPermissions))
    setDenied(new Set(user.deniedPermissions))
  }, [user.id])

  const [search, setSearch] = useState('')

  const save = useMutation({
    mutationFn: () => usersApi.setAccess(user.id, [...granted], [...denied]),
    onSuccess: () => { toast.success('Доступы сохранены'); onSaved() },
    onError: () => toast.error('Не удалось сохранить доступы'),
  })

  /** Возможность есть у сотрудника по роли (или по второй роли). */
  const isByRole = (c: Cap) => {
    const roles = c.roles || []
    return roles.includes(user.role) || (!!user.secondaryRole && roles.includes(user.secondaryRole))
  }

  /** Итог — ровно то же правило, что на сервере в hasGrant(). */
  const hasAccess = (c: Cap) => !denied.has(c.key) && (isByRole(c) || granted.has(c.key))

  /** Галочка = «есть доступ». Снимаем: право роли уходит в запреты, выданный
   *  грант просто убираем. Ставим: снимаем запрет, а если по роли не положено —
   *  выдаём грант. */
  const toggle = (c: Cap) => {
    const key = c.key
    const native = isByRole(c)
    if (hasAccess(c)) {
      setGranted(prev => { const n = new Set(prev); n.delete(key); return n })
      if (native) setDenied(prev => new Set(prev).add(key))
    } else {
      setDenied(prev => { const n = new Set(prev); n.delete(key); return n })
      if (!native) setGranted(prev => new Set(prev).add(key))
    }
  }

  // «по роли» считаем только действующие — снятые учтены отдельной цифрой.
  const byRoleCount = caps.filter(c => isByRole(c) && !denied.has(c.key)).length
  const totalCount = caps.filter(hasAccess).length

  // Группировка возможностей по категориям (порядок появления). Возможностей
  // много, поэтому сверху есть поиск — пустые категории не показываем.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const map = new Map<string, Cap[]>()
    for (const c of caps) {
      if (q && !c.label.toLowerCase().includes(q) && !c.category.toLowerCase().includes(q)) continue
      if (!map.has(c.category)) map.set(c.category, [])
      map.get(c.category)!.push(c)
    }
    return [...map.entries()]
  }, [caps, search])

  return (
    <Modal open onClose={onClose} title={`Доступы — ${user.name}`} size="xl">
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
        {user.position || getRoleLabel(user.role)} · доступно{' '}
        <b className="text-surface-700 dark:text-surface-300">{totalCount}</b> из {caps.length}:
        по роли — {byRoleCount}, выдано лично — {granted.size}, снято — {denied.size}.
        {' '}Снимите галочку, чтобы отобрать доступ, поставьте — чтобы выдать.
      </p>

      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Найти возможность…"
          className="input pl-9 text-sm py-1.5"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1">
        {grouped.map(([category, list]) => (
          <div key={category} className="rounded-xl border border-surface-200 dark:border-surface-700 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">{category}</p>
            <div className="space-y-1.5">
              {list.map(c => {
                const native = isByRole(c)
                const has = hasAccess(c)
                // Подпись состояния: откуда доступ взялся или почему его нет.
                const mark = denied.has(c.key) ? 'снят'
                  : granted.has(c.key) ? 'выдан'
                    : native ? 'по роли' : null
                return (
                  <label
                    key={c.key}
                    title={c.danger ? 'Чувствительный доступ — выдавайте осознанно' : undefined}
                    className="flex items-center gap-2 text-sm cursor-pointer text-surface-700 dark:text-surface-200"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 shrink-0"
                      checked={has}
                      onChange={() => toggle(c)}
                    />
                    <span className="min-w-0">{c.label}</span>
                    {c.danger && (
                      <span title="Чувствительный доступ" className="shrink-0 text-red-500 dark:text-red-400">
                        <AlertTriangle size={13} />
                      </span>
                    )}
                    {mark && (
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                        mark === 'снят'
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          : mark === 'выдан'
                            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                            : 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400',
                      )}>
                        {mark}
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
