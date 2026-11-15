import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui'
import { leadsApi } from '@/services/sales.api'
import { LOST_REASONS } from '@/lib/salesStages'
import type { LostReason, SalesLead } from '@/types/sales'
import { afterLeadChange, useLastValue } from './salesHooks'
import { errorText } from './leadUtils'

/**
 * «Проиграно» (15.11.2026): причина из списка обязательна — без неё
 * аналитика «почему теряем» пустая, сервер отвечает 400. Для «Другое»
 * нужен текст (rejectionReason).
 */
export default function LostReasonModal({ lead, onClose, onDone }: {
  lead: { id: string; name: string } | null
  onClose: () => void
  onDone?: (lead: SalesLead) => void
}) {
  const shown = useLastValue(lead)
  return (
    <Modal open={!!lead} onClose={onClose} title="Проиграно" size="md" closeOnBackdropClick={false}>
      {shown && <LostForm key={shown.id} lead={shown} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function LostForm({ lead, onClose, onDone }: {
  lead: { id: string; name: string }
  onClose: () => void
  onDone?: (lead: SalesLead) => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState<LostReason | null>(null)
  const [text, setText] = useState('')
  const needText = reason === 'other'
  const ready = !!reason && (!needText || text.trim().length > 0)

  const save = useMutation({
    mutationFn: () => leadsApi.update(lead.id, {
      status: 'lost',
      lostReason: reason,
      rejectionReason: text.trim() || null,
    }),
    onSuccess: saved => {
      afterLeadChange(qc, saved)
      toast.success('Лид отмечен как проигранный')
      onDone?.(saved)
      onClose()
    },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось сохранить')),
  })

  return (
    <form onSubmit={e => { e.preventDefault(); if (ready) save.mutate() }} className="space-y-4">
      <p className="text-sm text-surface-600 dark:text-surface-300">
        Почему «{lead.name}» не стал клиентом? Причина попадёт в аналитику продаж.
      </p>
      <fieldset>
        <legend className="label">Причина *</legend>
        <div className="space-y-1.5">
          {LOST_REASONS.map(r => (
            <label
              key={r.value}
              className={clsx(
                'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm transition-colors',
                reason === r.value
                  ? 'border-primary-600 bg-primary-50 text-surface-900 dark:border-primary-400 dark:bg-surface-700 dark:text-surface-50'
                  : 'border-surface-200 text-surface-700 hover:border-surface-400 dark:border-surface-700 dark:text-surface-200',
              )}
            >
              <input
                type="radio"
                name="lost-reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="h-4 w-4 accent-current"
              />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="lost-text" className="label">{needText ? 'Опишите причину *' : 'Подробнее (необязательно)'}</label>
        <textarea
          id="lost-text"
          rows={2}
          maxLength={2000}
          className="input resize-none"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Что сказал клиент"
          aria-required={needText}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary min-h-[44px]">Отмена</button>
        <button type="submit" disabled={!ready || save.isPending} className="btn-primary min-h-[44px]">
          {save.isPending ? 'Сохранение…' : 'Отметить проигрыш'}
        </button>
      </div>
    </form>
  )
}
