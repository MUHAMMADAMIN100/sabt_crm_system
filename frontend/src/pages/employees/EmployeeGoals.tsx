// «Цели месяца» в карточке сотрудника (профиль, идея 2 — решение владельца
// 17.10.2026): руководитель направления и основатель ставят до трёх целей.
// Цель без показателя сотрудник отмечает сам, с показателем — CRM считает.
// Блок виден только тем, кому сервер разрешил ставить цели.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import { goalsApi, type GoalsOfUser } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { GoalRowView } from '@/pages/profile/ProfileStats'

/** Кто может ставить цели: руководство и руководители направлений. Остальным
 *  запрос не шлём. */
const LEAD_ROLES = ['founder', 'admin', 'smm_director', 'dev_director', 'pm_dev']

const UNIT: Record<string, string> = { '%': '%', days: 'дней', shifts: 'смен' }

export default function EmployeeGoals({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const key = ['goals', userId]
  const me = useAuthStore(s => s.user)
  const lead = [me?.role, (me as any)?.secondaryRole].some(r => !!r && LEAD_ROLES.includes(r))
  const { data } = useQuery({ queryKey: key, queryFn: () => goalsApi.ofUser(userId), retry: false, enabled: lead })
  const [title, setTitle] = useState('')
  const [metric, setMetric] = useState('')
  const [target, setTarget] = useState('')

  const onErr = (e: any) => toast.error(e?.response?.data?.message || 'Не получилось сохранить')
  const put = (d: GoalsOfUser) => qc.setQueryData(key, d)
  const create = useMutation({
    mutationFn: () => goalsApi.create({ userId, title: title.trim(), metric: metric || null, target: metric ? Number(target) : null }),
    onSuccess: (d) => { put(d); setTitle(''); setMetric(''); setTarget('') },
    onError: onErr,
  })
  const remove = useMutation({ mutationFn: (id: string) => goalsApi.remove(id), onSuccess: put, onError: onErr })
  const toggle = useMutation({
    mutationFn: (g: { id: string; done: boolean }) => goalsApi.update(g.id, { done: !g.done }),
    onSuccess: (d: any) => { if (d?.goals) put(d) },
    onError: onErr,
  })

  if (!data?.canEdit) return null
  const unit = data.metrics.find(m => m.key === metric)?.unit
  const canAdd = title.trim().length > 0 && (!metric || Number(target) > 0)

  return (
    <div className="card space-y-3.5">
      <div className="flex items-baseline gap-2">
        <h3 className="section-title">Цели месяца</h3>
        <span className="text-xs text-surface-400 dark:text-surface-500">{data.goals.length} из {data.max}</span>
      </div>

      {data.goals.map(g => (
        <GoalRowView key={g.id} g={g} onToggle={g.metric ? undefined : () => toggle.mutate(g)}>
          <button type="button" onClick={() => remove.mutate(g.id)} aria-label={`Убрать цель «${g.title}»`}
            className="w-8 h-8 shrink-0 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center">
            <Trash2 size={14} />
          </button>
        </GoalRowView>
      ))}

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
          <button type="submit" disabled={!canAdd || create.isPending} className="btn-primary">Добавить</button>
        </form>
      )}
    </div>
  )
}
