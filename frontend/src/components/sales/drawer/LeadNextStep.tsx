import { useState } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Flag } from 'lucide-react'
import { isActive } from '@/lib/salesStages'
import type { SalesLead } from '@/types/sales'
import { useLeadUpdate } from '../salesHooks'
import { ACTION_TEXT_CLASS, dateInput, daysFromNow, formatAt, joinLocal, splitLocal } from '../leadUtils'
import Section, { LinkButton } from './Section'

/**
 * «Следующий шаг» (15.11.2026): у активного лида всегда должен быть шаг со
 * сроком — иначе лид пропадает из «Сегодня» и остывает. Пустой блок —
 * жёлтая пунктирная рамка «Нет следующего шага — добавьте» и форма сразу.
 */
export default function LeadNextStep({ lead, canAct }: { lead: SalesLead; canAct: boolean }) {
  const [editing, setEditing] = useState(false)
  const hasStep = !!(lead.nextStep?.trim() || lead.nextStepAt)
  const active = isActive(lead.status)
  if (!hasStep && !active) return null

  const showForm = canAct && (editing || (!hasStep && active))
  const at = lead.nextStepAt ? new Date(lead.nextStepAt) : null
  const valid = !!at && !isNaN(at.getTime())
  const tone = !valid ? 'none' : at!.getTime() < Date.now() ? 'late' : dateInput(at!) === dateInput(new Date()) ? 'today' : 'wait'

  return (
    <Section
      title="Следующий шаг"
      action={canAct && hasStep && !editing ? <LinkButton onClick={() => setEditing(true)}>Изменить</LinkButton> : undefined}
    >
      {showForm ? (
        <div className={clsx(!hasStep && 'rounded-lg border-2 border-dashed border-amber-400 p-3 dark:border-amber-500/70')}>
          {!hasStep && (
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
              <Flag size={14} aria-hidden="true" /> Нет следующего шага — добавьте
            </p>
          )}
          <StepForm lead={lead} onDone={() => setEditing(false)} onCancel={hasStep ? () => setEditing(false) : undefined} />
        </div>
      ) : hasStep ? (
        <div>
          <p className="text-sm text-surface-900 dark:text-surface-50">{lead.nextStep?.trim() || 'Шаг без описания'}</p>
          <p className={clsx('mt-0.5 text-xs', ACTION_TEXT_CLASS[tone])}>
            {valid ? (tone === 'late' ? `Просрочено · ${formatAt(at!)}` : formatAt(at!)) : 'Без срока — шаг не попадёт в «Сегодня»'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-amber-700 dark:text-amber-300">Нет следующего шага</p>
      )}
    </Section>
  )
}

function StepForm({ lead, onDone, onCancel }: { lead: SalesLead; onDone: () => void; onCancel?: () => void }) {
  const cur = splitLocal(lead.nextStepAt)
  const [text, setText] = useState(lead.nextStep || '')
  const [date, setDate] = useState(cur.date)
  const [time, setTime] = useState(cur.time || '11:00')
  const update = useLeadUpdate()
  const ready = !!text.trim()
  const id = `step-${lead.id}`

  const save = (clear = false) => update.mutate(
    { id: lead.id, data: clear ? { nextStep: null, nextStepAt: null } : { nextStep: text.trim().slice(0, 500), nextStepAt: joinLocal(date, time) } },
    { onSuccess: () => { toast.success(clear ? 'Шаг убран' : 'Шаг сохранён'); onDone() } },
  )

  return (
    <form onSubmit={e => { e.preventDefault(); if (ready) save() }} className="space-y-2">
      <label htmlFor={`${id}-text`} className="sr-only">Что сделать</label>
      <input id={`${id}-text`} className="input" maxLength={500} value={text} onChange={e => setText(e.target.value)}
        placeholder="Что сделать: позвонить, отправить КП…" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setDate(dateInput(new Date()))} className="btn-secondary min-h-[40px] max-lg:min-h-[44px]">Сегодня</button>
        <button type="button" onClick={() => setDate(dateInput(daysFromNow(1)))} className="btn-secondary min-h-[40px] max-lg:min-h-[44px]">Завтра</button>
        <button type="button" onClick={() => setDate(dateInput(daysFromNow(3)))} className="btn-secondary min-h-[40px] max-lg:min-h-[44px]">Через 3 дня</button>
        <label htmlFor={`${id}-date`} className="sr-only">Дата</label>
        <input id={`${id}-date`} type="date" className="input !w-auto" value={date} onChange={e => setDate(e.target.value)} />
        <label htmlFor={`${id}-time`} className="sr-only">Время</label>
        <input id={`${id}-time`} type="time" className="input !w-auto" value={time} onChange={e => setTime(e.target.value)} />
      </div>
      {ready && !date && (
        <p className="text-xs text-amber-700 dark:text-amber-300">Укажите срок — иначе шаг не появится в «Сегодня».</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={!ready || update.isPending} className="btn-primary min-h-[44px]">
          {update.isPending ? 'Сохранение…' : 'Сохранить шаг'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost min-h-[44px]">Отмена</button>}
        {onCancel && (
          <button type="button" onClick={() => save(true)} disabled={update.isPending}
            className="btn-ghost ml-auto min-h-[44px] text-red-600 dark:text-red-300">
            Убрать шаг
          </button>
        )}
      </div>
    </form>
  )
}
