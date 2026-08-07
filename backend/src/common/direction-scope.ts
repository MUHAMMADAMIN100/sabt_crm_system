/**
 * Направленческий скоуп аналитики и списков сотрудников.
 *
 * Руководитель разработки (роль dev_director — основная ИЛИ вторая, как у
 * Сабрины поверх «МП по разработке») ведёт только своё направление: он не
 * должен видеть ни SMM-проекты, ни SMM-сотрудников — ни в сводных цифрах
 * аналитики, ни в загруженности, ни в списке команды.
 *
 * Здесь один источник правды о том, что такое «направление разработки»:
 * какие типы проектов в него входят и кто в его команде.
 */
import { DEV_PROJECT_TYPES } from './sales-segment';

/** Команда разработки: исполнители, проект-менеджер и менеджер продаж
 *  направления. Сам руководитель тоже в списке — он ведёт свои задачи. */
export const DEV_TEAM_ROLES = [
  'developer',
  'pm_dev',
  'sales_manager_dev',
  'dev_director',
];

/** Руководство компании: в аналитику направления не попадает (там считается
 *  команда), но в СПРАВОЧНИКЕ людей должно быть видно — основатель и админ
 *  бывают менеджерами dev-проектов и участниками команд, иначе руководитель
 *  направления не сможет ни выбрать их менеджером, ни отфильтровать по ним. */
export const TOP_ROLES = ['admin', 'founder', 'co_founder'];

export interface DirectionScope {
  /** Типы проектов направления (Project.projectType). */
  projectTypes: string[];
  /** Роли сотрудников направления (User.role или User.secondaryRole) —
   *  для аналитики, KPI и загруженности. */
  teamRoles: string[];
  /** Кого показывать в списке сотрудников и пикерах: команда + руководство. */
  directoryRoles: string[];
}

const DEV_SCOPE: DirectionScope = {
  projectTypes: DEV_PROJECT_TYPES,
  teamRoles: DEV_TEAM_ROLES,
  directoryRoles: [...DEV_TEAM_ROLES, ...TOP_ROLES],
};

/**
 * Скоуп направления для пользователя либо null — «видит всё, как раньше».
 * Проверяются обе роли: права руководителя направления могут быть выданы
 * второй ролью поверх основной.
 */
export function directionScopeOf(
  user?: { role?: string | null; secondaryRole?: string | null } | null,
): DirectionScope | null {
  if (!user) return null;
  if (user.role === 'dev_director' || user.secondaryRole === 'dev_director') {
    return DEV_SCOPE;
  }
  return null;
}

/** true, если сотрудник относится к направлению (по любой из своих ролей). */
export function isInDirection(
  scope: DirectionScope,
  emp?: { role?: string | null; secondaryRole?: string | null } | null,
): boolean {
  if (!emp) return false;
  return scope.teamRoles.includes(emp.role || '')
    || scope.teamRoles.includes(emp.secondaryRole || '');
}

/** true, если сотрудника показываем в справочнике направления: своя команда
 *  плюс руководство компании (менеджеры проектов, участники). */
export function isInDirectory(
  scope: DirectionScope,
  emp?: { role?: string | null; secondaryRole?: string | null } | null,
): boolean {
  if (!emp) return false;
  return scope.directoryRoles.includes(emp.role || '')
    || scope.directoryRoles.includes(emp.secondaryRole || '');
}
