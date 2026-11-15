/**
 * Общие помощники экранов продаж (15.11.2026): деньги, «ближайшее действие»
 * лида, даты, роли, справочники формы. Живут отдельно от компонентов, чтобы
 * доска, список, карточка лида и шторки считали одно и то же одинаково —
 * раньше «просрочено» на доске и в списке расходилось.
 */
import { format, formatDistanceToNow, isToday, isTomorrow, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { LeadDirection, SalesLead } from '@/types/sales'
import { isActive } from '@/lib/salesStages'

/** Источники лида. Платный трафик разведён по площадкам: по «Рекламе» не
 *  видно, откуда пришёл лид — с таргета в Instagram или из WhatsApp. */
export const SOURCE_OPTIONS = [
  'Instagram', 'Рекомендация', 'Холодный обзвон', 'Сайт', 'Реклама',
  'Таргет Instagram', 'Таргет WhatsApp', 'Другое',
]
export const SPHERE_SUGGESTIONS = ['Ресторан', 'Кафе', 'Клиника', 'Школа', 'Салон красоты', 'Отель', 'Магазин', 'Блогер', 'Модель', 'SMM', 'Разработка', 'Другое']
export const CHANNEL_OPTIONS = ['WhatsApp', 'Telegram', 'Instagram', 'Звонок', 'Email', 'Личная встреча']
/** Города для селекта «Адрес». «Другое» открывает поле ручного ввода. */
export const ADDRESS_OPTIONS = ['Душанбе']
/** Что продаёт направление разработки — для «Передать в работу». */
export const DEV_PRODUCTS = ['Web сайт', 'Лендинг', 'Телеграм бот', 'CRM система', 'Интернет магазин']

export const DIRECTION_LABEL: Record<LeadDirection, string> = { smm: 'SMM', development: 'Разработка' }

// ── Деньги ──────────────────────────────────────────────────────────

export function moneyValue(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** «12 500 с.» — сомони, без копеек (в продажах копейки только шумят). */
export function formatMoney(v: number | string | null | undefined): string {
  return `${Math.round(moneyValue(v)).toLocaleString('ru-RU')} с.`
}

// ── Роли ────────────────────────────────────────────────────────────

type RoleUser = { id?: string; role?: string | null; secondaryRole?: string | null } | null | undefined

/** Руководство компании — видит и правит любые лиды (как на сервере). */
export function isTopRole(u: RoleUser): boolean {
  return !!u && ['admin', 'founder'].some(r => u.role === r || u.secondaryRole === r)
}

/** Направление менеджера продаж по основной или второй роли. */
export function salesDirectionOf(u: RoleUser): LeadDirection | null {
  if (!u) return null
  const roles = [u.role, u.secondaryRole]
  if (roles.includes('sales_manager_smm')) return 'smm'
  if (roles.includes('sales_manager_dev')) return 'development'
  return null
}

export const SALES_ROLE_BY_DIRECTION: Record<LeadDirection, string> = {
  smm: 'sales_manager_smm',
  development: 'sales_manager_dev',
}

/** Может ли пользователь работать с лидом: владелец, руководство или
 *  любой МП направления для лида без владельца (как SalesService). */
export function canWorkLead(u: RoleUser, lead: Pick<SalesLead, 'ownerId' | 'direction'>): boolean {
  if (!u) return false
  if (isTopRole(u)) return true
  if (lead.ownerId && lead.ownerId === u.id) return true
  const dir = salesDirectionOf(u)
  return !lead.ownerId && !!dir && (!lead.direction || lead.direction === dir)
}

export function initialsOf(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
}

// ── Даты ────────────────────────────────────────────────────────────

/** «сегодня, 15:00» / «завтра, 11:00» / «16 нояб., 15:00» / «3 мар. 2025». */
export function formatAt(d: Date, withTime = true): string {
  const t = withTime ? `, ${format(d, 'HH:mm')}` : ''
  if (isToday(d)) return `сегодня${t}`
  if (isTomorrow(d)) return `завтра${t}`
  if (isYesterday(d)) return `вчера${t}`
  if (d.getFullYear() === new Date().getFullYear()) return `${format(d, 'd MMM', { locale: ru })}${t}`
  return format(d, 'd MMM yyyy', { locale: ru })
}

/** Относительное время для истории: недавно — «5 минут назад», старше
 *  недели — датой. title — точные дата и время. */
export function relTime(iso?: string | null): { text: string; title: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  const title = format(d, 'dd.MM.yyyy, HH:mm')
  if (diff < 60_000) return { text: 'только что', title }
  if (diff <= 7 * 86_400_000) return { text: formatDistanceToNow(d, { addSuffix: true, locale: ru }), title }
  return { text: format(d, 'd MMM yyyy', { locale: ru }), title }
}

/** ISO → значение для <input type="date"> / <input type="time"> по местному
 *  времени (сервер хранит UTC, человек видит своё). */
export function splitLocal(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm') }
}

/** Дата + время из полей формы → ISO. Без времени — 11:00 (начало
 *  рабочего утра; так же предлагают быстрые кнопки). */
export function joinLocal(date: string, time: string): string | null {
  if (!date) return null
  const d = new Date(`${date}T${time || '11:00'}`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Через days дней в hh:mm местного времени. */
export function daysFromNow(days: number, hh = 11, mm = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hh, mm, 0, 0)
  return d
}

export function dateInput(d: Date): string { return format(d, 'yyyy-MM-dd') }

export function endOfToday(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

// ── Ближайшее действие ──────────────────────────────────────────────

export type ActionTone = 'late' | 'today' | 'wait' | 'none'

export interface NextActionInfo {
  kind: 'meeting' | 'callback' | 'step' | null
  at: Date | null
  /** Текст шага (nextStep) — даже если срока нет. */
  text: string | null
  tone: ActionTone
  /** Готовая подпись: «Встреча · сегодня, 15:00». */
  label: string
}

const KIND_WORD = { meeting: 'Встреча', callback: 'Перезвонить', step: 'Шаг' } as const

function validDate(iso?: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

/**
 * «Ближайшее действие» = min(встреча без итога, перезвон, срок шага) — то же
 * правило, что у сервера в /clients/list (SPEC §4). Просрочено — в прошлом,
 * сегодня — по местному дню.
 */
export function nextActionOf(lead: Pick<SalesLead, 'nextContactAt' | 'meetingResult' | 'repeatCallAt' | 'nextStepAt' | 'nextStep' | 'status'>): NextActionInfo {
  const cands: Array<{ kind: 'meeting' | 'callback' | 'step'; at: Date }> = []
  const meeting = lead.meetingResult ? null : validDate(lead.nextContactAt)
  if (meeting) cands.push({ kind: 'meeting', at: meeting })
  const callback = validDate(lead.repeatCallAt)
  if (callback) cands.push({ kind: 'callback', at: callback })
  const step = validDate(lead.nextStepAt)
  if (step) cands.push({ kind: 'step', at: step })
  const text = (lead.nextStep || '').trim() || null

  if (!cands.length) {
    return { kind: null, at: null, text, tone: 'none', label: text ? `${text} · без срока` : 'Нет шага' }
  }
  cands.sort((a, b) => a.at.getTime() - b.at.getTime())
  const first = cands[0]!
  const now = Date.now()
  const tone: ActionTone = first.at.getTime() < now ? 'late' : isToday(first.at) ? 'today' : 'wait'
  const what = first.kind === 'step' && text ? text : KIND_WORD[first.kind]
  const when = formatAt(first.at)
  return {
    kind: first.kind,
    at: first.at,
    text,
    tone,
    label: tone === 'late' ? `${what} · просрочено, ${when}` : `${what} · ${when}`,
  }
}

/** Фильтр «срок» в духе сервера: просрочено / сегодня / без шага. Пауза,
 *  выигранные и проигранные в эти списки не попадают. */
export function dueOf(lead: SalesLead): 'overdue' | 'today' | 'none' | null {
  if (lead.onHold || !isActive(lead.status)) return null
  const a = nextActionOf(lead)
  if (a.tone === 'late') return 'overdue'
  if (a.tone === 'today') return 'today'
  if (a.tone === 'none') return 'none'
  return null
}

/** Классы подписи ближайшего действия (одна палитра для доски и списка). */
export const ACTION_TONE_CLASS: Record<ActionTone, string> = {
  late: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  today: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  wait: 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
  none: 'border border-dashed border-amber-400 text-amber-700 dark:border-amber-500/70 dark:text-amber-300',
}

export const ACTION_TEXT_CLASS: Record<ActionTone, string> = {
  late: 'text-red-600 dark:text-red-300',
  today: 'text-amber-700 dark:text-amber-300',
  wait: 'text-surface-600 dark:text-surface-300',
  none: 'text-amber-700 dark:text-amber-300',
}

// ── Контакты ────────────────────────────────────────────────────────

export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, '')}`
}

/** Ник Instagram без «@» и без адреса профиля. */
export function instagramHandle(v?: string | null): string {
  return (v || '').trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
}

/** Старое поле contactInfo — «собранный текст» для мест, где оно ещё читается. */
export function contactInfoOf(d: { contactPhone?: string | null; contactInstagram?: string | null; contactEmail?: string | null }): string | null {
  return [d.contactPhone, d.contactInstagram, d.contactEmail].filter(Boolean).join('\n') || null
}

// ── Ошибки ──────────────────────────────────────────────────────────

/** Текст ошибки сервера по-человечески (class-validator отдаёт массив). */
export function errorText(e: any, fallback: string): string {
  const m = e?.response?.data?.message
  if (Array.isArray(m)) return m.filter(x => typeof x === 'string').join('. ') || fallback
  if (typeof m === 'string' && m && m !== 'duplicate') return m
  return fallback
}

/** Строка поиска по лиду — для фильтра доски на клиенте. */
export function leadMatches(lead: SalesLead, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const digits = s.replace(/\D/g, '')
  const hay = [
    lead.name, lead.sphere, lead.contactPerson, lead.contactInstagram, lead.contactEmail,
    lead.address, lead.problem, lead.nextStep, lead.leadSource, lead.owner?.name,
  ].filter(Boolean).join(' ').toLowerCase()
  if (hay.includes(s)) return true
  return digits.length >= 3 && (lead.contactPhone || '').replace(/\D/g, '').includes(digits)
}
