/**
 * Фильтры и сводка страницы «Клиенты» (15.11.2026). Доска грузит все
 * активные лиды разом (/clients/board), поэтому её фильтры, счётчики чипов
 * и сводка шапки считаются здесь, на клиенте, по тем же правилам, что
 * сервер применяет к /clients/list (см. components/sales/leadUtils).
 */
import { isActive, probabilityOf } from '@/lib/salesStages'
import type { SalesLead } from '@/types/sales'
import { dueOf, leadMatches, moneyValue, nextActionOf } from '@/components/sales/leadUtils'

export type DueFilter = '' | 'overdue' | 'today' | 'none'

export interface BoardFilters {
  q: string
  due: DueFilter
  source: string
  hold: boolean
  callRequested: boolean
}

export function hasFilters(f: BoardFilters): boolean {
  return !!(f.q || f.due || f.source || f.hold || f.callRequested)
}

export function matchBoard(l: SalesLead, f: BoardFilters): boolean {
  if (f.q && !leadMatches(l, f.q)) return false
  if (f.source && (l.leadSource || '') !== f.source) return false
  if (f.callRequested && !l.callRequested) return false
  if (f.hold && !(l.onHold && isActive(l.status))) return false
  if (f.due && dueOf(l) !== f.due) return false
  return true
}

export interface ChipCounts { overdue: number; today: number; none: number; hold: number; call: number }

export function chipCounts(items: SalesLead[]): ChipCounts {
  const c: ChipCounts = { overdue: 0, today: 0, none: 0, hold: 0, call: 0 }
  for (const l of items) {
    const d = dueOf(l)
    if (d) c[d]++
    if (l.onHold && isActive(l.status)) c.hold++
    if (l.callRequested) c.call++
  }
  return c
}

export interface Summary { inWork: number; potential: number; forecast: number }

/** «N в работе · в воронке X · с учётом вероятности ≈ Y» по активным лидам. */
export function summaryOf(items: SalesLead[]): Summary {
  let inWork = 0
  let potential = 0
  let forecast = 0
  for (const l of items) {
    if (!isActive(l.status)) continue
    inWork++
    const p = moneyValue(l.dealPotential)
    potential += p
    forecast += (p * probabilityOf(l)) / 100
  }
  return { inWork, potential, forecast }
}

/** Порядок карточек в колонке: сначала просроченные и ближайшие, без шага — в конце. */
export function byNextAction(a: SalesLead, b: SalesLead): number {
  const ta = nextActionOf(a).at?.getTime() ?? Number.POSITIVE_INFINITY
  const tb = nextActionOf(b).at?.getTime() ?? Number.POSITIVE_INFINITY
  if (ta !== tb) return ta - tb
  return a.name.localeCompare(b.name, 'ru')
}
