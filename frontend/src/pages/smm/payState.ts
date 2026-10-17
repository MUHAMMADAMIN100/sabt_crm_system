// Состояние оплаты клиента словами — для строки «Оплата клиента» в карточке
// SMM-проекта (решение владельца 12.10.2026).
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { ClientPayItem } from '@/services/api.service'

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5)
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}
const longDay = (iso: string) => format(new Date(`${iso}T00:00:00`), 'd MMMM', { locale: ru })

/** Состояние оплаты словами: «просрочено 3 дня», «сегодня», «через 2 дня»,
 *  «оплачено 10 октября». */
export function payStateText(it: Pick<ClientPayItem, 'state' | 'date' | 'paidAt'>, today: string): string {
  if (it.state === 'paid') return `оплачено ${longDay(it.paidAt || it.date)}`
  if (it.state === 'today') return 'сегодня'
  const n = Math.abs(dayDiff(it.date, today))
  if (it.state === 'late') return `просрочено ${n} ${plural(n, 'день', 'дня', 'дней')}`
  return n === 1 ? 'завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}`
}
