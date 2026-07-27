import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

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

/** Число без «с.» — для плотных ячеек (календарь транзакций). */
export function moneyBare(n: number): string {
  const v = Number(n) || 0
  return Number.isInteger(v) ? nf.format(v) : nf2.format(v)
}

export function todayISO(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const ymOf = (iso: string): string => (iso || '').slice(0, 7)
export const currentYm = (): string => ymOf(todayISO())

/** Период зарплатной ведомости для даты — цикл «10-е → 10-е»: дата на/до
 *  10-го числа относится к ПРЕДЫДУЩЕМУ месяцу (тот цикл закрывается 10-го),
 *  после 10-го — к текущему. Только для ЗП. */
export function salaryPeriodOf(iso: string): string {
  const [y, m, d] = (iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ymOf(iso)
  if (d <= 10) { const dt = new Date(y, m - 2, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` }
  return `${y}-${String(m).padStart(2, '0')}`
}
export const currentSalaryYm = (): string => salaryPeriodOf(todayISO())

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
  { key: 'development', label: 'Development', icon: 'development', color: '#2563eb' },
  { key: 'design', label: 'Design', icon: 'design', color: '#a855f7' },
]

export const EXPENSE_GROUPS: GroupMeta[] = [
  { key: 'salary', label: 'Зарплата', icon: 'banknote', color: '#f59e0b' },
  { key: 'rent_subs', label: 'Аренда и подписки', icon: 'building', color: '#8b5cf6' },
  { key: 'debts', label: 'Долги', icon: 'receipt', color: '#e11d48' },
]

export const OTHER_GROUP: GroupMeta = { key: 'other', label: 'Прочее', icon: 'box', color: '#64748b' }

export const TYPE_LABEL: Record<string, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  saving: 'Накопление',
}

/** Палитра из 8 цветов для счетов/категорий (модалки настроек). */
export const COLOR_PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#6366f1']

/** Человекочитаемый текст ошибки API — единый для всего раздела. */
export function apiErr(e: any): string {
  const m = e?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return m || e?.message || 'Ошибка'
}

/** Скачать CSV (BOM + «;» — чтобы Excel с кириллицей открывал без танцев). */
export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = '\uFEFF' + rows.map(r => r.map(esc).join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Выбранный месяц хранится в адресе страницы (?ym=2026-08).
 *
 *  Так он переживает переход в карточку («Расход» → «Зарплата»), кнопку
 *  «назад» и обновление страницы: раньше карточка всегда открывалась на
 *  текущем месяце, даже если в списке был выбран другой.
 *
 *  fallback — с какого месяца начинать, если в адресе ничего нет
 *  (у зарплаты это currentSalaryYm, у остальных — currentYm).
 */
export function useYmParam(fallback?: string): [string, (ym: string) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('ym') || ''
  const ym = /^\d{4}-\d{2}$/.test(raw) ? raw : (fallback || currentYm())
  const setYm = useCallback((next: string) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('ym', next)
      return p
    }, { replace: true })
  }, [setParams])
  return [ym, setYm]
}

/** Тот же месяц дописываем к ссылке при переходе в карточку раздела. */
export function withYm(path: string, ym: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}ym=${ym}`
}

/** Комментарий к зарплатной операции.
 *
 *  Тип операции (зарплата / аванс / бонус) бэкенд распознаёт по НАЧАЛУ
 *  комментария, поэтому маркер обязан остаться первым словом, а заметка
 *  пользователя дописывается после тире. Затрёшь маркер — операция выпадет
 *  из своей колонки в ведомости и попортит расчёт «к выплате».
 */
export function salaryComment(marker: string, note?: string): string {
  const clean = (note || '').trim()
  return clean ? `${marker} — ${clean}` : marker
}

