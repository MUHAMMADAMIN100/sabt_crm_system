/**
 * Гранты (персональные доступы) — выдаются основателем/сооснователем/админом
 * на странице «Доступы сотрудников» поверх роли. Каждый грант описывает:
 *   - label    — что это (для UI выдачи);
 *   - category — раздел для группировки в UI;
 *   - roles    — роли, у которых право есть ИЗНАЧАЛЬНО (нативно).
 * Пользователь имеет возможность, если его роль/вторая роль входит в roles
 * ИЛИ ключ есть в users.extraPermissions. Гранты только РАСШИРЯЮТ доступ.
 */
export interface GrantDef { label: string; category: string; roles: string[] }

const TOP = ['admin', 'founder', 'co_founder'];

export const GRANTABLE: Record<string, GrantDef> = {
  // ─── Проекты ───────────────────────────────────────────────────────
  'projects.view':   { label: 'Проекты — просмотр',          category: 'Проекты', roles: [...TOP, 'smm_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.create': { label: 'Проекты — добавление',        category: 'Проекты', roles: [...TOP, 'smm_director', 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.edit':   { label: 'Проекты — редактирование',    category: 'Проекты', roles: [...TOP, 'smm_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev'] },

  // ─── Контент-план / Доска ──────────────────────────────────────────
  'content-plan.manage': { label: 'Контент-план — создание и ведение', category: 'Доска проектов', roles: [...TOP, 'smm_director', 'organizer'] },

  // ─── Клиенты ───────────────────────────────────────────────────────
  'clients.view':   { label: 'Клиенты — просмотр',   category: 'Клиенты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'clients.create': { label: 'Клиенты — добавление', category: 'Клиенты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },

  // ─── Финансы ───────────────────────────────────────────────────────
  'finance.manage': { label: 'Финансы — доступ', category: 'Финансы', roles: ['founder', 'co_founder'] },

  // ─── Аналитика и отчёты ────────────────────────────────────────────
  'analytics.view': { label: 'Аналитика',          category: 'Аналитика и отчёты', roles: [...TOP, 'smm_director', 'video_director'] },
  'reports.view':   { label: 'Отчёты — просмотр',   category: 'Аналитика и отчёты', roles: [...TOP, 'video_director'] },
  'reports.create': { label: 'Отчёты — создание',   category: 'Аналитика и отчёты', roles: [...TOP, 'video_director', 'smm_director'] },

  // ─── Сотрудники / HR ───────────────────────────────────────────────
  'employees.view': { label: 'Сотрудники — просмотр', category: 'Сотрудники', roles: [...TOP, 'smm_director', 'video_director'] },

  // ─── Тарифы и настройки ────────────────────────────────────────────
  'tariffs.manage': { label: 'SMM-тарифы — управление', category: 'Настройки', roles: [...TOP, 'smm_director'] },
  'risks.view':     { label: 'Риски — просмотр',        category: 'Настройки', roles: [...TOP, 'smm_director', 'video_director'] },
  'archive.view':   { label: 'Архив — просмотр',        category: 'Настройки', roles: [...TOP] },
  'calendar.view':  { label: 'Календарь',               category: 'Настройки', roles: [...TOP, 'smm_director', 'video_director', 'smm_specialist', 'designer', 'organizer', 'videographer', 'video_editor', 'scriptwriter', 'qa', 'publisher', 'targetologist', 'storymaker'] },
  'ai.chat':        { label: 'ИИ-помощник',             category: 'Настройки', roles: [...TOP] },
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
