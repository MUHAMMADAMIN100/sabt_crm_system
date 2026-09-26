/**
 * Единый источник ссылок модуля «Разработка».
 *
 * Канонические маршруты: календарь — /dev, проекты — /dev/projects/:id,
 * доска (+KPI/отчёты) — /dev-board*. Навигация по ним — ТОЛЬКО в сайдбаре
 * (Sidebar DEV_SUBNAV): in-page полоса табов и кнопки-дубли в шапках убраны,
 * поэтому отдельных calendarUrl/projectsUrl/kpiUrl/reportsUrl здесь нет —
 * код строит лишь ссылки, которые не покрыты меню.
 *
 * Контракт доски `?project=<id>&create=1` НЕ переименовывать:
 * DevBoardPage читает именно `project` / `create` из location.search.
 */

/** Карточка проекта разработки. */
export function projectUrl(id: string): string {
  return `/dev/projects/${encodeURIComponent(id)}`
}

/**
 * Доска разработки с опциональным фильтром по проекту.
 * @param projectId — подставится как `?project=<id>`
 * @param create — `true` добавит `&create=1` (открыть модалку создания)
 */
export function boardUrl(projectId?: string | null, create?: boolean): string {
  const params = new URLSearchParams()
  if (projectId) params.set('project', projectId)
  if (create) params.set('create', '1')
  const qs = params.toString()
  return qs ? `/dev-board?${qs}` : '/dev-board'
}

/** Карточка задачи доски разработки. */
export function taskUrl(id: string): string {
  return `/dev-board/task/${encodeURIComponent(id)}`
}
