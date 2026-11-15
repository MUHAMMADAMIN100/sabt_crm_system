import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Phone } from 'lucide-react'
import { Modal } from '@/components/ui'
import { salesApi } from '@/services/sales.api'
import { CALL_OUTCOMES, CALL_RESULTS } from '@/lib/salesStages'
import type { CallOutcome, CallResult } from '@/types/sales'
import { afterLeadChange, useLastValue } from './salesHooks'
import { errorText, phoneHref } from './leadUtils'
import { BigChoice, ChoiceChips } from './SheetParts'
import NextActionPicker, { draftError, draftToNext, emptyDraft, type NextDraft } from './NextActionPicker'
import LostReasonModal from './LostReasonModal'

type CallLead = { id: string; name: string; status: string; contactPhone?: string | null }

/**
 * Шторка «Записать звонок» (15.11.2026, макет): результат, итог (если
 * дозвонились), комментарий и следующий шаг одним касанием. Звонок
 * попадает в историю лида и в KPI «Звонки» (POST /sales/leads/:id/calls).
 * Итог «Отказ» сразу ведёт в окно причины проигрыша — иначе лид остался
 * бы висеть в воронке с отказом в истории.
 */
export default function CallSheet({ lead, onClose, onSaved }: {
  lead: CallLead | null
  onClose: () => void
  onSaved?: () => void
}) {
  const shown = useLastValue(lead)
  const [lostFor, setLostFor] = useState<{ id: string; name: string } | null>(null)
  return (
    <>
      <Modal open={!!lead && !lostFor} onClose={onClose} title="Записать звонок" size="md" closeOnBackdropClick={false}>
        {shown && (
          <CallForm
            key={shown.id}
            lead={shown}
            onCancel={onClose}
            onDone={refused => {
              onSaved?.()
              if (refused) setLostFor({ id: shown.id, name: shown.name })
              else onClose()
            }}
          />
        )}
      </Modal>
      <LostReasonModal lead={lostFor} onClose={() => { setLostFor(null); onClose() }} />
    </>
  )
}

function CallForm({ lead, onCancel, onDone }: {
  lead: CallLead
  onCancel: () => void
  onDone: (refused: boolean) => void
}) {
  const qc = useQueryClient()
  const [result, setResult] = useState<CallResult | null>(null)
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [comment, setComment] = useState('')
  const [next, setNext] = useState<NextDraft>(() => emptyDraft('callback'))
  const nextErr = next.preset ? draftError(next) : null

  const save = useMutation({
    mutationFn: () => {
      const nx = draftToNext(next)
      return salesApi.logCall(lead.id, {
        result: result!,
        ...(result === 'reached' && outcome ? { outcome } : {}),
        ...(comment.trim() ? { comment: comment.trim().slice(0, 2000) } : {}),
        ...(nx ? { next: nx } : {}),
      })
    },
    onSuccess: saved => {
      afterLeadChange(qc, saved)
      toast.success('Звонок записан')
      onDone(result === 'reached' && outcome === 'refused')
    },
    onError: (e: any) => toast.error(errorText(e, 'Звонок не записан')),
  })

  return (
    <form onSubmit={e => { e.preventDefault(); if (result && !nextErr) save.mutate() }} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-surface-800 dark:text-surface-100">{lead.name}</p>
        {lead.contactPhone && (
          <a href={phoneHref(lead.contactPhone)} className="btn-secondary min-h-[44px] shrink-0">
            <Phone size={15} aria-hidden="true" /> {lead.contactPhone}
          </a>
        )}
      </div>

      <BigChoice label="Результат" options={CALL_RESULTS} value={result} onChange={v => { setResult(v); if (v !== 'reached') setOutcome(null) }} />

      {result === 'reached' && (
        <ChoiceChips label="Итог" options={CALL_OUTCOMES} value={outcome} onChange={setOutcome} />
      )}

      <div>
        <label htmlFor="call-comment" className="label">Комментарий</label>
        <textarea
          id="call-comment"
          rows={2}
          maxLength={2000}
          className="input resize-none"
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="О чём договорились"
        />
      </div>

      <NextActionPicker value={next} onChange={setNext} />

      <div className="space-y-2 pt-1">
        <button type="submit" disabled={!result || !!nextErr || save.isPending} className="btn-primary min-h-[48px] w-full">
          {save.isPending ? 'Сохранение…' : 'Сохранить звонок'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost min-h-[44px] w-full">Отмена</button>
        <p className="text-center text-xs text-surface-500 dark:text-surface-400">
          Звонок попадёт в историю лида и в KPI «Звонки»
        </p>
      </div>
    </form>
  )
}
