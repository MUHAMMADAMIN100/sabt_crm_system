/**
 * Раздел «Задачи» (кабинет поручений): группы и подписи строк
 * (docs/SMM_DELEGATION_SPEC.md, 17.11.2026). Чистые функции — их и тестируем.
 */
import { normalizeTaskStatus } from '@/lib/taskStatus'
import type { CabinetTask, TaskPerson } from '@/types/taskCabinet'

/** Сколько дней сданная задача считается «ждущей проверки» — двойник правила сервера. */
export const REVIEW_WINDOW_DAYS = 14

const time = (v: string | null | undefined): number => {
  if (!v) return NaN
  const t = new Date(v).getTime()
  return isNaN(t) ? NaN : t
}

/** Ждёт ли задача проверки автора. Сервер присылает awaitingReview; если
 *  поля нет (старый ответ, кэш на устройстве), считаем по тому же правилу:
 *  done, не принята, сдана за последние 14 дней, автор — не исполнитель. */
export function isAwaitingReview(t: CabinetTask, now: Date): boolean {
  if (typeof t.awaitingReview === 'boolean') return t.awaitingReview
  if (normalizeTaskStatus(t.status) !== 'done' || t.reviewedAt) return false
  const done = time(t.completedAt)
  if (isNaN(done) || now.getTime() - done > REVIEW_WINDOW_DAYS * 86400_000) return false
  const author = t.createdById ?? t.createdBy?.id ?? null
  const executor = t.assigneeId ?? t.assignee?.id ?? null
  return !!author && author !== executor
}

/** Открытые — по сроку (ближайший и просроченный сверху, без срока — в конце). */
const byDeadline = (a: CabinetTask, b: CabinetTask): number => {
  const x = time(a.deadline), y = time(b.deadline)
  if (isNaN(x) && isNaN(y)) return 0
  if (isNaN(x)) return 1
  if (isNaN(y)) return -1
  return x - y
}
/** Когда задача закончилась: принята → сдана → обновлена. */
const finishedAt = (t: CabinetTask): number => {
  for (const v of [t.reviewedAt, t.completedAt, t.updatedAt, t.createdAt]) {
    const x = time(v)
    if (!isNaN(x)) return x
  }
  return 0
}
const bySubmittedAsc = (a: CabinetTask, b: CabinetTask): number => (time(a.completedAt) || 0) - (time(b.completedAt) || 0)
const byFinishedDesc = (a: CabinetTask, b: CabinetTask): number => finishedAt(b) - finishedAt(a)

const isOpen = (t: CabinetTask): boolean => {
  const s = normalizeTaskStatus(t.status)
  return s === 'new' || s === 'in_progress'
}

/** «Я поставил»: ждут вашей проверки (кто сдал раньше — выше) → в работе
 *  (по сроку) → готово (свежие сверху; сюда же отменённые). */
export function groupAssigned(list: CabinetTask[], now: Date): {
  review: CabinetTask[]; work: CabinetTask[]; done: CabinetTask[]
} {
  const review: CabinetTask[] = [], work: CabinetTask[] = [], done: CabinetTask[] = []
  for (const t of list) {
    if (isOpen(t)) work.push(t)
    else if (isAwaitingReview(t, now)) review.push(t)
    else done.push(t)
  }
  return { review: review.sort(bySubmittedAsc), work: work.sort(byDeadline), done: done.sort(byFinishedDesc) }
}

/** «Мне»: сделать (по сроку) → сдано, ждёт проверки (свежие сверху) → готово. */
export function groupMine(list: CabinetTask[], now: Date): {
  todo: CabinetTask[]; submitted: CabinetTask[]; done: CabinetTask[]
} {
  const todo: CabinetTask[] = [], submitted: CabinetTask[] = [], done: CabinetTask[] = []
  for (const t of list) {
    if (isOpen(t)) todo.push(t)
    else if (isAwaitingReview(t, now)) submitted.push(t)
    else done.push(t)
  }
  return { todo: todo.sort(byDeadline), submitted: submitted.sort(byFinishedDesc), done: done.sort(byFinishedDesc) }
}

/** Исполнители задачи по порядку; без повторов. Понимает обе формы
 *  task_assignees ({ user: {…} } и плоскую) и старое одиночное поле assignee. */
export function taskAssignees(t: CabinetTask): TaskPerson[] {
  const out: TaskPerson[] = []
  const seen = new Set<string>()
  for (const a of t.assignees ?? []) {
    const id = a?.user?.id ?? a?.userId ?? a?.id
    const name = a?.user?.name ?? a?.name
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: name || 'Сотрудник', avatar: a?.user?.avatar ?? a?.avatar ?? null })
  }
  if (!out.length && t.assignee?.id) out.push({ id: t.assignee.id, name: t.assignee.name || 'Сотрудник', avatar: t.assignee.avatar ?? null })
  return out
}

/** «Нигина», «Нигина +2», «Без исполнителя». */
export function peopleLabel(people: TaskPerson[]): string {
  if (!people.length) return 'Без исполнителя'
  return people.length > 1 ? `${people[0].name} +${people.length - 1}` : people[0].name
}

/** Заметки исполнителей к своим частям задачи (непустые). */
export function assigneeNotes(t: CabinetTask): Array<{ name: string; note: string }> {
  const out: Array<{ name: string; note: string }> = []
  for (const a of t.assignees ?? []) {
    const note = (a?.note || '').trim()
    if (note) out.push({ name: a?.user?.name ?? a?.name ?? 'Исполнитель', note })
  }
  return out
}

/** Сообщение сервера из ошибки запроса (строка или список проверок DTO). */
export function serverMessage(e: unknown, fallback: string): string {
  const m = (e as any)?.response?.data?.message
  if (Array.isArray(m)) {
    const s = m.filter(x => typeof x === 'string' && x.trim()).join('; ')
    return s || fallback
  }
  return typeof m === 'string' && m.trim() ? m : fallback
}

/** SMM-специалист — основной или второй ролью: ему кнопка «+ Задача». */
export function isSmmSpecialist(user: { role?: string | null; secondaryRole?: string | null } | null | undefined): boolean {
  return !!user && (user.role === 'smm_specialist' || user.secondaryRole === 'smm_specialist')
}
