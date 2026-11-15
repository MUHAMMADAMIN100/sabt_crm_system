/**
 * Единая воронка продаж (15.11.2026): этапы, подписи, цвета, вероятности,
 * причины проигрыша, итоги звонка. Один источник для Панели, Клиентов,
 * карточки лида, Календаря и аналитики — цвета одного состояния больше не
 * расходятся по экранам. Договор — docs/SALES_SPEC.md.
 *
 * Цвета — классы Tailwind с тёмным вариантом (тема компании тёмная).
 */
import type { AgendaKind, CallOutcome, CallResult, LeadStatus, LostReason } from '@/types/sales'

export interface StageMeta {
  value: LeadStatus
  label: string
  /** Бейдж: фон + текст. */
  badge: string
  /** Сплошной цвет полосы колонки / точки. */
  bar: string
  /** Вероятность по умолчанию, %. */
  probability: number
}

/** Этапы по порядку (без проигрыша). */
export const FUNNEL_STAGES: StageMeta[] = [
  { value: 'new',      label: 'Новый',    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',       bar: 'bg-blue-400',    probability: 10 },
  { value: 'waiting',  label: 'Контакт',  badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',   bar: 'bg-amber-400',   probability: 25 },
  { value: 'meeting',  label: 'Встреча',  badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', bar: 'bg-violet-400', probability: 40 },
  { value: 'proposal', label: 'КП',       badge: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',       bar: 'bg-cyan-400',    probability: 60 },
  { value: 'contract', label: 'Договор',  badge: 'bg-primary-100 text-primary-700 dark:bg-primary-100 dark:text-primary-300', bar: 'bg-primary-400', probability: 80 },
  { value: 'won',      label: 'Выиграно', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',   bar: 'bg-green-400',   probability: 100 },
]

export const LOST_STAGE: StageMeta = {
  value: 'lost', label: 'Проиграно', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', bar: 'bg-red-400', probability: 0,
}

/** Этапы, которые можно выбрать (воронка + проигрыш). */
export const ALL_STAGES: StageMeta[] = [...FUNNEL_STAGES, LOST_STAGE]

/** Активные этапы (сделка ещё идёт). */
export const ACTIVE_STATUSES: LeadStatus[] = ['new', 'waiting', 'meeting', 'proposal', 'contract']

/** Устаревшие значения из старых данных → этап воронки. */
const LEGACY: Partial<Record<LeadStatus, LeadStatus>> = { negotiating: 'waiting', on_hold: 'waiting', unknown: 'new' }

export function normalizeStatus(s: LeadStatus | string | null | undefined): LeadStatus {
  const v = (s || 'new') as LeadStatus
  return LEGACY[v] ?? v
}

export function stageMeta(s: LeadStatus | string | null | undefined): StageMeta {
  const v = normalizeStatus(s)
  return ALL_STAGES.find(x => x.value === v) ?? FUNNEL_STAGES[0]
}

/** Следующий этап воронки (у won/lost — нет). */
export function nextStage(s: LeadStatus | string | null | undefined): StageMeta | null {
  const v = normalizeStatus(s)
  const i = FUNNEL_STAGES.findIndex(x => x.value === v)
  if (i < 0 || i >= FUNNEL_STAGES.length - 2) return null // contract → won — через «Передать в работу»
  return FUNNEL_STAGES[i + 1]
}

export function isActive(s: LeadStatus | string | null | undefined): boolean {
  return ACTIVE_STATUSES.includes(normalizeStatus(s))
}

/** Вероятность лида: своя или по этапу. */
export function probabilityOf(lead: { status: LeadStatus | string; probability?: number | null }): number {
  return lead.probability ?? stageMeta(lead.status).probability
}

export const LOST_REASONS: Array<{ value: LostReason; label: string }> = [
  { value: 'price',       label: 'Дорого' },
  { value: 'competitor',  label: 'Есть подрядчик' },
  { value: 'not_lpr',     label: 'Говорили не с ЛПР' },
  { value: 'no_response', label: 'Пропал, не отвечает' },
  { value: 'not_needed',  label: 'Не нужно сейчас' },
  { value: 'other',       label: 'Другое' },
]

export function lostReasonLabel(r: string | null | undefined): string {
  return LOST_REASONS.find(x => x.value === r)?.label ?? 'Другое'
}

export const CALL_RESULTS: Array<{ value: CallResult; label: string }> = [
  { value: 'reached',   label: 'Дозвонился' },
  { value: 'no_answer', label: 'Не взял' },
  { value: 'busy',      label: 'Занято' },
]

export const CALL_OUTCOMES: Array<{ value: CallOutcome; label: string }> = [
  { value: 'interested', label: 'Интересно' },
  { value: 'wants_kp',   label: 'Просит КП' },
  { value: 'thinking',   label: 'Думает' },
  { value: 'later',      label: 'Неудобно сейчас' },
  { value: 'refused',    label: 'Отказ' },
]

export const AGENDA_KIND_LABEL: Record<AgendaKind, string> = {
  meeting:   'Встреча',
  callback:  'Перезвонить',
  next_step: 'Следующий шаг',
  no_step:   'Нет следующего шага',
  stale:     'Нет касаний 7+ дней',
}

/**
 * Состояния сроков и оплат — одна палитра для всех экранов
 * (просрочено / сегодня / ждём / готово / встреча).
 */
export const STATE_TONE = {
  late:    { dot: 'bg-red-400',    text: 'text-red-600 dark:text-red-300',     badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  today:   { dot: 'bg-amber-400',  text: 'text-amber-700 dark:text-amber-300', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  wait:    { dot: 'bg-blue-400',   text: 'text-blue-700 dark:text-blue-300',   badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  done:    { dot: 'bg-green-400',  text: 'text-green-700 dark:text-green-300', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  meeting: { dot: 'bg-violet-400', text: 'text-violet-700 dark:text-violet-300', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
} as const

export type StateTone = keyof typeof STATE_TONE
