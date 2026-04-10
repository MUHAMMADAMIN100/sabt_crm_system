/**
 * Centralized role-based access control for the CRM.
 * Each role has a defined set of allowed routes and actions.
 */

import type { UserRole } from '@/store/auth.store'

export type Permission =
  | 'dashboard'
  | 'projects.view'
  | 'projects.create'
  | 'projects.edit'
  | 'projects.delete'
  | 'projects.archive'
  | 'projects.members.manage'
  | 'projects.manager.change'
  | 'tasks.view'
  | 'tasks.create'
  | 'tasks.edit'
  | 'tasks.delete'
  | 'tasks.assign'
  | 'tasks.approve'
  | 'tasks.return'
  | 'tasks.bulk'
  | 'tasks.export'
  | 'employees.view'
  | 'employees.create'
  | 'employees.edit'
  | 'employees.delete'
  | 'employees.role.change'
  | 'users.manage'
  | 'analytics.view'
  | 'reports.view'
  | 'reports.create'
  | 'reports.edit.all'
  | 'calendar.view'
  | 'calendar.create'
  | 'archive.view'
  | 'files.view'
  | 'files.upload'
  | 'files.delete.any'
  | 'notifications.view'
  | 'profile.view'
  | 'ai.chat'
  | 'stories.manage'
  | 'time-tracker.use'

const PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'dashboard', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.archive', 'projects.members.manage', 'projects.manager.change',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'employees.create', 'employees.edit', 'employees.delete',
    'employees.role.change', 'users.manage',
    'analytics.view', 'reports.view', 'reports.create', 'reports.edit.all',
    'calendar.view', 'calendar.create', 'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'time-tracker.use',
  ],
  founder: [
    'dashboard', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.archive', 'projects.members.manage', 'projects.manager.change',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'employees.create', 'employees.edit', 'employees.delete',
    'employees.role.change', 'users.manage',
    'analytics.view', 'reports.view', 'reports.create', 'reports.edit.all',
    'calendar.view', 'calendar.create', 'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'time-tracker.use',
  ],
  project_manager: [
    'dashboard', 'projects.view', 'projects.edit',
    'projects.members.manage',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'analytics.view',
    'reports.view', 'reports.create',
    'calendar.view', 'calendar.create', 'archive.view',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
  ],
  smm_specialist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
  ],
  designer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
  ],
  targetologist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
  ],
  marketer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
  ],
  sales_manager: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view',
    'notifications.view', 'profile.view',
  ],
  developer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
  ],
  employee: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view',
    'notifications.view', 'profile.view', 'time-tracker.use',
  ],
}

export function hasPermission(role: UserRole | undefined, permission: Permission): boolean {
  if (!role) return false
  return PERMISSIONS[role]?.includes(permission) ?? false
}

export function canAny(role: UserRole | undefined, permissions: Permission[]): boolean {
  if (!role) return false
  return permissions.some(p => hasPermission(role, p))
}

export function getAllPermissions(role: UserRole | undefined): Permission[] {
  if (!role) return []
  return PERMISSIONS[role] || []
}

/** Maps a permission to the route it grants access to */
const PERMISSION_TO_ROUTE: Record<string, string> = {
  'dashboard': '/',
  'projects.view': '/projects',
  'tasks.view': '/tasks',
  'employees.view': '/employees',
  'calendar.view': '/calendar',
  'reports.view': '/reports',
  'analytics.view': '/analytics',
  'notifications.view': '/notifications',
  'profile.view': '/profile',
  'archive.view': '/archive',
  'files.view': '/files',
  'ai.chat': '/ai',
}

export function canAccessRoute(role: UserRole | undefined, route: string): boolean {
  if (!role) return false

  // Always allowed routes
  if (['/profile', '/notifications', '/'].includes(route)) return true
  // Detail pages — allow if user can view the parent
  if (route.startsWith('/projects/')) return hasPermission(role, 'projects.view')
  if (route.startsWith('/tasks/')) return hasPermission(role, 'tasks.view')
  if (route.startsWith('/employees/')) return hasPermission(role, 'employees.view')

  const perm = Object.entries(PERMISSION_TO_ROUTE).find(([_, r]) => r === route)?.[0] as Permission | undefined
  if (!perm) return true
  return hasPermission(role, perm)
}
