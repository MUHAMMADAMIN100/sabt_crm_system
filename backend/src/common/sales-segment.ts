/**
 * Сегментация менеджеров продаж по направлениям.
 *
 *  - sales_manager_smm — видит только SMM-проекты и SMM-лиды
 *  - sales_manager_dev — видит только проекты «Web сайт» и лиды разработки
 *
 * Проекты типа «Дизайн» не относятся ни к одному сегменту.
 */
export type LeadDirection = 'smm' | 'development';

export interface SalesSegment {
  /** Default Project.projectType при создании. */
  projectType: string;
  /** Все допустимые Project.projectType для этого МП (создание/фильтр).
   *  МП-dev может выбирать подтип сайта: Лендинг, Телеграм бот, CRM,
   *  Интернет магазин — плюс legacy «Web сайт». */
  projectTypes: string[];
  /** Значение ClientLead.direction, доступное этому МП. */
  leadDirection: LeadDirection;
}

/** Подтипы веб-проектов, доступные МП по разработке. */
export const DEV_PROJECT_SUBTYPES = [
  'Лендинг',
  'Телеграм бот',
  'CRM система',
  'Интернет магазин',
];

/** Все типы dev-проектов (вкл. legacy «Web сайт») — сегмент менеджера продаж
 *  по разработке и проект-менеджера по разработке (pm_dev). */
export const DEV_PROJECT_TYPES = ['Web сайт', ...DEV_PROJECT_SUBTYPES];

/** Подписи типов проекта для текстов, которые видит пользователь.
 *  В БД тип по-прежнему хранится как 'Web сайт' (по нему фильтруют сегменты
 *  и доска «Разработка»), но в интерфейсе он называется «Разработка».
 *  Фронтовый двойник — frontend/src/lib/projectType.ts. */
const PROJECT_TYPE_LABELS: Record<string, string> = {
  'Web сайт': 'Разработка',
};

/** Как тип проекта показывается пользователю (в текстах ошибок и письмах). */
export function projectTypeLabel(type?: string | null): string {
  if (!type) return '';
  return PROJECT_TYPE_LABELS[type] || type;
}

/** Возвращает сегмент для роли МП либо null, если роль — не менеджер продаж. */
export function getSalesSegment(role?: string | null): SalesSegment | null {
  if (role === 'sales_manager_smm') {
    return { projectType: 'SMM', projectTypes: ['SMM'], leadDirection: 'smm' };
  }
  if (role === 'sales_manager_dev') {
    return {
      projectType: 'Лендинг',
      projectTypes: ['Web сайт', ...DEV_PROJECT_SUBTYPES],
      leadDirection: 'development',
    };
  }
  return null;
}

/** true, если роль — один из менеджеров продаж. */
export function isSalesManager(role?: string | null): boolean {
  return role === 'sales_manager_smm' || role === 'sales_manager_dev';
}

/**
 * Роль МП пользователя с учётом второй роли (15.11.2026).
 * Раньше сегмент считали только по основной роли: сотрудник с ВТОРОЙ ролью
 * «Менеджер продаж» получал clients.view, но без фильтра направления видел
 * лиды обоих направлений. Основная роль МП важнее второй.
 */
export function salesRoleOf(
  user?: { role?: string | null; secondaryRole?: string | null } | null,
): string | null {
  if (!user) return null;
  if (isSalesManager(user.role)) return user.role as string;
  if (isSalesManager(user.secondaryRole)) return user.secondaryRole as string;
  return null;
}

/** Сегмент МП пользователя по основной ИЛИ второй роли. */
export function getSalesSegmentOfUser(
  user?: { role?: string | null; secondaryRole?: string | null } | null,
): SalesSegment | null {
  return getSalesSegment(salesRoleOf(user));
}
