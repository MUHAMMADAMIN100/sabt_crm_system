import clsx from 'clsx'
import { ArrowRight, PhoneCall } from 'lucide-react'
import { isActive, lostReasonLabel, nextStage, normalizeStatus } from '@/lib/salesStages'
import type { SalesLead } from '@/types/sales'
import { ACTION_TONE_CLASS, formatMoney, initialsOf, moneyValue, nextActionOf } from '@/components/sales/leadUtils'

/**
 * Карточка лида на доске (15.11.2026, макет «Единая воронка»): название,
 * сфера · источник, сумма, ближайшее действие (просрочено — красным,
 * сегодня — жёлтым, нет шага — жёлтая пунктирная рамка), инициалы
 * ответственного и кнопка «→» на следующий этап. Перетаскивание на
 * компьютере — только дополнение: этап всегда можно сменить кнопкой.
 */
export default function BoardCard({ lead, onOpen, onAdvance, canMove, draggable, onDragStart, onDragEnd, dragging }: {
  lead: SalesLead
  onOpen: (lead: SalesLead) => void
  onAdvance: (lead: SalesLead) => void
  canMove: boolean
  draggable: boolean
  onDragStart: (lead: SalesLead) => void
  onDragEnd: () => void
  dragging: boolean
}) {
  const status = normalizeStatus(lead.status)
  const active = isActive(status)
  const action = nextActionOf(lead)
  const potential = moneyValue(lead.dealPotential)
  const meta = [lead.sphere, lead.leadSource].filter(Boolean).join(' · ')
  const next = nextStage(status)
  const showMove = canMove && active && !lead.handoffAt
  const moveLabel = next ? `Перевести «${lead.name}» на этап «${next.label}»` : `Передать «${lead.name}» в работу`

  return (
    <div
      draggable={draggable}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', lead.id); onDragStart(lead) }}
      onDragEnd={onDragEnd}
      className={clsx(
        'flex rounded-lg border border-surface-200 bg-surface-50 transition-colors hover:border-surface-400 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-surface-500',
        lead.onHold && 'opacity-70',
        lead.callRequested && 'border-l-4 border-l-amber-500',
        dragging && 'opacity-40',
      )}
    >
      <button type="button" onClick={() => onOpen(lead)} className="min-w-0 flex-1 rounded-l-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <p className="break-words text-sm font-medium leading-snug text-surface-900 dark:text-surface-50">{lead.name}</p>
        {meta && <p className="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">{meta}</p>}
        {potential > 0 && <p className="mt-1 text-xs font-semibold tabular-nums text-surface-800 dark:text-surface-100">{formatMoney(potential)}</p>}
        {active && (
          <span className={clsx('mt-2 inline-flex max-w-full rounded-md px-1.5 py-0.5 text-[11px] font-medium', ACTION_TONE_CLASS[action.tone])}>
            <span className="truncate">{action.tone === 'none' ? 'Нет шага' : action.label}</span>
          </span>
        )}
        {status === 'lost' && (
          <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{lostReasonLabel(lead.lostReason)}</p>
        )}
        {(lead.onHold || lead.callRequested) && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {lead.onHold && <span className="rounded bg-surface-200 px-1.5 py-0.5 text-[10px] font-semibold text-surface-700 dark:bg-surface-700 dark:text-surface-200">На паузе</span>}
            {lead.callRequested && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-800/50 dark:text-amber-200">
                <PhoneCall size={10} aria-hidden="true" /> Позвонить
              </span>
            )}
          </span>
        )}
      </button>
      <div className="flex shrink-0 flex-col items-center justify-between gap-2 py-2 pr-2">
        <span
          title={lead.owner?.name ? `Ведёт ${lead.owner.name}` : 'Без ответственного'}
          aria-label={lead.owner?.name ? `Ведёт ${lead.owner.name}` : 'Без ответственного'}
          className={clsx(
            'flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold',
            lead.owner?.name
              ? 'bg-primary-100 text-primary-700 dark:bg-surface-700 dark:text-surface-100'
              : 'border border-dashed border-surface-400 text-surface-400',
          )}
        >
          {lead.owner?.name ? initialsOf(lead.owner.name) : '—'}
        </span>
        {showMove && (
          <button type="button" onClick={() => onAdvance(lead)} aria-label={moveLabel} title={next ? `На этап «${next.label}»` : 'Передать в работу'}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-surface-300 text-surface-600 hover:border-primary-600 hover:bg-primary-600 hover:text-white dark:border-surface-600 dark:text-surface-300 lg:h-8 lg:w-8">
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
