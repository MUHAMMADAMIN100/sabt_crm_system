// Проекты раздела «Разработка»: этап, срок сдачи и задачи доски — чистые
// функции для списка и страницы проекта. С 14.10.2026 у разработки свои
// страницы, отдельные от СММ (решение владельца): ни рилсов, ни циклов,
// ни контент-плана — только этап, сроки, команда, задачи и клиент.

import { DEV_STAGES } from '@/lib/devStages'
import { isDevTaskOverdue, type DevTask, type DevTaskStatus } from '@/pages/dev-board/devBoardTypes'

export type DevStage = (typeof DEV_STAGES)[number]

/** Этап проекта по номеру 1..6; не задан — null. */
export function stageOf(devStage?: number | null): DevStage | null {
  if (devStage == null) return null
  return DEV_STAGES.find(s => s.num === Number(devStage)) ?? null
}

/** Склонение: 1 день, 2 дня, 5 дней. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 10
  const b = Math.abs(n) % 100
  if (a === 1 && b !== 11) return one
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few
  return many
}

const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** День из ISO-строки по её дате, без сдвига таймзоны — как на доске. */
export function dayOf(iso?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** «16 окт» (год — только если не текущий). */
export function shortDay(iso?: string | null, today = new Date()): string {
  const d = dayOf(iso)
  if (!d) return '—'
  const y = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]}${y}`
}

/** «1 сентября» (год — только если не текущий). */
export function longDay(iso?: string | null, today = new Date()): string {
  const d = dayOf(iso)
  if (!d) return '—'
  const y = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${MON_GEN[d.getMonth()]}${y}`
}

/** 'YYYY-MM-DD' сегодняшнего дня. */
export function todayIso(today = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const diffDays = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000)

/** Срок сдачи относительно сегодня: «через 2 дня», «сегодня»,
 *  «просрочено на 4 дня». Без даты — null. */
export function deadlineInfo(endDate?: string | null, today = new Date()):
  { days: number; overdue: boolean; text: string } | null {
  const end = dayOf(endDate)
  if (!end) return null
  const days = diffDays(end, today)
  if (days < 0) return { days, overdue: true, text: `просрочено на ${-days} ${plural(-days, 'день', 'дня', 'дней')}` }
  if (days === 0) return { days, overdue: false, text: 'сегодня' }
  return { days, overdue: false, text: `через ${days} ${plural(days, 'день', 'дня', 'дней')}` }
}

/** Сколько дней прошло от старта до сдачи — для полоски «Сроки». Без
 *  одной из дат или с перепутанными датами — null. */
export function timeProgress(startDate?: string | null, endDate?: string | null, today = new Date()):
  { passed: number; total: number; pct: number } | null {
  const s = dayOf(startDate)
  const e = dayOf(endDate)
  if (!s || !e) return null
  const total = diffDays(e, s)
  if (total <= 0) return null
  const passed = Math.min(total, Math.max(0, diffDays(today, s)))
  return { passed, total, pct: Math.round(passed / total * 100) }
}

/** Задачи, которые считаются на страницах проектов: верхнего уровня —
 *  подзадачи живут внутри карточки, как и на доске. */
const topLevel = (tasks: readonly DevTask[]) => tasks.filter(t => t && t.parentTaskId == null)

export type TaskStats = {
  by: Record<DevTaskStatus, number>
  total: number
  done: number
  open: number
  overdue: number
}

/** Задачи проекта по колонкам доски + просроченные. */
export function taskStats(tasks: readonly DevTask[]): TaskStats {
  const by: Record<DevTaskStatus, number> = { backlog: 0, todo: 0, in_progress: 0, testing: 0, done: 0 }
  let overdue = 0
  const list = topLevel(tasks)
  for (const t of list) {
    if (t.status in by) by[t.status] += 1
    if (isDevTaskOverdue(t)) overdue += 1
  }
  return { by, total: list.length, done: by.done, open: list.length - by.done, overdue }
}

/** Ближайшие дедлайны: открытые задачи со сроком, самые ранние (то есть
 *  и просроченные) — первыми. */
export function nearestDeadlines(tasks: readonly DevTask[], limit = 4): DevTask[] {
  return topLevel(tasks)
    .filter(t => t.status !== 'done' && !!dayOf(t.deadline))
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)) || a.title.localeCompare(b.title, 'ru'))
    .slice(0, limit)
}

/** Открытые задачи по исполнителю — «5 задач» у разработчика в команде. */
export function openByAssignee(tasks: readonly DevTask[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of topLevel(tasks)) {
    if (t.status === 'done' || !t.assigneeId) continue
    m.set(t.assigneeId, (m.get(t.assigneeId) ?? 0) + 1)
  }
  return m
}

/** Для списка проектов: открытые и просроченные задачи каждого проекта. */
export function projectTaskCounts(tasks: readonly DevTask[]): Map<string, { open: number; overdue: number }> {
  const m = new Map<string, { open: number; overdue: number }>()
  for (const t of topLevel(tasks)) {
    if (!t.projectId || t.status === 'done') continue
    const c = m.get(t.projectId) ?? { open: 0, overdue: 0 }
    c.open += 1
    if (isDevTaskOverdue(t)) c.overdue += 1
    m.set(t.projectId, c)
  }
  return m
}

/** «5 задач», «1 задача». */
export const tasksWord = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
/** «1 просрочена», «3 просрочены», «5 просрочено». */
export const overdueWord = (n: number) => `${n} ${plural(n, 'просрочена', 'просрочены', 'просрочено')}`
