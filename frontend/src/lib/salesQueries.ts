import type { QueryClient } from '@tanstack/react-query'

/**
 * Ключи запросов продаж (15.11.2026) — общие для Панели, Клиентов,
 * карточки лида и шторок, чтобы любое действие обновляло все экраны.
 *
 *   ['clients', …]        — старый список /clients (и сокет leads:changed)
 *   ['clients-stats']     — /clients/stats
 *   ['sales-kpi', …]      — KPI менеджера
 *   ['leads', 'list', p]  — /clients/list
 *   ['leads', 'board', p] — /clients/board
 *   ['leads', 'one', id]  — один лид
 *   ['sales', 'agenda']   — /sales/agenda
 *   ['sales', 'events', leadId] — история лида
 *   ['sales', 'handoffs', status], ['sales', 'analytics', …], ['sales', 'settings']
 */
export const salesKeys = {
  list: (params: unknown) => ['leads', 'list', params] as const,
  board: (params: unknown) => ['leads', 'board', params] as const,
  lead: (id: string) => ['leads', 'one', id] as const,
  agenda: () => ['sales', 'agenda'] as const,
  events: (leadId: string) => ['sales', 'events', leadId] as const,
  handoffs: (status: string) => ['sales', 'handoffs', status] as const,
  analytics: (params: unknown) => ['sales', 'analytics', params] as const,
  settings: () => ['sales', 'settings'] as const,
}

/** После любого действия с лидом — обновить всё, что его показывает. */
export function invalidateSales(qc: QueryClient): void {
  for (const key of [['leads'], ['sales'], ['clients'], ['clients-stats'], ['sales-kpi']]) {
    qc.invalidateQueries({ queryKey: key })
  }
}
