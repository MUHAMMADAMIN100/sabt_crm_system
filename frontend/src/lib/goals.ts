/**
 * «Компас компании»: форматирование цифр результатов, статусы и названия
 * отделов (16.11.2026, docs/GOALS_SPEC.md). Общие для страниц компаса,
 * отдела, профиля и редактора целей сотрудника.
 */
import type { CheckinStatus, DeptKey, GoalStatus, KrUnit } from '@/types/goals'

export const DEPARTMENTS: Array<{ key: DeptKey; name: string }> = [
  { key: 'sales', name: 'Продажи' },
  { key: 'smm', name: 'SMM-производство' },
  { key: 'dev', name: 'Разработка' },
  { key: 'management', name: 'Управление и финансы' },
]

export const DEPT_NAME: Record<DeptKey, string> = Object.fromEntries(
  DEPARTMENTS.map(d => [d.key, d.name]),
) as Record<DeptKey, string>

export function isDeptKey(v: unknown): v is DeptKey {
  return typeof v === 'string' && v in DEPT_NAME
}

/** Цвета и подписи статусов — светлая и тёмная тема, как этапы в salesStages. */
export const STATUS_META: Record<GoalStatus, { label: string; text: string; bg: string; bar: string }> = {
  on_track:  { label: 'в графике',    text: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40', bar: 'bg-green-400' },
  done:      { label: 'выполнено',    text: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40', bar: 'bg-green-400' },
  at_risk:   { label: 'риск',         text: 'text-amber-800 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40', bar: 'bg-amber-400' },
  off_track: { label: 'отстаём',      text: 'text-red-700 dark:text-red-300',     bg: 'bg-red-100 dark:bg-red-900/40',     bar: 'bg-red-400' },
  missed:    { label: 'не выполнено', text: 'text-red-700 dark:text-red-300',     bg: 'bg-red-100 dark:bg-red-900/40',     bar: 'bg-red-400' },
  none:      { label: 'нет данных',   text: 'text-gray-600 dark:text-gray-400',   bg: 'bg-surface-100 dark:bg-surface-700', bar: 'bg-gray-500' },
}

/** Подписи кнопок отметки недели — как на макете PhoneCheckin. */
export const CHECKIN_OPTIONS: Array<{ value: CheckinStatus; label: string }> = [
  { value: 'on_track', label: 'В графике' },
  { value: 'at_risk', label: 'Риск' },
  { value: 'off_track', label: 'Отстаём' },
]

/** Порядок «хуже → лучше» для сортировки и сводного статуса. */
const SEVERITY: Record<GoalStatus, number> = { off_track: 5, missed: 5, at_risk: 4, on_track: 3, done: 2, none: 1 }

export function worstStatus(list: GoalStatus[]): GoalStatus {
  return list.reduce<GoalStatus>((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), 'none')
}

export function bySeverity(a: GoalStatus, b: GoalStatus): number {
  return SEVERITY[b] - SEVERITY[a]
}

/** Число с пробелами: 141 000. */
function num(n: number, digits = 0): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

/** Значение результата: «141 000 с.», «93 %», «11». null → «—». */
export function formatValue(value: number | null | undefined, unit: KrUnit): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const v = Number(value)
  if (unit === 'money') return `${num(Math.round(v))} с.`
  if (unit === 'percent') return `${num(v, 1)} %`
  return num(v, 1)
}

/** Цель результата: «300 000 с.», «≤ 5 %» для «меньше — лучше». */
export function formatTarget(target: number, unit: KrUnit, kind: 'sum' | 'rate' | 'lower'): string {
  const t = formatValue(target, unit)
  return kind === 'lower' ? `≤ ${t}` : t
}

/** Тренд за неделю: «+18 000 с. за неделю», «−1 п. за неделю», «без изменений». */
export function formatTrend(trend: number | null | undefined, unit: KrUnit): string | null {
  if (trend == null || !Number.isFinite(Number(trend))) return null
  const t = Number(trend)
  if (Math.abs(t) < 0.05) return 'без изменений'
  const sign = t > 0 ? '+' : '−'
  const abs = Math.abs(t)
  const body = unit === 'percent' ? `${num(abs, 1)} п.` : unit === 'money' ? `${num(Math.round(abs))} с.` : num(abs, 1)
  return `${sign}${body} за неделю`
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

/** «ноябрь 2026». */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${y}`
}

/** «в ноябре». */
export function monthPrep(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return `в ${MONTHS_PREP[(m || 1) - 1]}`
}

/** Сдвиг месяца: shiftYm('2026-11', -1) → '2026-10'. */
export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Текущий месяц по Душанбе (UTC+5). */
export function currentYm(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

/** Ширина полосы: 0–100, null → 0. */
export function barWidth(progress: number | null | undefined): number {
  if (progress == null || !Number.isFinite(Number(progress))) return 0
  return Math.max(0, Math.min(100, Number(progress)))
}

// ── Подписи дат и чисел для экранов компаса (16.11.2026) ─────────────

/** Склонение по числу: pluralRu(3, 'день', 'дня', 'дней') → «дня». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

/** «1 день», «3 дня», «14 дней». */
export function daysLabel(n: number): string {
  return `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** «16 ноября» из YYYY-MM-DD. */
export function dayMonthLabel(ymd: string): string {
  const m = Number(ymd.slice(5, 7))
  const d = Number(ymd.slice(8, 10))
  if (!m || !d) return ymd
  return `${d} ${MONTHS_GEN[m - 1]}`
}

/** Понедельник недели дня YYYY-MM-DD (календарный день, без часовых поясов). */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Отметка недели у результата: «статус: пн» — на этой неделе (день отметки
 *  по Душанбе), «статус: 9 ноября» — отметка прошлой недели, «не отмечен». */
export function checkinLabel(checkin: { weekStart: string; at: string } | null | undefined, today: string): string {
  if (!checkin) return 'не отмечен'
  const t = Date.parse(checkin.at)
  const local = Number.isNaN(t) ? null : new Date(t + 5 * 3600 * 1000)
  if (checkin.weekStart === mondayOf(today)) {
    return local ? `статус: ${WEEKDAYS_SHORT[local.getUTCDay()]}` : 'статус отмечен'
  }
  return `статус: ${dayMonthLabel(local ? local.toISOString().slice(0, 10) : checkin.weekStart)}`
}
