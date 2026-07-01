/** Деньги: «12 500 с.» (сомони, без копеек). */
export const money = (v: any) => (Math.round(Number(v) || 0)).toLocaleString('ru-RU') + ' с.'

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

export const DIRECTIONS: { key: string; label: string; color: string }[] = [
  { key: 'smm', label: 'SMM', color: '#16a34a' },
  { key: 'development', label: 'Development', color: '#0ea5e9' },
  { key: 'design', label: 'Design', color: '#a855f7' },
]
export const dirLabel = (k: string) => DIRECTIONS.find(d => d.key === k)?.label || k
