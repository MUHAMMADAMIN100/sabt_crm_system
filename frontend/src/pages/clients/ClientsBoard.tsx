import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { FUNNEL_STAGES, LOST_STAGE, lostReasonLabel, normalizeStatus, type StageMeta } from '@/lib/salesStages'
import type { LeadStatus, SalesLead } from '@/types/sales'
import { formatMoney, moneyValue } from '@/components/sales/leadUtils'
import BoardCard from './BoardCard'
import { byNextAction } from './boardFilters'

const COLUMNS: StageMeta[] = [...FUNNEL_STAGES, LOST_STAGE]

/**
 * Доска «Единая воронка» (15.11.2026): Новый → Контакт → Встреча → КП →
 * Договор → Выиграно, «Проиграно» свёрнута (число и главные причины).
 * В шапке колонки — число, сумма и вероятность этапа. На телефоне колонки
 * листаются вбок с примагничиванием.
 */
export default function ClientsBoard({ items, onOpen, onAdvance, onDrop, canMove, desktop }: {
  items: SalesLead[]
  onOpen: (lead: SalesLead) => void
  onAdvance: (lead: SalesLead) => void
  /** Карточку бросили в колонку (только компьютер). */
  onDrop: (lead: SalesLead, to: LeadStatus) => void
  canMove: (lead: SalesLead) => boolean
  desktop: boolean
}) {
  const [dragged, setDragged] = useState<SalesLead | null>(null)
  const [over, setOver] = useState<LeadStatus | null>(null)
  const [lostOpen, setLostOpen] = useState(false)

  const byCol = useMemo(() => {
    const map = new Map<LeadStatus, SalesLead[]>()
    for (const c of COLUMNS) map.set(c.value, [])
    for (const l of items) map.get(normalizeStatus(l.status))?.push(l)
    for (const list of map.values()) list.sort(byNextAction)
    return map
  }, [items])

  const drop = (to: LeadStatus) => {
    setOver(null)
    const l = dragged
    setDragged(null)
    if (l && normalizeStatus(l.status) !== to) onDrop(l, to)
  }

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 lg:mx-0 lg:snap-none lg:px-0" style={{ WebkitOverflowScrolling: 'touch' }}>
      {COLUMNS.map(col => {
        const list = byCol.get(col.value) ?? []
        const isLost = col.value === 'lost'
        const collapsed = isLost && !lostOpen
        const sum = list.reduce((a, l) => a + moneyValue(l.dealPotential), 0)
        const dropOk = desktop && !!dragged
        const reasons = isLost ? topReasons(list) : []
        const headId = `col-${col.value}`
        return (
          <section
            key={col.value}
            aria-labelledby={headId}
            onDragOver={dropOk ? e => { e.preventDefault(); if (over !== col.value) setOver(col.value) } : undefined}
            onDragLeave={dropOk ? () => setOver(o => (o === col.value ? null : o)) : undefined}
            onDrop={dropOk ? e => { e.preventDefault(); drop(col.value) } : undefined}
            className={clsx(
              'flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col rounded-xl bg-surface-100/70 p-2.5 dark:bg-surface-900/50',
              isLost && !lostOpen ? 'lg:w-[200px]' : 'lg:w-[260px]',
              over === col.value && 'ring-2 ring-primary-500',
            )}
          >
            <header className="mb-2 px-1">
              <div className="flex items-center gap-2">
                <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', col.bar)} aria-hidden="true" />
                <h3 id={headId} className="text-sm font-semibold text-surface-900 dark:text-surface-50">{col.label}</h3>
                <span className="ml-auto rounded-full bg-surface-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-surface-700 dark:bg-surface-700 dark:text-surface-200">
                  {list.length}
                </span>
              </div>
              {!isLost && (
                <p className="mt-0.5 text-xs tabular-nums text-surface-500 dark:text-surface-400">
                  {formatMoney(sum)} · вероятность {col.probability} %
                </p>
              )}
            </header>

            {isLost && (
              <div className="px-1">
                {reasons.length > 0 && (
                  <ul className="mb-2 space-y-0.5 text-xs text-surface-600 dark:text-surface-300" aria-label="Главные причины">
                    {reasons.map(r => <li key={r.label} className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="tabular-nums">{r.count}</span></li>)}
                  </ul>
                )}
                {list.length > 0 && (
                  <button type="button" onClick={() => setLostOpen(o => !o)} aria-expanded={lostOpen}
                    className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-primary-700 hover:underline dark:text-primary-300 lg:min-h-[32px]">
                    <ChevronDown size={14} aria-hidden="true" className={clsx('transition-transform', lostOpen && 'rotate-180')} />
                    {lostOpen ? 'Свернуть' : 'Показать карточки'}
                  </button>
                )}
                {list.length === 0 && <p className="py-3 text-center text-xs text-surface-400">За 30 дней проигрышей нет</p>}
              </div>
            )}

            {!collapsed && (
              <ul className="flex flex-col gap-2">
                {list.map(l => (
                  <li key={l.id}>
                    <BoardCard
                      lead={l}
                      onOpen={onOpen}
                      onAdvance={onAdvance}
                      canMove={canMove(l)}
                      draggable={desktop && canMove(l) && !l.handoffAt}
                      onDragStart={setDragged}
                      onDragEnd={() => { setDragged(null); setOver(null) }}
                      dragging={dragged?.id === l.id}
                    />
                  </li>
                ))}
                {!isLost && list.length === 0 && (
                  <li className="rounded-lg border border-dashed border-surface-300 py-5 text-center text-xs text-surface-400 dark:border-surface-700">
                    {dropOk ? 'Перетащите сюда' : 'Пусто'}
                  </li>
                )}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function topReasons(list: SalesLead[]): Array<{ label: string; count: number }> {
  const m = new Map<string, number>()
  for (const l of list) {
    const k = lostReasonLabel(l.lostReason)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 3)
}

export function BoardSkeleton() {
  return (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 lg:mx-0 lg:px-0" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="w-[85vw] max-w-[300px] shrink-0 space-y-2 rounded-xl bg-surface-100/70 p-2.5 dark:bg-surface-900/50 lg:w-[260px]">
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton h-3 w-1/2" />
          {[0, 1, 2].map(j => <div key={j} className="skeleton h-20 w-full" />)}
        </div>
      ))}
    </div>
  )
}
