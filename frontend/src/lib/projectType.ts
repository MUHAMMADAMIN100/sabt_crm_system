/**
 * Подписи типов проекта для интерфейса.
 *
 * ВАЖНО: в БД (projects.projectType) тип хранится строкой, и по этим строкам
 * фильтрует бэкенд — сегмент менеджера продаж по разработке (DEV_PROJECT_TYPES
 * в backend/src/common/sales-segment.ts), доска «Разработка», аналитика.
 * Поэтому переименовываем ТОЛЬКО подпись: значение 'Web сайт' остаётся как
 * есть, пользователь видит «Разработка». Иначе пришлось бы мигрировать все
 * существующие проекты и синхронно править все серверные фильтры.
 */
const PROJECT_TYPE_LABELS: Record<string, string> = {
  'Web сайт': 'Разработка',
}

/** Как тип проекта показывается пользователю. */
export function projectTypeLabel(type?: string | null): string {
  if (!type) return ''
  return PROJECT_TYPE_LABELS[type] || type
}

/** Все типы dev-проектов — двойник DEV_PROJECT_TYPES бэкенда
 *  (backend/src/common/sales-segment.ts). По ним раздел «Разработка»
 *  отбирает свои проекты. */
export const DEV_PROJECT_TYPES = ['Web сайт', 'Лендинг', 'Телеграм бот', 'CRM система', 'Интернет магазин']

export function isDevProjectType(type?: string | null): boolean {
  return DEV_PROJECT_TYPES.includes(type || '')
}
