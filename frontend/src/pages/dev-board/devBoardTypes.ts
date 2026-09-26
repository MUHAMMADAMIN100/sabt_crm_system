/**
 * Типы и константы «Доски разработки» (канбан dev-трекера).
 * Экспортируются наружу — KPI/отчёты/деталка переиспользуют статусы,
 * приоритеты, иконки типов и контракт вебхуков. Единый источник модуля:
 * локальные копии в страницах запрещены (риск рассинхрона).
 */

import { Bug, Plus, Rocket, Wrench } from 'lucide-react'
import { isDevProjectType } from '@/lib/projectType'

export type DevTaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'testing'
  | 'done'

export type DevTaskPriority = 'low' | 'medium' | 'high' | 'critical'

export type DevTaskType = 'feature' | 'bug' | 'improvement' | 'tech_debt'

export interface DevTaskUserRef {
  id: string
  name: string
  avatarUrl?: string | null
  /** Бэк может слать поле `avatar` вместо/вместе с `avatarUrl` — принимаем оба. */
  avatar?: string | null
}

export interface DevTaskProjectRef {
  id: string
  name: string
  projectType?: string | null
}

export interface DevTask {
  id: string
  title: string
  description: string | null
  status: DevTaskStatus
  priority: DevTaskPriority
  taskType: DevTaskType
  assigneeId: string | null
  assignee: DevTaskUserRef | null
  createdById: string
  createdBy: { id: string; name: string } | null
  /** Проект «Разработка», к которому привязана задача (/dev/projects). */
  projectId: string | null
  project: DevTaskProjectRef | null
  position: number
  storyPoints: number | null
  tags: string[] | null
  deadline: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  /** Дата начала (для timeline-вида). Бэк может не присылать — опционально. */
  startDate?: string | null
  /** Блокер: задача остановлена. PATCH {isBlocked, blockedReason}. */
  isBlocked?: boolean
  blockedReason?: string | null
  /** Спринт задачи (фильтр ?sprint=, завершение спринта). */
  sprintId?: string | null
  /** Родительская задача для подзадач; null — задача верхнего уровня. */
  parentTaskId: string | null
  /** Файлы задачи (контракт: string[], правится через PATCH :id {attachments}). */
  attachments?: string[] | null
  /** Сколько подзадач всего / из них завершено (для бейджа прогресса). */
  subtasksCount: number
  subtasksDone: number
}

export interface DevTaskComment {
  id: string
  text: string
  createdAt: string
  author: { id: string; name: string } | null
}

export interface DevTaskDetail extends DevTask {
  comments: DevTaskComment[]
  /** Подзадачи задачи (приходят только в детальном ответе). */
  subtasks: DevTask[]
}

/** true — у задачи есть подзадачи (по счётчику из списка или загруженному списку). */
export function hasSubtasks(task: {
  subtasksCount?: number | null
  subtasks?: DevTask[] | null
}): boolean {
  return (task.subtasksCount ?? 0) > 0 || (task.subtasks?.length ?? 0) > 0
}

/** Колонки канбана в порядке показа. */
export const DEV_TASK_STATUSES: DevTaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'testing',
  'done',
]

export const DEV_STATUS_LABELS: Record<DevTaskStatus, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  in_progress: 'В работе',
  in_review: 'На ревью',
  testing: 'Тестирование',
  done: 'Готово',
}

/** Цвет «точки»/шапки колонки. */
export const DEV_STATUS_COLORS: Record<DevTaskStatus, string> = {
  backlog: 'bg-surface-400',
  todo: 'bg-sky-500',
  in_progress: 'bg-primary-500',
  in_review: 'bg-violet-500',
  testing: 'bg-amber-500',
  done: 'bg-emerald-500',
}

export const DEV_PRIORITY_LABELS: Record<DevTaskPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}

/** Классы бейджа приоритета (тёмная тема + светлая). */
export const DEV_PRIORITY_CLASSES: Record<DevTaskPriority, string> = {
  low: 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
  medium: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export const DEV_TASK_TYPE_LABELS: Record<DevTaskType, string> = {
  feature: 'Фича',
  bug: 'Баг',
  improvement: 'Улучшение',
  tech_debt: 'Техдолг',
}

/** Иконка типа задачи (карточка доски, селекты деталки). */
export const TYPE_ICONS: Record<DevTaskType, { icon: any; className: string }> = {
  bug: { icon: Bug, className: 'text-red-500 dark:text-red-400' },
  feature: { icon: Plus, className: 'text-emerald-500 dark:text-emerald-400' },
  improvement: { icon: Rocket, className: 'text-sky-500 dark:text-sky-400' },
  tech_debt: { icon: Wrench, className: 'text-surface-500 dark:text-surface-400' },
}

/** Цвет «точки» приоритета (селекты, группировка доски по приоритету). */
export const PRIORITY_DOTS: Record<DevTaskPriority, string> = {
  low: 'bg-surface-400',
  medium: 'bg-sky-500',
  high: 'bg-amber-500',
  critical: 'bg-red-500',
}

/** События вебхуков доски — зеркало backend DEV_WEBHOOK_EVENTS
 *  (dev-webhook-subscription.entity.ts). Другое значение → 400 от бэка. */
export const DEV_WEBHOOK_EVENTS = ['task.created', 'task.moved', 'task.done', 'task.commented'] as const

/** Варианты story points (Фибоначчи-набор, как в Jira). */
export const DEV_STORY_POINTS = [1, 2, 3, 5, 8, 13]

/** true — дедлайн просрочен и задача ещё не завершена.
 *  День дедлайна берём из строки ISO ('YYYY-MM-DD…'), как в fmtDeadline:
 *  new Date('YYYY-MM-DD') — это полночь UTC, и в зонах UTC−… день сдвигается
 *  на −1 (дедлайн 25.09 считался бы просроченным уже 24.09 — off-by-one).
 *  Дедлайн == сегодня ещё НЕ просрочен (граница — конец дня: day < today). */
export function isDevTaskOverdue(task: Pick<DevTask, 'deadline' | 'status'>): boolean {
  if (!task?.deadline || task.status === 'done') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(task.deadline))
  if (!m) return false
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(day.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return day < today
}

/** '2026-09-25T...' → '25.09' (или '25.09.2026'). Нарезкой строки, без Date:
 *  таймзона день не сдвигает; не-дата возвращается как есть (раньше
 *  'not-a-date' превращался в мусор вида 'a-e'). */
export function fmtDeadline(iso: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso))
  if (!m) return String(iso)
  const [, y, mo, d] = m
  return withYear ? `${d}.${mo}.${y}` : `${d}.${mo}`
}

/** Порог возраста открытой задачи в днях по приоритету (для SLA). */
export const SLA_AGE_DAYS: Record<DevTaskPriority, number> = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 14,
}

/**
 * true — задача просрочила SLA: открыта И (дедлайн просрочен
 * ИЛИ возраст старше порога critical1/high3/medium7/low14 дней).
 */
export function isSlaBreached(
  task: Pick<DevTask, 'status' | 'deadline' | 'priority' | 'createdAt'>,
): boolean {
  if (!task || task.status === 'done') return false
  if (isDevTaskOverdue(task as Pick<DevTask, 'deadline' | 'status'>)) return true
  // Без даты создания возраст не считаем: new Date(null) → epoch дал бы
  // фантомное нарушение SLA у только что созданной задачи.
  if (!task.createdAt) return false
  const threshold = SLA_AGE_DAYS[task.priority] ?? SLA_AGE_DAYS.medium
  const created = new Date(task.createdAt).getTime()
  if (Number.isNaN(created)) return false
  const ageDays = (Date.now() - created) / 86_400_000
  // Строго «старше порога», как в док-комментарии: граница ровно в порог —
  // ещё не нарушение (дробные часы делают границу практически неразличимой).
  return ageDays > threshold
}

/** Спринт доски (GET /dev-tracker/sprints). */
export interface DevSprint {
  id: string
  name: string
  goal?: string | null
  startDate?: string | null
  endDate?: string | null
  status?: string | null
}

/** Подписка на вебхуки доски (GET/POST/DELETE /dev-tracker/webhooks). */
export interface DevWebhook {
  id: string
  url: string
  projectId?: string | null
  events?: string[]
  secret?: string | null
  isActive?: boolean
  isEnabled?: boolean
  active?: boolean
  createdAt?: string
}

/** Запись журнала доставок вебхука (GET /webhooks/:id/deliveries, последние 20). */
export interface DevWebhookDelivery {
  event: string
  status: string
  error?: string | null
  createdAt: string
}

/** Исполнителя назначаем из dev-команды и руководства.
 *  Единый список для доски и деталки (фильтр тот же). */
export const ASSIGNEE_ROLES = ['developer', 'pm_dev', 'dev_director', 'founder', 'co_founder', 'admin']

/** Пользователь для селектов исполнителей (доска + деталка).
 *  Единый тип модуля: локальные копии BoardUser в страницах запрещены
 *  (риск рассинхрона полей avatar/avatarUrl). Бэк может слать `avatar`
 *  вместо/вместе с `avatarUrl` — принимаем оба, UI фолбэчится
 *  `avatarUrl || avatar`. */
export interface BoardUser {
  id: string
  name: string
  role?: string
  avatar?: string | null
  avatarUrl?: string | null
  isActive?: boolean
}

/** Вес приоритета для клиентской сортировки таблицы (единый источник —
 *  локальные копии PRIORITY_RANK в страницах запрещены). */
export const DEV_PRIORITY_RANK: Record<DevTaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

/** Отбор dev-проектов из общего списка (/dev/projects хранит ВСЕ проекты).
 *  Поведение: фильтр через существующий `isDevProjectType` по `projectType`. */
export function selectDevProjects<T extends { projectType?: string | null }>(
  list: readonly T[] | null | undefined,
): T[] {
  if (!Array.isArray(list)) return []
  // Элементы могут быть null/объектом вместо проекта (битый ответ бэка) —
  // доступ к .projectType без гарда ронял доску и деталку (TypeError).
  return (list as T[]).filter(p => p != null && typeof p === 'object' && isDevProjectType(p.projectType))
}
