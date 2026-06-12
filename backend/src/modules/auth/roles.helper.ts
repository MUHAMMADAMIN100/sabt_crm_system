import { UserRole } from '../users/user.entity';

export const MANAGER_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR];
export const REVIEW_ROLES = [UserRole.ADMIN, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR];
export const PRODUCTION_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.VIDEOGRAPHER, UserRole.VIDEO_EDITOR, UserRole.ORGANIZER, UserRole.STORYMAKER];
export const VIEW_ALL_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER];

/** SMM-director видит все SMM-проекты (как founder, но только SMM). */
export const SMM_VIEW_ALL_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR];

export const canManageTasks = (role: UserRole) => MANAGER_ROLES.includes(role);
export const canReviewTasks = (role: UserRole) => REVIEW_ROLES.includes(role);
export const isProductionRole = (role: UserRole) => PRODUCTION_ROLES.includes(role);
export const canViewAll = (role: UserRole) => VIEW_ALL_ROLES.includes(role);
export const canViewAllSmm = (role: UserRole) => SMM_VIEW_ALL_ROLES.includes(role);
