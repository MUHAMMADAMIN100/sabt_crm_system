export const money = (v: any) => (Math.round(Number(v) || 0)).toLocaleString('ru-RU') + ' сом.'

const MONTHS_LONG = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
export const shiftYm = (ym: string, delta: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
export const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_LONG[m - 1]} ${y}` }
export const monthShort = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` }
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` } }

export const ACCOUNT_OPTIONS = [
  { value: 'alif', label: 'Alif' },
  { value: 'dushanbe_city', label: 'Dushanbe City' },
  { value: 'cash', label: 'Наличные' },
]
