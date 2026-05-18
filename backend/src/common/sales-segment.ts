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
  /** Значение Project.projectType, доступное этому МП. */
  projectType: string;
  /** Значение ClientLead.direction, доступное этому МП. */
  leadDirection: LeadDirection;
}

/** Возвращает сегмент для роли МП либо null, если роль — не менеджер продаж. */
export function getSalesSegment(role?: string | null): SalesSegment | null {
  if (role === 'sales_manager_smm') {
    return { projectType: 'SMM', leadDirection: 'smm' };
  }
  if (role === 'sales_manager_dev') {
    return { projectType: 'Web сайт', leadDirection: 'development' };
  }
  return null;
}

/** true, если роль — один из менеджеров продаж. */
export function isSalesManager(role?: string | null): boolean {
  return role === 'sales_manager_smm' || role === 'sales_manager_dev';
}
