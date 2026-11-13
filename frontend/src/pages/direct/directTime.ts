/** Время в «Директе»: по часам сотрудника (в CRM все в Душанбе). */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** В списке чатов: «14:05» сегодня, «вчера», иначе «3 нояб». */
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now.getTime() - DAY)
  if (sameDay(d, yesterday)) return 'вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

/** Время сообщения: «14:05». */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Разделитель дней в переписке: «Сегодня», «Вчера», «3 ноября». */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return 'Сегодня'
  if (sameDay(d, new Date(now.getTime() - DAY))) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Длительность словами: «3 мин», «2 ч 15 мин», «1 д 4 ч». */
export function duration(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < MINUTE) return 'меньше минуты'
  if (safe < HOUR) return `${Math.floor(safe / MINUTE)} мин`
  if (safe < DAY) {
    const h = Math.floor(safe / HOUR)
    const m = Math.floor((safe % HOUR) / MINUTE)
    return m ? `${h} ч ${m} мин` : `${h} ч`
  }
  const d = Math.floor(safe / DAY)
  const h = Math.floor((safe % DAY) / HOUR)
  return h ? `${d} д ${h} ч` : `${d} д`
}

/** Как в Instagram: «сейчас», «5 мин», «3 ч», «2 д», «4 нед». */
export function shortAgo(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  if (ms < MINUTE) return 'сейчас'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} мин`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} ч`
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)} д`
  return `${Math.floor(ms / (7 * DAY))} нед`
}

/** Секунды из статистики — коротко. */
export function seconds(value: number | null | undefined): string {
  if (value == null) return '—'
  return duration(value * 1000)
}
