/**
 * Wave 11: задачи имеют только 4 статуса: new / in_progress / done / cancelled.
 * Старые значения (review / on_pm_review / approved / published / returned /
 * accepted / on_rework / on_client_approval / rescheduled) удалены — миграция
 * 1748600000000 уже сконвертировала строки в БД. Если где-то на фронте
 * прилетит старое значение — fallback на 'in_progress'.
 */
export const TASK_STATUSES = ['new', 'in_progress', 'done', 'cancelled'] as const
export type TaskStatusValue = typeof TASK_STATUSES[number]

/** Человеко-читаемые подписи (в дропдаунах, бейджах). */
export const STATUS_LABELS: Record<TaskStatusValue, string> = {
  new:         'Новая',
  in_progress: 'В работе',
  done:        'Готово',
  cancelled:   'Отмена',
}

/** Цветовые классы для бейджей. */
export const STATUS_COLOR_CLASSES: Record<TaskStatusValue, string> = {
  new:         'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  done:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

/** Нормализатор любого пришедшего статуса (включая легаси) в одно из 4-х. */
export function normalizeTaskStatus(s: string | null | undefined): TaskStatusValue {
  if (!s) return 'new'
  if ((TASK_STATUSES as readonly string[]).includes(s)) return s as TaskStatusValue
  if (s === 'cancelled') return 'cancelled'
  if (s === 'done' || s === 'published') return 'done'
  // Любые остальные старые промежуточные = «В работе»
  return 'in_progress'
}

export function getTaskStatusLabel(s: string | null | undefined): string {
  return STATUS_LABELS[normalizeTaskStatus(s)]
}

/**
 * Статусы задачи, которые НЕ считаются «просроченными» — деdline в прошлом.
 * В 4-статусной модели это только финальные: done / cancelled.
 */
export const TASK_CLOSED_FOR_OVERDUE: TaskStatusValue[] = ['done', 'cancelled']

/** true, если у задачи дедлайн прошёл И статус ещё «в работе» (не закрыт). */
export function isTaskOverdue(task: { deadline?: string | Date | null; status?: string | null }): boolean {
  if (!task?.deadline) return false
  const norm = normalizeTaskStatus(task.status)
  if (TASK_CLOSED_FOR_OVERDUE.includes(norm)) return false
  return new Date(task.deadline) < new Date()
}
