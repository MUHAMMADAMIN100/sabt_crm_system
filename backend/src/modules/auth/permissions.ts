/**
 * Гранты (персональные доступы) — выдаются основателем/сооснователем/админом
 * на странице «Доступы сотрудников» поверх роли. Каждый грант описывает:
 *   - label    — что это (для UI выдачи);
 *   - roles    — роли, у которых право есть ИЗНАЧАЛЬНО (нативно).
 * Пользователь имеет возможность, если его роль/вторая роль входит в roles
 * ИЛИ ключ есть в users.extraPermissions. Гранты только РАСШИРЯЮТ доступ.
 */
export interface GrantDef { label: string; roles: string[] }

export const GRANTABLE: Record<string, GrantDef> = {
  'projects.create': {
    label: 'Добавление проектов',
    roles: ['admin', 'founder', 'co_founder', 'smm_director', 'sales_manager_smm', 'sales_manager_dev'],
  },
  'projects.edit': {
    label: 'Редактирование проектов',
    roles: ['admin', 'founder', 'co_founder', 'smm_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev'],
  },
  'clients.create': {
    label: 'Добавление клиентов / организаций',
    roles: ['admin', 'founder', 'co_founder', 'sales_manager_smm', 'sales_manager_dev'],
  },
  'content-plan.manage': {
    label: 'Контент-план (создание и ведение на доске)',
    roles: ['admin', 'founder', 'co_founder', 'smm_director', 'organizer'],
  },
  'tariffs.manage': {
    label: 'Управление SMM-тарифами',
    roles: ['admin', 'founder', 'co_founder', 'smm_director'],
  },
};

/** Все валидные ключи грантов (для валидации входящих данных). */
export const GRANT_KEYS = Object.keys(GRANTABLE);

/** Есть ли у пользователя возможность (нативно по роли/второй роли ИЛИ грант). */
export function hasGrant(
  user: { role?: string | null; secondaryRole?: string | null; extraPermissions?: string[] | null } | null | undefined,
  key: string,
): boolean {
  const def = GRANTABLE[key];
  if (!def || !user) return false;
  if (def.roles.includes(user.role || '')) return true;
  if (user.secondaryRole && def.roles.includes(user.secondaryRole)) return true;
  const extra = Array.isArray(user.extraPermissions) ? user.extraPermissions : [];
  return extra.includes(key);
}

/** Очистка входящего списка грантов — только валидные ключи, без дублей. */
export function sanitizeGrants(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((k: any) => typeof k === 'string' && GRANT_KEYS.includes(k)))];
}
