import { UserRole } from '../users/user.entity';

export const MANAGER_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER];
export const REVIEW_ROLES = [UserRole.ADMIN, UserRole.PROJECT_MANAGER];
export const PRODUCTION_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.TARGETOLOGIST];
export const VIEW_ALL_ROLES = [UserRole.ADMIN, UserRole.FOUNDER];

export const canManageTasks = (role: UserRole) => MANAGER_ROLES.includes(role);
export const canReviewTasks = (role: UserRole) => REVIEW_ROLES.includes(role);
export const isProductionRole = (role: UserRole) => PRODUCTION_ROLES.includes(role);
export const canViewAll = (role: UserRole) => VIEW_ALL_ROLES.includes(role);
