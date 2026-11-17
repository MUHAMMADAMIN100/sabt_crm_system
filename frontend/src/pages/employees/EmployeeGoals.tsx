// «Цели месяца» в карточке сотрудника (профиль, идея 2 — решение владельца
// 17.10.2026): руководитель направления и основатель ставят до трёх целей.
// Цель без показателя сотрудник отмечает сам, с показателем — CRM считает.
// Блок виден только тем, кому сервер разрешил ставить цели.
// «Компас компании» (16.11.2026): цель может работать на результат отдела
// или компании этого месяца — выбор «Работает на» и цепочка под целью.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import { goalsApi, type GoalsOfUser, type ProfileGoal } from '@/services/api.service'
import { compassKeys } from '@/services/goals.api'
import { useAuthStore } from '@/store/auth.store'
import { GoalChain, GoalRowView } from '@/pages/profile/ProfileStats'

const UNIT: Record<string, string> = { '%': '%', days: 'дней', shifts: 'смен', count: 'шт.' }

type KrOption = NonNullable<GoalsOfUser['keyResults']>[number]

/** Варианты «Работает на»: сначала результаты отдела (по отделам), потом
 *  результаты компании. */
function KeyResultOptions({ list }: { list: KrOption[] }) {
  const byDept = new Map<string, KrOption[]>()
  for (const k of list) {
    if (k.level !== 'department') continue
    const name = k.departmentName || 'отдела'
    byDept.set(name, [...(byDept.get(name) || []), k])
  }
  const company = list.filter(k => k.level === 'company')
  return (
    <>
      <option value="">— не привязана</option>
      {Array.from(byDept.entries()).map(([name, items]) => (
        <optgroup key={name} label={`Отдел «${name}»`}>
          {items.map(k => <option key={k.id} value={k.id}>{k.title}</option>)}
        </optgroup>
      ))}
      {company.length > 0 && (
        <optgroup label="Компания">
          {company.map(k => <option key={k.id} value={k.id}>{k.title}</option>)}
        </optgroup>
      )}
    </>
  )
}

export default function EmployeeGoals({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const key = ['goals', userId]
  const me = useAuthStore(s => s.user)
  // Кто ставит цели, решает сервер (canEdit): руководство, руководители
  // направлений и руководители отделов «Компаса» — их назначают в настройках,
  // и роль у них может быть любой (16.11.2026). Чужим сервер отвечает пустым
  // списком с canEdit: false, поэтому список ролей здесь не держим.
  const { data } = useQuery({ queryKey: key, queryFn: () => goalsApi.ofUser(userId), retry: false, enabled: !!me })
  const [title, setTitle] = useState('')
  const [metric, setMetric] = useState('')
  const [target, setTarget] = useState('')
  const [krId, setKrId] = useState('')
  /** Цель, у которой сейчас меняют «Работает на». */
  const [relinking, setRelinking] = useState<string | null>(null)

  const onErr = (e: any) => toast.error(e?.response?.data?.message || 'Не получилось сохранить')
  // Цели людей видны и в «Компасе» (таблица отдела, «Требует внимания»).
  const put = (d: GoalsOfUser) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: compassKeys.all }) }
  const create = useMutation({
    mutationFn: () => goalsApi.create({
      userId, title: title.trim(), metric: metric || null, target: metric ? Number(target) : null,
      keyResultId: krId || null,
    }),
    onSuccess: (d) => { put(d); setTitle(''); setMetric(''); setTarget(''); setKrId('') },
    onError: onErr,
  })
  const remove = useMutation({ mutationFn: (id: string) => goalsApi.remove(id), onSuccess: put, onError: onErr })
  const toggle = useMutation({
    mutationFn: (g: { id: string; done: boolean }) => goalsApi.update(g.id, { done: !g.done }),
    onSuccess: (d: any) => { if (d?.goals) put(d) },
    onError: onErr,
  })
  const relink = useMutation({
    mutationFn: (v: { id: string; keyResultId: string | null }) => goalsApi.update(v.id, { keyResultId: v.keyResultId }),
    onSuccess: (d: any) => {
      setRelinking(null)
      if (d && 'canEdit' in d && Array.isArray(d.goals)) put(d)
      else { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: compassKeys.all }) }
    },
    onError: onErr,
  })

  if (!data?.canEdit) return null
  const unit = data.metrics.find(m => m.key === metric)?.unit
  const canAdd = title.trim().length > 0 && (!metric || Number(target) > 0)
  const krs = data.keyResults || []

  /** Цепочка цели: из ответа сервера, а если её нет — по списку результатов. */
  const chainOf = (g: ProfileGoal): ProfileGoal['keyResult'] => {
    if (g.keyResult) return g.keyResult
    const k = g.keyResultId ? krs.find(x => x.id === g.keyResultId) : undefined
    return k ? { ...k, progress: null, status: 'none', parent: null } : null
  }

  return (
    <div className="card space-y-3.5">
      <div className="flex items-baseline gap-2">
        <h3 className="section-title">Цели месяца</h3>
        <span className="text-xs text-surface-400 dark:text-surface-500">{data.goals.length} из {data.max}</span>
      </div>

      {data.goals.map(g => {
        const chain = chainOf(g)
        return (
          <div key={g.id} className="flex flex-col gap-1.5">
            <GoalRowView g={g} onToggle={g.metric ? undefined : () => toggle.mutate(g)}>
              <button type="button" onClick={() => remove.mutate(g.id)} aria-label={`Убрать цель «${g.title}»`}
                className="w-8 h-8 shrink-0 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center">
                <Trash2 size={14} />
              </button>
            </GoalRowView>
            {relinking === g.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex flex-1 min-w-[220px] items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400">
                  <span className="shrink-0">Работает на</span>
                  <select autoFocus value={g.keyResultId ?? chain?.id ?? ''} disabled={relink.isPending}
                    onChange={e => relink.mutate({ id: g.id, keyResultId: e.target.value || null })}
                    className="input flex-1 min-w-0">
                    <KeyResultOptions list={krs} />
                  </select>
                </label>
                <button type="button" onClick={() => setRelinking(null)} className="btn-ghost min-h-[44px] lg:min-h-[34px]">Отмена</button>
              </div>
            ) : (
              <div className={g.metric ? 'flex items-start gap-2' : 'flex items-start gap-2 pl-[34px]'}>
                <GoalChain kr={chain} className="flex-1" />
                {krs.length > 0 && (
                  <button type="button" onClick={() => setRelinking(g.id)}
                    aria-label={`${chain ? 'Изменить, на что работает' : 'Привязать к результату'} цель «${g.title}»`}
                    className="shrink-0 min-h-[44px] lg:min-h-0 text-xs font-semibold text-primary-600 dark:text-primary-300 hover:underline">
                    {chain ? 'Изменить' : 'Привязать к результату'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {data.goals.length < data.max && (
        <form className="flex flex-wrap items-center gap-2 pt-1"
          onSubmit={e => { e.preventDefault(); if (canAdd && !create.isPending) create.mutate() }}>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
            placeholder="Новая цель" aria-label="Цель"
            className="input flex-1 min-w-[200px]" />
          <select value={metric} onChange={e => setMetric(e.target.value)} aria-label="Как считать" className="input w-auto">
            <option value="">Отмечает сотрудник</option>
            {data.metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {metric && (
            <label className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400">
              <input value={target} onChange={e => setTarget(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
                aria-label="Сколько нужно" placeholder="0" className="input w-20 text-right" />
              {unit ? UNIT[unit] : ''}
            </label>
          )}
          {krs.length > 0 && (
            <label className="flex flex-1 min-w-[220px] items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400">
              <span className="shrink-0">Работает на</span>
              <select value={krId} onChange={e => setKrId(e.target.value)} className="input flex-1 min-w-0">
                <KeyResultOptions list={krs} />
              </select>
            </label>
          )}
          <button type="submit" disabled={!canAdd || create.isPending} className="btn-primary">Добавить</button>
        </form>
      )}
    </div>
  )
}
