/**
 * Раздел «Продажи» (15.11.2026): форматирование денег, дат и периодов.
 * Даты — по Душанбе (UTC+5, без перехода на летнее время), как на сервере
 * (docs/SALES_SPEC.md: «Даты YYYY-MM-DD — по Душанбе»).
 */

const DUSHANBE_OFFSET_MS = 5 * 3600 * 1000

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const QUARTERS = ['I', 'II', 'III', 'IV']

/** Деньги: «12 300 с.» (неразрывный пробел перед «с.»). */
export function money(n: number | string | null | undefined): string {
  const v = Number(n)
  if (n == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v).toLocaleString('ru-RU')} с.`
}

/** Процент от части: 0, если делить не на что. */
export function percentOf(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/** Русское множественное число: plural(5, 'день', 'дня', 'дней') → «дней». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

/** Календарный день YYYY-MM-DD по Душанбе для момента времени. */
export function dushanbeDay(at: Date | string = new Date()): string {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime()
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + DUSHANBE_OFFSET_MS).toISOString().slice(0, 10)
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Последнее число месяца (month — 1..12). */
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export type SalesPeriod = 'month' | 'quarter' | 'year'
export const SALES_PERIODS: readonly SalesPeriod[] = ['month', 'quarter', 'year']

/** Границы периода, в который попадает день today (YYYY-MM-DD), — целиком:
 *  месяц, квартал или год. */
export function periodRange(period: SalesPeriod, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` }
  if (period === 'quarter') {
    const start = Math.floor((m - 1) / 3) * 3 + 1
    const end = start + 2
    return { from: `${y}-${pad(start)}-01`, to: `${y}-${pad(end)}-${pad(lastDayOf(y, end))}` }
  }
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` }
}

/** Подпись периода: «ноябрь 2026», «IV квартал 2026», «2026 год». */
export function periodLabel(period: SalesPeriod, today: string): string {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  if (period === 'year') return `${y} год`
  if (period === 'quarter') return `${QUARTERS[Math.floor((m - 1) / 3)]} квартал ${y}`
  return `${MONTHS[m - 1]} ${y}`
}

/** Сколько календарных дней (по Душанбе) прошло от at до today. */
export function daysSince(at: string, today: string = dushanbeDay()): number {
  const day = dushanbeDay(at)
  if (!day) return 0
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)
  return Math.max(0, Math.round(diff / 86_400_000))
}

/** «передано сегодня / вчера / N дней назад». */
export function handedOverAgo(at: string, today: string = dushanbeDay()): string {
  const n = daysSince(at, today)
  if (n === 0) return 'передано сегодня'
  if (n === 1) return 'передано вчера'
  return `передано ${n} ${plural(n, 'день', 'дня', 'дней')} назад`
}

/** «20 ноября» (год — если не текущий): для дат YYYY-MM-DD. */
export function dayLabel(day: string | null | undefined, today: string = dushanbeDay()): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '—'
  const y = day.slice(0, 4)
  const m = Number(day.slice(5, 7))
  const d = Number(day.slice(8, 10))
  return `${d} ${MONTHS_GEN[m - 1]}${y !== today.slice(0, 4) ? ` ${y}` : ''}`
}

/** Сумма заявки: SMM — в месяц, разработка — за проект. */
export function handoffAmount(amount: number | string | null | undefined, direction: 'smm' | 'development'): string {
  const s = money(amount)
  return direction === 'smm' && s !== '—' ? `${s}/мес` : s
}

export const DIRECTION_LABEL: Record<'smm' | 'development', string> = {
  smm: 'SMM',
  development: 'Разработка',
}

/** Instagram: «@name» и ссылка на профиль из любого написания. */
export function instagramHandle(raw: string | null | undefined): { handle: string; url: string } | null {
  const v = (raw || '').trim()
  if (!v) return null
  const h = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')
  if (!h) return null
  return { handle: `@${h}`, url: `https://instagram.com/${encodeURIComponent(h)}` }
}

/** Телефон для ссылки tel:. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/** Страница проекта по направлению заявки (нет проекта — null). */
export function handoffProjectUrl(h: { direction: 'smm' | 'development'; projectId: string | null }): string | null {
  if (!h.projectId) return null
  return h.direction === 'smm' ? `/smm/projects/${h.projectId}` : `/dev/projects/${h.projectId}`
}
