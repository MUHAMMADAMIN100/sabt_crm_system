// «Доход → SMM»: порядок строк, тон срока и короткие даты — чистые функции
// таблицы «менеджер · срок · оплата» (макет владельца 13.10.2026).
import { daysUntil } from './finlib'

/** Срок строки с сервера: ближайшая неоплаченная оплата клиента. */
export type SmmDue = { date: string; state: 'late' | 'today' | 'wait'; planned: boolean } | null

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const day = (iso: string, short: boolean) => {
  const d = Number(iso.slice(8, 10))
  const m = MONTHS[Number(iso.slice(5, 7)) - 1]
  if (!d || !m) return '—'
  return `${d} ${short ? m.slice(0, 3) : m}`
}
/** «23 сентября» — срок без года: год ясен из выбранного месяца. */
export const dayMonth = (iso?: string | null) => (iso ? day(iso, false) : '—')
/** «6 окт» — короткая дата для карточек на телефоне. */
export const dayMon = (iso?: string | null) => (iso ? day(iso, true) : '—')

/** Тон срока: просрочено — красный, сегодня и ближайшие три дня — янтарный,
 *  дальше — спокойный. */
export function dueTone(due: SmmDue): 'late' | 'soon' | 'wait' | null {
  if (!due) return null
  if (due.state === 'late') return 'late'
  const d = daysUntil(due.date)
  return d !== null && d <= 3 ? 'soon' : 'wait'
}

const RANK = { late: 0, today: 1, wait: 2 } as const
const rank = (r: any) => (r.due ? RANK[r.due.state as keyof typeof RANK] ?? 3 : 3)

/** Две группы таблицы. «Ждём оплату» — по срочности: просроченные (самые
 *  давние первыми), сегодня, ближайшие; без срока — в конце. «Оплачено» —
 *  в порядке сервера (свежая оплата сверху). */
export function splitSmmRows<T extends { fullyPaid?: boolean; due?: SmmDue; project: { name: string } }>(rows: T[]) {
  const unpaid = rows.filter(r => !r.fullyPaid).sort((a, b) =>
    rank(a) - rank(b)
    || (a.due?.date || '9999').localeCompare(b.due?.date || '9999')
    || (a.project.name < b.project.name ? -1 : a.project.name > b.project.name ? 1 : 0))
  const paid = rows.filter(r => !!r.fullyPaid)
  return { unpaid, paid }
}

/** Просроченные строки — для красной строки над таблицей. */
export const overdueRows = <T extends { fullyPaid?: boolean; due?: SmmDue }>(rows: T[]) =>
  rows.filter(r => !r.fullyPaid && r.due?.state === 'late')
