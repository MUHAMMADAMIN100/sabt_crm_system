// Общие утилиты раздела СММ (Умный календарь + страницы проектов):
// палитра/цвет проекта и границы месячного цикла. Алгоритм совпадает с
// SmmPage — те же цвета на всех страницах.

export const PROJ_COLORS = ['#e0865a', '#d9b74a', '#a7c14f', '#5fbd80', '#3fb6a0', '#4aa6cf', '#6f8bea', '#9a7be0', '#c77be0', '#e07ac0', '#e07a90', '#d0616a', '#c08a5a', '#8a97a6']

const _projColorMap = new Map<string, string>()
export function assignProjectColors(ids: string[]): void {
  const uniq = [...new Set(ids.map(String))].sort()
  _projColorMap.clear()
  uniq.forEach((id, i) => _projColorMap.set(id, PROJ_COLORS[i % PROJ_COLORS.length]))
}
export function projColor(id: string): string {
  const mapped = _projColorMap.get(String(id))
  if (mapped) return mapped
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PROJ_COLORS[h % PROJ_COLORS.length]
}
export function projFill(id: string): { background: string; color: string } {
  const c = projColor(id)
  return { background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }
}

// Границы цикла, в который попадает опорная дата ref, по дню старта anchor.
export function cycleBoundsFor(ref: Date, anchor: number): { start: string; end: string } {
  const dim = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
  const y = ref.getFullYear(), m = ref.getMonth(), d = ref.getDate()
  const anchorThis = Math.min(anchor, dim(y, m))
  let sy = y, sm = m
  if (d < anchorThis) { sm -= 1; if (sm < 0) { sm = 11; sy -= 1 } }
  const sAnchor = Math.min(anchor, dim(sy, sm))
  const start = new Date(sy, sm, sAnchor)
  const nAnchor = Math.min(anchor, dim(start.getFullYear(), start.getMonth() + 1))
  const end = new Date(start.getFullYear(), start.getMonth() + 1, nAnchor)
  end.setDate(end.getDate() - 1)
  const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end) }
}

/** ISO даты дня-старта цикла в месяце ref со сдвигом monthsBack
 *  (0 = этот месяц, 1 = прошлый). День клампится к длине месяца. */
export function cycleAnchorIso(day: number, ref: Date, monthsBack = 0): string {
  const d = new Date(ref.getFullYear(), ref.getMonth() - monthsBack, 1)
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const dd = Math.min(day, dim)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** Активный цикл проекта. Если задан якорь и сегодня РАНЬШЕ него — берём цикл,
 *  начинающийся с якоря (планируем предстоящий цикл); иначе — цикл, содержащий
 *  сегодня (сам сдвигается помесячно). Без якоря — старое поведение. */
export function activeCycle(day: number, anchorIso: string | null | undefined, ref: Date): { start: string; end: string } {
  const iso = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`
  if (anchorIso && /^\d{4}-\d{2}-\d{2}$/.test(anchorIso) && iso < anchorIso) {
    return cycleBoundsFor(new Date(anchorIso + 'T00:00:00'), day)
  }
  return cycleBoundsFor(ref, day)
}

const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export function fmtCycleRange(startIso: string, endIso: string): string {
  const s = new Date(startIso + 'T00:00:00'), e = new Date(endIso + 'T00:00:00')
  return `${s.getDate()} ${MON[s.getMonth()]} — ${e.getDate()} ${MON[e.getMonth()]}`
}

export type SmmProj = {
  id: string; name: string
  cycleStartDay?: number | null; normReels?: number | null; normPosts?: number | null
  startDate?: string | null; endDate?: string | null
}
