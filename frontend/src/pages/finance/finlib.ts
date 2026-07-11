// Утилиты Fin System · WebRand: формат сомони, месяцы, таксономия групп.
// Портировано из эталона fin-webrand/src/lib/{format,constants}.ts.

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function money(n: number, withSign = false): string {
  const v = Number(n) || 0
  const sign = withSign && v > 0 ? '+' : ''
  const abs = Number.isInteger(v) ? nf.format(v) : nf2.format(v)
  // Пробел перед «с.» — неразрывный: с обычным «с.» отрывалось на новую строку
  // в узких ячейках таблиц («3 500» / «с.»).
  return `${sign}${abs} с.`
}

export function todayISO(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const ymOf = (iso: string): string => (iso || '').slice(0, 7)
export const currentYm = (): string => ymOf(todayISO())

/** Сдвиг месяца yyyy-mm на delta месяцев. */
export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d
    .toLocaleDateString('ru-RU', long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' })
    .replace(/\s*г\.?$/i, '')
}

/** День месяца оплаты (1..31) по дате контракта, или null. */
export function contractDay(contractDate?: string | null): number | null {
  if (!contractDate || contractDate.length < 10) return null
  const d = Number(contractDate.slice(8, 10))
  return Number.isFinite(d) && d > 0 ? d : null
}

/** Дней от сегодня до даты (ISO). Отрицательное — дата в прошлом. */
export function daysUntil(iso?: string | null): number | null {
  if (!iso || iso.length < 10) return null
  const target = new Date(iso.slice(0, 10) + 'T00:00:00')
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (isNaN(target.getTime())) return null
  return Math.round((target.getTime() - today.getTime()) / 86400_000)
}

/** «через 12 дн.» / «сегодня» / «просрочено 3 дн.» — подпись к сроку оплаты. */
export function daysLabel(iso?: string | null): string | null {
  const d = daysUntil(iso)
  if (d === null) return null
  if (d === 0) return 'сегодня'
  if (d > 0) return `через ${d} дн.`
  return `просрочено ${-d} дн.`
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const month = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
  return `${day} ${month} ${d.getFullYear()}`
}

// ---------- Таксономия: 3 направления дохода, 3 статьи расхода ----------

export interface GroupMeta { key: string; label: string; icon: string; color: string }

export const INCOME_GROUPS: GroupMeta[] = [
  { key: 'smm', label: 'SMM', icon: 'smm', color: '#16a34a' },
  { key: 'development', label: 'Development', icon: 'development', color: '#0ea5e9' },
  { key: 'design', label: 'Design', icon: 'design', color: '#a855f7' },
]

export const EXPENSE_GROUPS: GroupMeta[] = [
  { key: 'salary', label: 'Зарплата', icon: 'salary', color: '#f97316' },
  { key: 'rent_subs', label: 'Аренда и подписки', icon: 'building', color: '#e11d48' },
  { key: 'debts', label: 'Долги', icon: 'receipt', color: '#d97706' },
]

export const OTHER_GROUP: GroupMeta = { key: 'other', label: 'Прочее', icon: 'arrowRight', color: '#64748b' }

export const TYPE_LABEL: Record<string, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  saving: 'Накопление',
}

/** Палитра из 8 цветов для счетов/категорий (модалки настроек). */
export const COLOR_PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#6366f1']
