import { UserRole } from '../users/user.entity';

export const MANAGER_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.SMM_DIRECTOR];
export const REVIEW_ROLES = [UserRole.ADMIN, UserRole.SMM_DIRECTOR];
export const PRODUCTION_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.VIDEOGRAPHER, UserRole.VIDEO_EDITOR];
export const VIEW_ALL_ROLES = [UserRole.ADMIN, UserRole.FOUNDER];

/** SMM-director видит все SMM-проекты (как founder, но только SMM). */
export const SMM_VIEW_ALL_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.SMM_DIRECTOR];

/** Роль, с которой сотрудник работает на сервере (15.11.2026).
 *  Помощник администратора (employees.isSubAdmin) действует как admin — так
 *  задумано изначально (f07c58f) и так уже отвечали /auth/login и /auth/me.
 *  Но JwtStrategy, refresh и сокет брали роль из базы, и помощник видел
 *  админские экраны, а сервер отвечал 403. Теперь роль считается одинаково
 *  везде. Основателя и админа флаг не понижает. */
export function effectiveRoleOf(role: UserRole | string, isSubAdmin?: boolean | null): UserRole {
  if (isSubAdmin && role !== UserRole.FOUNDER && role !== UserRole.ADMIN) return UserRole.ADMIN;
  return role as UserRole;
}

export const canManageTasks = (role: UserRole) => MANAGER_ROLES.includes(role);
export const canReviewTasks = (role: UserRole) => REVIEW_ROLES.includes(role);
export const isProductionRole = (role: UserRole) => PRODUCTION_ROLES.includes(role);
export const canViewAll = (role: UserRole) => VIEW_ALL_ROLES.includes(role);
export const canViewAllSmm = (role: UserRole) => SMM_VIEW_ALL_ROLES.includes(role);
