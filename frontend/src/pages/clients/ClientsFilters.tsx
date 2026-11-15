import clsx from 'clsx'
import type { ReactNode } from 'react'
import { AlertCircle, Clock, Flag, Pause, PhoneCall } from 'lucide-react'
import type { ChipCounts, DueFilter } from './boardFilters'

/** Строка чипов: на компьютере переносится, на телефоне — одна строка с
 *  прокруткой вбок от края до края. py-1 — запас под рамку выбранного. */
const CHIP_ROW = 'flex flex-wrap items-center gap-2 max-lg:-mx-4 max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:px-4 max-lg:py-1 hide-scrollbar'

function Chip({ active, onClick, children, tone = 'default', disabled }: {
  active: boolean
  onClick: () => void
  children: ReactNode
  tone?: 'default' | 'red' | 'amber'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors max-lg:h-11 disabled:opacity-50',
        active
          ? tone === 'red' ? 'border-red-600 bg-red-600 text-white'
            : tone === 'amber' ? 'border-amber-500 bg-amber-500 text-white'
            : 'border-primary-600 bg-primary-600 text-white'
          : 'border-surface-300 bg-surface-50 text-surface-700 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200',
      )}
    >
      {children}
    </button>
  )
}

function Count({ n }: { n: number | null }) {
  return n == null ? null : <span className="tabular-nums opacity-80">{n}</span>
}

/**
 * Чипы «Клиентов» (15.11.2026): Мои/Все (только руководству), сроки
 * (Просрочено / Сегодня / Без шага), источник, «На паузе» и «К звонку»
 * (отметки руководителя). Состояние — в адресе страницы.
 */
export default function ClientsFilters({
  canSeeAll, owner, onOwner, due, onDue, counts, source, sources, onSource, hold, onHold, callFlag, onCallFlag,
}: {
  canSeeAll: boolean
  owner: 'me' | 'all'
  onOwner: (v: 'me' | 'all') => void
  due: DueFilter
  onDue: (v: DueFilter) => void
  counts: ChipCounts | null
  source: string
  sources: string[]
  onSource: (v: string) => void
  hold: boolean
  onHold: (v: boolean) => void
  callFlag: boolean
  onCallFlag: (v: boolean) => void
}) {
  const toggleDue = (v: Exclude<DueFilter, ''>) => onDue(due === v ? '' : v)
  return (
    <div className={CHIP_ROW} role="toolbar" aria-label="Фильтры клиентов">
      {canSeeAll && (
        <div className="inline-flex shrink-0 overflow-hidden rounded-full border border-surface-300 dark:border-surface-600" role="group" aria-label="Чьи лиды">
          {(['me', 'all'] as const).map(v => (
            <button
              key={v}
              type="button"
              aria-pressed={owner === v}
              onClick={() => onOwner(v)}
              className={clsx(
                'h-9 px-3.5 text-[13px] font-medium transition-colors max-lg:h-11',
                owner === v
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-50 text-surface-700 hover:bg-surface-100 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700',
              )}
            >
              {v === 'me' ? 'Мои' : 'Все'}
            </button>
          ))}
        </div>
      )}
      <Chip active={due === 'overdue'} onClick={() => toggleDue('overdue')} tone="red">
        <AlertCircle size={14} aria-hidden="true" /> Просрочено <Count n={counts?.overdue ?? null} />
      </Chip>
      <Chip active={due === 'today'} onClick={() => toggleDue('today')} tone="amber">
        <Clock size={14} aria-hidden="true" /> Сегодня <Count n={counts?.today ?? null} />
      </Chip>
      <Chip active={due === 'none'} onClick={() => toggleDue('none')} tone="amber">
        <Flag size={14} aria-hidden="true" /> Без шага <Count n={counts?.none ?? null} />
      </Chip>
      <label className="sr-only" htmlFor="clients-source">Источник</label>
      <select
        id="clients-source"
        value={source}
        onChange={e => onSource(e.target.value)}
        className={clsx(
          'h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium max-lg:h-11',
          source
            ? 'border-primary-600 bg-primary-600 text-white'
            : 'border-surface-300 bg-surface-50 text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200',
        )}
      >
        <option value="">Все источники</option>
        {sources.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <Chip active={hold} onClick={() => onHold(!hold)}>
        <Pause size={14} aria-hidden="true" /> На паузе <Count n={counts?.hold ?? null} />
      </Chip>
      {(callFlag || (counts?.call ?? 0) > 0) && (
        <Chip active={callFlag} onClick={() => onCallFlag(!callFlag)} tone="amber">
          <PhoneCall size={14} aria-hidden="true" /> К звонку <Count n={counts?.call ?? null} />
        </Chip>
      )}
    </div>
  )
}
