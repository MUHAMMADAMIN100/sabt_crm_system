/** Деньги: «12 500 с.» (сомони, без копеек). withSign — ведущий «+» для положительных. */
export const money = (v: any, withSign = false) => {
  const n = Math.round(Number(v) || 0)
  const s = n.toLocaleString('ru-RU') + ' с.'
  return withSign && n > 0 ? '+' + s : s
}

const MONTHS_LONG = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

/** Текущий месяц YYYY-MM. */
export const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
/** Сдвиг месяца на delta. */
export const shiftYm = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** «Июль 2026». */
export const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_LONG[m - 1]} ${y}` }
/** Дата сегодня в формате input[type=date]. */
export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Последний день месяца ym в ISO (`2026-02` → `2026-02-28`).
 *  Нельзя писать `${ym}-31`: для коротких месяцев это невалидная дата → 500. */
export const monthEndISO = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

export const DIRECTIONS: { key: string; label: string; color: string }[] = [
  { key: 'smm', label: 'SMM', color: '#16a34a' },
  { key: 'development', label: 'Development', color: '#0ea5e9' },
  { key: 'design', label: 'Design', color: '#a855f7' },
]
export const dirLabel = (k: string) => DIRECTIONS.find(d => d.key === k)?.label || k

/** YYYY-MM из ISO-даты. */
export const ymOf = (iso: string) => (iso || '').slice(0, 7)

/** «09 июн 2026» из ISO-даты (как в эталоне: короткий месяц без точки, без « г.»). */
export const formatDate = (iso?: string) => {
  if (!iso) return '—'
  const d = new Date(iso.slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const month = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
  return `${day} ${month} ${d.getFullYear()}`
}

/** Тип операции → подпись/цвет/знак. */
export const TYPE_LABEL: Record<string, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление' }
export const TYPE_COLOR: Record<string, string> = {
  income: 'text-green-600 dark:text-green-400',
  expense: 'text-red-600 dark:text-red-400',
  transfer: 'text-blue-600 dark:text-blue-400',
  saving: 'text-purple-600 dark:text-purple-400',
}
export const TYPE_SIGN: Record<string, string> = { income: '+', expense: '−', transfer: '', saving: '' }

/** Направление дохода / статья расхода → подпись и цвет (для дашборда и детализации). */
export const GROUP_META: Record<string, { label: string; color: string }> = {
  smm: { label: 'SMM', color: '#16a34a' },
  development: { label: 'Development', color: '#0ea5e9' },
  design: { label: 'Design', color: '#a855f7' },
  salary: { label: 'Зарплата', color: '#f97316' },
  rent_subs: { label: 'Аренда и подписки', color: '#e11d48' },
  debts: { label: 'Долги', color: '#d97706' },
}
export const groupLabel = (g?: string) => (g && GROUP_META[g]?.label) || g || '—'
