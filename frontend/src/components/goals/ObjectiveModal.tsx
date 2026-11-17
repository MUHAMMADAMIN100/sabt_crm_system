// «Компас компании» (16.11.2026): цель компании на месяц — качественная
// формулировка и ответственный. Измеримые результаты добавляются к цели
// отдельно (KeyResultModal). Ставит основатель/админ.
import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui'
import { compassApi, compassKeys } from '@/services/goals.api'
import { monthLabel } from '@/lib/goals'
import { getRoleLabel } from '@/lib/permissions'
import { errorText } from '@/components/sales/leadUtils'
import type { ObjectiveView } from '@/types/goals'
import { useCompassPeople, useWhileOpen } from './GoalUi'

export function ObjectiveModal({ open, onClose, ym, editing }: {
  open: boolean
  onClose: () => void
  ym: string
  editing?: ObjectiveView | null
}) {
  const shown = useWhileOpen(open, editing ?? null)
  return (
    <Modal open={open} onClose={onClose} title={shown ? 'Изменить цель' : 'Новая цель компании'} size="md" closeOnBackdropClick={false}>
      <ObjectiveForm key={shown?.id ?? 'new'} ym={ym} editing={shown} onClose={onClose} />
    </Modal>
  )
}

function ObjectiveForm({ ym, editing, onClose }: { ym: string; editing: ObjectiveView | null; onClose: () => void }) {
  const qc = useQueryClient()
  const people = useCompassPeople()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [ownerId, setOwnerId] = useState(editing?.owner?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const data = { title: title.trim(), ownerId: ownerId || null }
      return editing ? compassApi.updateObjective(editing.id, data) : compassApi.createObjective({ ym, ...data })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: compassKeys.all })
      toast.success(editing ? 'Цель сохранена' : 'Цель добавлена')
      onClose()
    },
    onError: (e: unknown) => setError(errorText(e, 'Не удалось сохранить цель')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) { setError('Напишите, какая это цель'); return }
    if (t.length > 200) { setError('Слишком длинно — не больше 200 знаков'); return }
    setError(null)
    save.mutate()
  }

  // Ответственный, которого нет в списке (уволен, сменил отдел), остаётся
  // выбранным — иначе сохранение молча сняло бы его.
  const list = people.data ?? []
  const ownerMissing = !!editing?.owner && !list.some(p => p.id === editing.owner?.id)

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-[13px] text-surface-600 dark:text-surface-300">
        Цель на {monthLabel(ym)} — куда идёт компания. Коротко и понятно всем, например «Растём в SMM и разработке».
        Цифры добавите следующим шагом — 2–4 результата к цели.
      </p>
      <div>
        <label htmlFor="obj-title" className="label">Цель</label>
        <input
          id="obj-title"
          className="input"
          value={title}
          maxLength={200}
          autoFocus
          onChange={e => setTitle(e.target.value)}
          placeholder="Например, «Клиенты остаются с нами»"
        />
      </div>
      <div>
        <label htmlFor="obj-owner" className="label">Ответственный</label>
        <select id="obj-owner" className="input" value={ownerId} onChange={e => setOwnerId(e.target.value)}>
          <option value="">Не выбран</option>
          {ownerMissing && editing?.owner && <option value={editing.owner.id}>{editing.owner.name}</option>}
          {list.map(p => <option key={p.id} value={p.id}>{p.name} · {getRoleLabel(p.role)}</option>)}
        </select>
        {people.isError && <p className="mt-1 text-xs text-surface-500">Список сотрудников не загрузился — цель можно сохранить и без ответственного.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-col-reverse xs:flex-row xs:justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Отмена</button>
        <button type="submit" disabled={save.isPending} className="btn-primary min-h-[44px] lg:min-h-[36px]">
          {save.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {editing ? 'Сохранить' : 'Добавить цель'}
        </button>
      </div>
    </form>
  )
}
