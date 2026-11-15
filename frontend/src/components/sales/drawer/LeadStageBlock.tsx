import clsx from 'clsx'
import { Check, Pause } from 'lucide-react'
import { ACTIVE_STATUSES, FUNNEL_STAGES, lostReasonLabel, nextStage, normalizeStatus } from '@/lib/salesStages'
import type { LeadStatus, SalesLead } from '@/types/sales'

const STEPS = FUNNEL_STAGES.filter(s => ACTIVE_STATUSES.includes(s.value))

/**
 * Этапы лида (15.11.2026): шаги Новый → Контакт → Встреча → КП → Договор,
 * кнопка следующего этапа, «Выиграно» (окно «Передать в работу») и
 * «Проиграно» (окно причины). Шаг можно выбрать и напрямую — в том числе
 * вернуть проигранный лид в работу. После передачи в работу этап не
 * меняется: проект уже создаётся.
 */
export default function LeadStageBlock({ lead, canAct, pending, onStage, onWon, onLost, onToggleHold }: {
  lead: SalesLead
  canAct: boolean
  pending: boolean
  onStage: (s: LeadStatus) => void
  onWon: () => void
  onLost: () => void
  onToggleHold: () => void
}) {
  const status = normalizeStatus(lead.status)
  const isWon = status === 'won'
  const isLost = status === 'lost'
  const locked = !canAct || !!lead.handoffAt || pending
  const idx = isWon ? STEPS.length : STEPS.findIndex(s => s.value === status)
  const next = nextStage(status)
  const active = ACTIVE_STATUSES.includes(status)

  return (
    <div className="px-4 pb-4 sm:px-5">
      <ol className="flex items-start" aria-label="Этапы воронки">
        {STEPS.map((s, i) => {
          const done = !isLost && i < idx
          const current = !isLost && i === idx
          const dot = (
            <span className={clsx(
              'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
              done && 'border-primary-600 bg-primary-600 text-white',
              current && 'border-primary-600 bg-surface-50 text-primary-700 dark:bg-surface-800 dark:text-primary-300',
              !done && !current && 'border-surface-300 bg-surface-50 text-surface-400 dark:border-surface-600 dark:bg-surface-800',
            )}>
              {done ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
          )
          const label = (
            <span className={clsx('mt-1 block text-center text-[11px] leading-tight',
              current ? 'font-semibold text-surface-900 dark:text-surface-50' : 'text-surface-500 dark:text-surface-400')}>
              {s.label}
            </span>
          )
          return (
            <li key={s.value} className="relative flex flex-1 flex-col items-center">
              {i > 0 && (
                <span aria-hidden="true" className={clsx('absolute right-1/2 top-[13px] h-0.5 w-full',
                  !isLost && i <= idx ? 'bg-primary-600' : 'bg-surface-200 dark:bg-surface-700')} />
              )}
              {locked || current ? (
                <span className="relative flex flex-col items-center" aria-current={current ? 'step' : undefined}>
                  {dot}{label}
                </span>
              ) : (
                <button type="button" onClick={() => onStage(s.value)}
                  className="relative flex min-h-[44px] flex-col items-center rounded-md px-1 hover:bg-surface-100 dark:hover:bg-surface-700/60"
                  aria-label={`Перевести на этап «${s.label}»`}>
                  {dot}{label}
                </button>
              )}
            </li>
          )
        })}
      </ol>

      {isLost && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/25 dark:text-red-200">
          Проиграно · {lostReasonLabel(lead.lostReason)}{lead.rejectionReason ? `: ${lead.rejectionReason}` : ''}
          {canAct && <span className="mt-0.5 block text-xs opacity-80">Чтобы вернуть лид в работу, выберите этап выше.</span>}
        </p>
      )}

      {canAct && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active && next && (
            <button type="button" onClick={() => onStage(next.value)} disabled={pending} className="btn-primary min-h-[44px]">
              На этап «{next.label}»
            </button>
          )}
          {active && (
            <button type="button" onClick={onWon} disabled={pending} className={clsx(next ? 'btn-secondary' : 'btn-primary', 'min-h-[44px]')}>
              Выиграно
            </button>
          )}
          {isWon && !lead.handoffAt && (
            <button type="button" onClick={onWon} disabled={pending} className="btn-primary min-h-[44px]">
              Передать в работу
            </button>
          )}
          {active && (
            <button type="button" onClick={onLost} disabled={pending} className="btn-secondary min-h-[44px] text-red-700 dark:text-red-300">
              Проиграно
            </button>
          )}
          {active && (
            <button
              type="button"
              onClick={onToggleHold}
              disabled={pending}
              aria-pressed={!!lead.onHold}
              className={clsx(
                'ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
                lead.onHold
                  ? 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'border-surface-300 text-surface-700 hover:border-surface-400 dark:border-surface-600 dark:text-surface-200',
              )}
            >
              <Pause size={14} aria-hidden="true" /> На паузе
            </button>
          )}
        </div>
      )}
    </div>
  )
}
