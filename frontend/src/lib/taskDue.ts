/**
 * Сроки задач: быстрая форма SMM-специалиста и строки раздела «Задачи»
 * (docs/SMM_DELEGATION_SPEC.md, 17.11.2026).
 *
 * Время — «настенное» Душанбе: UTC+5 круглый год, без перевода часов (так же
 * считает TaskForm). На сервер уходит абсолютный момент ISO, на экран —
 * день и время по Душанбе, где бы ни стоял телефон. Считаем сдвигом на
 * 5 часов, а не через Intl: результат не зависит от часового пояса
 * устройства и от того, есть ли в браузере база часовых поясов.
 */

const DUSHANBE_OFFSET_MS = 5 * 3600_000
const DUSHANBE_OFFSET = '+05:00'
const DAY_MS = 86400_000

export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** Срок по умолчанию — до 18:00 выбранного дня. */
export const DEFAULT_DUE_TIME = '18:00'

/** Склонение: 1 день, 2 дня, 5 дней. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

/** День 'YYYY-MM-DD' и время 'HH:MM' момента по Душанбе. */
export function dushanbeParts(d: Date): { ymd: string; hm: string } {
  const s = new Date(d.getTime() + DUSHANBE_OFFSET_MS).toISOString()
  return { ymd: s.slice(0, 10), hm: s.slice(11, 16) }
}

/** Сегодня по Душанбе, 'YYYY-MM-DD'. */
export function dushanbeToday(now: Date = new Date()): string {
  return dushanbeParts(now).ymd
}

const ymdUtc = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** День через n дней ('2026-11-30' + 1 → '2026-12-01'). */
export function addDays(ymd: string, n: number): string {
  return new Date(ymdUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Сколько дней от a до b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((ymdUtc(b) - ymdUtc(a)) / DAY_MS)
}

/** «18 ноября»; год — только если он не текущий (todayYmd). */
export function dayMonth(ymd: string, todayYmd?: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = `${d} ${MONTHS_GEN[m - 1] ?? ''}`
  return todayYmd && todayYmd.slice(0, 4) !== ymd.slice(0, 4) ? `${base} ${y}` : base
}

// ─── Быстрая форма: кнопки «Срок» ─────────────────────────────────────

export type DuePreset = 'today' | 'tomorrow' | 'week' | 'date'

export const DUE_PRESETS: ReadonlyArray<{ key: DuePreset; label: string }> = [
  { key: 'today', label: 'Сегодня' },
  { key: 'tomorrow', label: 'Завтра' },
  { key: 'week', label: 'Через неделю' },
  { key: 'date', label: 'Дата…' },
]

/** День и время срока по нажатой кнопке. «Сегодня» после 18:00 — до конца
 *  дня: иначе задача рождалась бы уже просроченной. «Дата…» без выбранного
 *  дня — null (кнопка «Поставить» неактивна). */
export function resolveDue(
  preset: DuePreset,
  now: Date,
  custom?: { date: string; time?: string },
): { date: string; time: string } | null {
  const { ymd, hm } = dushanbeParts(now)
  switch (preset) {
    case 'today':
      return { date: ymd, time: hm >= DEFAULT_DUE_TIME ? '23:59' : DEFAULT_DUE_TIME }
    case 'tomorrow':
      return { date: addDays(ymd, 1), time: DEFAULT_DUE_TIME }
    case 'week':
      return { date: addDays(ymd, 7), time: DEFAULT_DUE_TIME }
    case 'date': {
      if (!custom || !/^\d{4}-\d{2}-\d{2}$/.test(custom.date)) return null
      const time = custom.time && /^\d{2}:\d{2}$/.test(custom.time) ? custom.time : DEFAULT_DUE_TIME
      return { date: custom.date, time }
    }
    default:
      return null
  }
}

/** Срок для сервера: день и время по Душанбе → ISO в UTC. */
export function deadlineIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00${DUSHANBE_OFFSET}`).toISOString()
}

/** Подпись под кнопками срока: «сегодня, до 18:00» / «18 ноября, до 18:00». */
export function dueCaption(date: string, time: string, now: Date): string {
  const today = dushanbeToday(now)
  const day = daysBetween(today, date) === 0 ? 'сегодня' : dayMonth(date, today)
  return `${day}, до ${time}`
}

// ─── Строки раздела «Задачи» ──────────────────────────────────────────

/** Срок открытой задачи: «до 21 ноября», «завтра до 18:00»,
 *  «просрочено на 1 день». late — показать красным. */
export function dueLabel(deadline: string | null | undefined, now: Date): { text: string; late: boolean } {
  if (!deadline) return { text: 'без срока', late: false }
  const d = new Date(deadline)
  if (isNaN(d.getTime())) return { text: 'без срока', late: false }
  const { ymd, hm } = dushanbeParts(d)
  const today = dushanbeToday(now)
  if (d.getTime() < now.getTime()) {
    const days = daysBetween(ymd, today)
    return {
      text: days <= 0 ? 'просрочено сегодня' : `просрочено на ${days} ${pluralRu(days, 'день', 'дня', 'дней')}`,
      late: true,
    }
  }
  const diff = daysBetween(today, ymd)
  if (diff === 0) return { text: `сегодня до ${hm}`, late: false }
  if (diff === 1) return { text: `завтра до ${hm}`, late: false }
  return { text: `до ${dayMonth(ymd, today)}`, late: false }
}

/** Когда что-то случилось: «сегодня», «вчера», «12 ноября»;
 *  withTime — «сегодня в 15:40». Пустая строка, если даты нет. */
export function whenLabel(at: string | null | undefined, now: Date, withTime = false): string {
  if (!at) return ''
  const d = new Date(at)
  if (isNaN(d.getTime())) return ''
  const { ymd, hm } = dushanbeParts(d)
  const today = dushanbeToday(now)
  const diff = daysBetween(ymd, today)
  const day = diff === 0 ? 'сегодня' : diff === 1 ? 'вчера' : dayMonth(ymd, today)
  return withTime ? `${day} в ${hm}` : day
}
