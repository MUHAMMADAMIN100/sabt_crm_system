import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui'
import { salesApi } from '@/services/sales.api'
import { afterLeadChange, useLastValue } from './salesHooks'
import { errorText, formatAt } from './leadUtils'
import { BigChoice } from './SheetParts'
import NextActionPicker, { draftError, draftToNext, emptyDraft, type NextDraft } from './NextActionPicker'

type MeetingLead = { id: string; name: string; nextContactAt?: string | null }

/**
 * «Встреча состоялась?» (15.11.2026). KPI «Встречи» считает только
 * состоявшиеся — по этой отметке, а не по факту назначения
 * (POST /sales/leads/:id/meeting). Не состоялась — сразу предлагаем
 * перенести: по умолчанию следующий шаг — новая встреча.
 */
export default function MeetingResultSheet({ lead, onClose, onSaved }: {
  lead: MeetingLead | null
  onClose: () => void
  onSaved?: () => void
}) {
  const shown = useLastValue(lead)
  return (
    <Modal open={!!lead} onClose={onClose} title="Встреча состоялась?" size="md" closeOnBackdropClick={false}>
      {shown && <MeetingForm key={shown.id} lead={shown} onCancel={onClose} onDone={() => { onSaved?.(); onClose() }} />}
    </Modal>
  )
}

function MeetingForm({ lead, onCancel, onDone }: {
  lead: MeetingLead
  onCancel: () => void
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [held, setHeld] = useState<'yes' | 'no' | null>(null)
  const [comment, setComment] = useState('')
  const [next, setNext] = useState<NextDraft>(() => emptyDraft('step'))
  const nextErr = next.preset ? draftError(next) : null
  const at = lead.nextContactAt ? new Date(lead.nextContactAt) : null

  const save = useMutation({
    mutationFn: () => {
      const nx = draftToNext(next)
      return salesApi.meetingResult(lead.id, {
        held: held === 'yes',
        ...(comment.trim() ? { comment: comment.trim().slice(0, 2000) } : {}),
        ...(nx ? { next: nx } : {}),
      })
    },
    onSuccess: saved => {
      afterLeadChange(qc, saved)
      toast.success(held === 'yes' ? 'Встреча отмечена' : 'Отмечено: встреча не состоялась')
      onDone()
    },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось сохранить')),
  })

  return (
    <form onSubmit={e => { e.preventDefault(); if (held && !nextErr) save.mutate() }} className="space-y-4">
      <p className="text-sm text-surface-600 dark:text-surface-300">
        <span className="font-medium text-surface-800 dark:text-surface-100">{lead.name}</span>
        {at && !isNaN(at.getTime()) && <> · встреча {formatAt(at)}</>}
      </p>

      <BigChoice
        label="Встреча состоялась?"
        options={[{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }]}
        value={held}
        onChange={v => {
          setHeld(v)
          // Не состоялась — чаще всего встречу переносят.
          if (!next.preset) setNext(d => ({ ...d, kind: v === 'no' ? 'meeting' : 'step' }))
        }}
      />

      <div>
        <label htmlFor="meeting-comment" className="label">Комментарий</label>
        <textarea
          id="meeting-comment"
          rows={2}
          maxLength={2000}
          className="input resize-none"
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={held === 'no' ? 'Почему не состоялась' : 'Итоги встречи'}
        />
      </div>

      <NextActionPicker value={next} onChange={setNext} />

      <div className="space-y-2 pt-1">
        <button type="submit" disabled={!held || !!nextErr || save.isPending} className="btn-primary min-h-[48px] w-full">
          {save.isPending ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost min-h-[44px] w-full">Отмена</button>
        <p className="text-center text-xs text-surface-500 dark:text-surface-400">
          В KPI «Встречи» засчитываются только состоявшиеся встречи
        </p>
      </div>
    </form>
  )
}
