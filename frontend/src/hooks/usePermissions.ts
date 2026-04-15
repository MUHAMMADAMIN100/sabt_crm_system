import { useAuthStore } from '@/store/auth.store'
import { hasPermission, type Permission } from '@/lib/permissions'

/**
 * Hook for checking user permissions throughout the app.
 * Usage:
 *   const { can, role } = usePermissions()
 *   if (can('projects.create')) { ... }
 */
export function usePermissions() {
  const role = useAuthStore(s => s.user?.role)
  const userId = useAuthStore(s => s.user?.id)

  return {
    role,
    userId,
    can: (permission: Permission) => hasPermission(role, permission),
    canAny: (permissions: Permission[]) => permissions.some(p => hasPermission(role, p)),
    canAll: (permissions: Permission[]) => permissions.every(p => hasPermission(role, p)),
    /** Check if user is admin or founder */
    isFounder: role === 'admin' || role === 'founder',
    /** Check if user is admin, founder, or project manager */
    isManager: role === 'admin' || role === 'founder' || role === 'project_manager',
    /** Check if user is admin */
    isAdmin: role === 'admin',
  }
}
