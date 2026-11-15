// «Продажи → Настройки» (15.11.2026, docs/SALES_SPEC.md §5): дневные нормы
// KPI менеджеров по направлениям и комиссия менеджеров (процент от
// полученных оплат). GET/PUT /sales/settings. Нормы правят основатель и
// админ, комиссию — только основатель; чужие поля показываются, но закрыты.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Loader2, Save } from 'lucide-react'
import { salesApi } from '@/services/sales.api'
import { salesKeys } from '@/lib/salesQueries'
import { canEditSalesCommission, canEditSalesNorms, getRoleLabel } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth.store'
import { EmptyState, Skeleton } from '@/components/ui'
import type { SalesNorms, SalesSettings } from '@/types/sales'
import { ErrorCard } from './salesUi'

type Dir = 'smm' | 'development'
type NormKey = keyof SalesNorms

const NORM_FIELDS: Array<{ key: NormKey; label: string }> = [
  { key: 'funnel_progress', label: 'Продвижения по воронке' },
  { key: 'new_companies', label: 'Новые компании' },
  { key: 'cold_calls', label: 'Звонки' },
  { key: 'personal_emails', label: 'Персональные письма' },
  { key: 'meetings', label: 'Встречи (состоялись)' },
]
const DIRS: Array<{ key: Dir; label: string }> = [
  { key: 'smm', label: 'SMM' },
  { key: 'development', label: 'Разработка' },
]

interface Draft {
  norms: Record<Dir, Record<NormKey, string>>
  commission: Record<string, string>
}

function toDraft(s: SalesSettings): Draft {
  const n = (d: Dir) => Object.fromEntries(NORM_FIELDS.map(f => [f.key, String(s.norms?.[d]?.[f.key] ?? 0)])) as Record<NormKey, string>
  const commission: Record<string, string> = {}
  for (const m of s.managers ?? []) {
    const p = s.commission?.[m.id]
    commission[m.id] = p != null && p > 0 ? String(p) : ''
  }
  return { norms: { smm: n('smm'), development: n('development') }, commission }
}

/** Норма — целое 0..500, иначе null. */
function parseNorm(v: string): number | null {
  const t = v.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n <= 500 ? n : null
}

/** Процент комиссии: '' или 0 — нет комиссии (0); 0..100, иначе null. */
function parseCommission(v: string): number | null {
  const t = v.trim().replace(',', '.')
  if (!t) return 0
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

export default function SalesSettingsTab() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const editNorms = canEditSalesNorms(user?.role, user?.secondaryRole)
  const editCommission = canEditSalesCommission(user?.role, user?.secondaryRole)

  const q = useQuery({
    queryKey: salesKeys.settings(),
    queryFn: () => salesApi.settings(),
    // Черновик правок не должен сбрасываться фоновым обновлением.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  useEffect(() => { if (q.data && !draft) setDraft(toDraft(q.data)) }, [q.data, draft])

  const original = useMemo(() => (q.data ? toDraft(q.data) : null), [q.data])
  const dirty = !!draft && !!original && JSON.stringify(draft) !== JSON.stringify(original)

  const normErrors = useMemo(() => {
    const out = new Set<string>()
    if (!draft) return out
    for (const d of DIRS) for (const f of NORM_FIELDS) if (parseNorm(draft.norms[d.key][f.key]) == null) out.add(`${d.key}.${f.key}`)
    return out
  }, [draft])
  const commissionErrors = useMemo(() => {
    const out = new Set<string>()
    if (!draft) return out
    for (const [id, v] of Object.entries(draft.commission)) if (parseCommission(v) == null) out.add(id)
    return out
  }, [draft])

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !q.data) throw new Error('no-data')
      const payload: { norms?: Record<Dir, SalesNorms>; commission?: Record<string, number> } = {}
      if (editNorms) {
        const n = (d: Dir) => Object.fromEntries(NORM_FIELDS.map(f => [f.key, parseNorm(draft.norms[d][f.key]) ?? 0])) as unknown as SalesNorms
        payload.norms = { smm: n('smm'), development: n('development') }
      }
      if (editCommission) {
        // Сервер хранит комиссию целиком: проценты тех, кого нет в списке
        // менеджеров (уволен, сменил роль), не теряем.
        const commission: Record<string, number> = { ...(q.data.commission ?? {}) }
        for (const [id, v] of Object.entries(draft.commission)) {
          const p = parseCommission(v) ?? 0
          if (p > 0) commission[id] = p; else delete commission[id]
        }
        payload.commission = commission
      }
      const saved = await salesApi.saveSettings(payload)
      return { saved, payload }
    },
    onSuccess: ({ saved, payload }) => {
      const prev = q.data as SalesSettings
      const next: SalesSettings = saved && saved.norms
        ? { ...prev, ...saved, managers: saved.managers ?? prev.managers }
        : { ...prev, norms: payload.norms ?? prev.norms, commission: payload.commission ?? prev.commission }
      qc.setQueryData(salesKeys.settings(), next)
      setDraft(toDraft(next))
      // Нормы меняют цели KPI на панелях менеджеров.
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      toast.success('Сохранено')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить настройки'),
  })

  if (q.isPending) return <SettingsSkeleton />
  if (q.isError || !q.data) return <ErrorCard text="Не удалось загрузить настройки продаж." onRetry={() => q.refetch()} />
  if (!draft) return <SettingsSkeleton />

  const managers = q.data.managers ?? []
  const hasErrors = (editNorms && normErrors.size > 0) || (editCommission && commissionErrors.size > 0)
  const setNorm = (d: Dir, k: NormKey, v: string) =>
    setDraft(cur => (cur ? { ...cur, norms: { ...cur.norms, [d]: { ...cur.norms[d], [k]: v.replace(/[^\d]/g, '') } } } : cur))
  const setCommission = (id: string, v: string) =>
    setDraft(cur => (cur ? { ...cur, commission: { ...cur.commission, [id]: v } } : cur))

  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (dirty && !hasErrors) save.mutate() }}>
      <section className="card" aria-labelledby="sales-norms-title">
        <h2 id="sales-norms-title" className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Нормы KPI в день</h2>
        <p className="text-[13px] text-surface-500 dark:text-surface-400 mt-1">
          Сколько действий в день ждём от менеджера своего направления. По нормам считается процент KPI на панели менеджера.
          {!editNorms && ' Менять нормы могут основатель и администратор.'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {DIRS.map(d => (
            <fieldset key={d.key} disabled={!editNorms} className="min-w-0 rounded-xl border border-surface-200 dark:border-surface-700 p-3 sm:p-4">
              <legend className="px-1 text-[13px] font-semibold text-surface-800 dark:text-surface-200">{d.label}</legend>
              <div className="flex flex-col gap-2.5">
                {NORM_FIELDS.map(f => {
                  const id = `norm-${d.key}-${f.key}`
                  const bad = normErrors.has(`${d.key}.${f.key}`)
                  return (
                    <div key={f.key} className="flex items-center justify-between gap-3">
                      <label htmlFor={id} className="text-[13px] text-surface-700 dark:text-surface-300">{f.label}</label>
                      <input id={id} type="number" inputMode="numeric" min={0} max={500} step={1}
                        value={draft.norms[d.key][f.key]} onChange={e => setNorm(d.key, f.key, e.target.value)}
                        aria-invalid={bad || undefined} aria-describedby={bad ? `${id}-err` : undefined}
                        className={clsx('input no-spin w-24 shrink-0 text-right tabular-nums min-h-[44px] lg:min-h-[36px] disabled:opacity-60',
                          bad && '!border-red-500')} />
                      {bad && <span id={`${id}-err`} className="sr-only">Целое число от 0 до 500</span>}
                    </div>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {editNorms && normErrors.size > 0 && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-2" role="alert">Норма — целое число от 0 до 500.</p>
        )}
      </section>

      <section className="card" aria-labelledby="sales-commission-title">
        <h2 id="sales-commission-title" className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Комиссия менеджеров</h2>
        <p className="text-[13px] text-surface-500 dark:text-surface-400 mt-1">
          Процент от полученных оплат клиентов менеджера. Пусто — комиссии нет.
          {!editCommission && ' Менять комиссию может только основатель.'}
        </p>
        {!managers.length ? (
          <EmptyState title="Менеджеров по продажам пока нет" />
        ) : (
          <div className="overflow-x-auto mt-3 -mx-3 sm:-mx-4">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Менеджер</th>
                  <th scope="col" className="px-3 py-2 text-right">Комиссия, %</th>
                </tr>
              </thead>
              <tbody>
                {managers.map(m => {
                  const id = `commission-${m.id}`
                  const bad = commissionErrors.has(m.id)
                  return (
                    <tr key={m.id}>
                      <th scope="row" className="px-3 py-2 border-t border-surface-100 dark:border-surface-700/60 text-left font-normal">
                        <label htmlFor={id} className="block">
                          <span className="block font-medium text-surface-900 dark:text-surface-100">{m.name}</span>
                          <span className="block text-xs text-surface-500 dark:text-surface-400">{getRoleLabel(m.role)}</span>
                        </label>
                      </th>
                      <td className="px-3 py-2 border-t border-surface-100 dark:border-surface-700/60 text-right">
                        <input id={id} type="number" inputMode="decimal" min={0} max={100} step={0.5}
                          value={draft.commission[m.id] ?? ''} onChange={e => setCommission(m.id, e.target.value)}
                          disabled={!editCommission} placeholder="нет"
                          aria-invalid={bad || undefined}
                          className={clsx('input no-spin w-24 text-right tabular-nums min-h-[44px] lg:min-h-[36px] disabled:opacity-60',
                            bad && '!border-red-500')} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {editCommission && commissionErrors.size > 0 && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-2" role="alert">Комиссия — число от 0 до 100.</p>
        )}
      </section>

      {(editNorms || editCommission) && (
        <div className="flex flex-col-reverse xs:flex-row xs:justify-end gap-2">
          {dirty && (
            <button type="button" onClick={() => original && setDraft(original)} disabled={save.isPending}
              className="btn-ghost min-h-[44px] lg:min-h-[36px]">
              Отменить изменения
            </button>
          )}
          <button type="submit" disabled={!dirty || hasErrors || save.isPending}
            className="btn-primary min-h-[44px] lg:min-h-[36px] disabled:opacity-60">
            {save.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            Сохранить
          </button>
        </div>
      )}
    </form>
  )
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Загрузка настроек">
      <div className="card space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="space-y-2">
              {[0, 1, 2, 3, 4].map(j => <Skeleton key={j} className="h-9 w-full" />)}
            </div>
          ))}
        </div>
      </div>
      <div className="card space-y-2">
        <Skeleton className="h-4 w-1/4" />
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </div>
  )
}
