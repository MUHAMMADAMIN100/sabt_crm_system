// «Компас компании» (16.11.2026, GOALS_SPEC §2): кто руководит отделом.
// По умолчанию — по ролям; основатель/админ может назначить другого.
// Руководитель ставит результаты отдела, отмечает статус недели и цели людей.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui'
import { compassApi, compassKeys } from '@/services/goals.api'
import { DEPARTMENTS } from '@/lib/goals'
import { getRoleLabel } from '@/lib/permissions'
import { errorText } from '@/components/sales/leadUtils'
import type { DeptKey, GoalSettingsView } from '@/types/goals'

export function LeadersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Руководители отделов" size="md" closeOnBackdropClick={false}>
      <LeadersBody onClose={onClose} />
    </Modal>
  )
}

function LeadersBody({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: compassKeys.settings, queryFn: () => compassApi.settings() })
  if (q.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-surface-500">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Загружаем настройки…
      </p>
    )
  }
  if (q.isError || !q.data) {
    return (
      <div role="alert" className="flex flex-col gap-3 py-2 text-sm text-surface-600 dark:text-surface-300">
        {errorText(q.error, 'Не удалось загрузить настройки.')}
        <div className="flex gap-2">
          <button type="button" onClick={() => q.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Закрыть</button>
        </div>
      </div>
    )
  }
  return <LeadersForm data={q.data} onClose={onClose} />
}

function LeadersForm({ data, onClose }: { data: GoalSettingsView; onClose: () => void }) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<DeptKey, string>>(() => {
    const v = {} as Record<DeptKey, string>
    for (const d of DEPARTMENTS) v[d.key] = data.overrides?.[d.key] ?? ''
    return v
  })
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const leaders: Partial<Record<DeptKey, string | null>> = {}
      for (const d of DEPARTMENTS) leaders[d.key] = values[d.key] || null
      return compassApi.saveSettings(leaders)
    },
    onSuccess: res => {
      qc.setQueryData(compassKeys.settings, res)
      qc.invalidateQueries({ queryKey: compassKeys.all })
      toast.success('Руководители сохранены')
      onClose()
    },
    onError: (e: unknown) => setError(errorText(e, 'Не удалось сохранить')),
  })

  const candidates = data.candidates ?? []

  return (
    <form onSubmit={e => { e.preventDefault(); setError(null); save.mutate() }} className="flex flex-col gap-4">
      <p className="text-[13px] text-surface-600 dark:text-surface-300">
        Руководитель ставит результаты отдела и цели своим людям, по понедельникам отмечает статус недели.
        «По умолчанию» — по ролям: продажи и управление — основатель, SMM — руководитель SMM, разработка — руководитель разработки.
      </p>
      {DEPARTMENTS.map(d => {
        const current = data.leaders?.[d.key] ?? null
        const override = data.overrides?.[d.key] ?? null
        // Подсказка у «По умолчанию»: кто руководит сейчас, если вручную не назначен.
        const defaultLabel = !override && current ? `По умолчанию — ${current.name}` : 'По умолчанию'
        const picked = values[d.key]
        const missing = !!picked && !candidates.some(c => c.id === picked)
        return (
          <div key={d.key}>
            <label htmlFor={`leader-${d.key}`} className="label">{d.name}</label>
            <select
              id={`leader-${d.key}`}
              className="input"
              value={picked}
              onChange={e => setValues(v => ({ ...v, [d.key]: e.target.value }))}
            >
              <option value="">{defaultLabel}</option>
              {missing && <option value={picked}>{current?.id === picked ? current.name : 'Сотрудник не найден'}</option>}
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {getRoleLabel(c.role)}</option>)}
            </select>
          </div>
        )
      })}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-col-reverse xs:flex-row xs:justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Отмена</button>
        <button type="submit" disabled={save.isPending} className="btn-primary min-h-[44px] lg:min-h-[36px]">
          {save.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          Сохранить
        </button>
      </div>
    </form>
  )
}
