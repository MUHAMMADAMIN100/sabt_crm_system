/**
 * Статусы задачи, которые НЕ считаются «просроченными» — даже если
 * deadline в прошлом. Сюда входят:
 *   - финальные: done, cancelled, approved, published
 *   - проверочные: review, on_pm_review, on_client_approval
 *
 * Логика: если задача дошла до review/approval — исполнитель свою работу
 * отдал, мяч перешёл к PM / клиенту. Дедлайн исполнителя пройден по факту,
 * красный значок «Просрочено» висеть на ней не должен.
 *
 * Используется на всех страницах, где красится дедлайн или показывается
 * бейдж «Просрочено» (Задачи, Календарь, Канбан проекта, Карточка задачи,
 * Дашборды, страница сотрудника).
 */
export const TASK_CLOSED_FOR_OVERDUE: string[] = [
  'done',
  'cancelled',
  'review',
  'on_pm_review',
  'on_client_approval',
  'approved',
  'published',
]

/** true, если у задачи дедлайн прошёл И статус ещё «в работе» (не закрыт). */
export function isTaskOverdue(task: { deadline?: string | Date | null; status?: string | null }): boolean {
  if (!task?.deadline) return false
  if (task.status && TASK_CLOSED_FOR_OVERDUE.includes(task.status)) return false
  return new Date(task.deadline) < new Date()
}
