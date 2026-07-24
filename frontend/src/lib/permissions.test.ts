import { describe, it, expect } from 'vitest'
import { canAccessRoute, hasPermission } from './permissions'
import type { UserRole } from '@/store/auth.store'

// «Задачи от руководителя»: /tasks и /tasks/:id — раньше маршрутов не было
// вовсе, RoleGuard ссылку тестировать было не на чем. Теперь маршруты
// существуют, и permission 'tasks.view' должен пускать КАЖДУЮ роль.
describe('canAccessRoute — /tasks (раздел «Задачи от руководителя»)', () => {
  const ALL_ROLES: UserRole[] = [
    'admin', 'founder', 'co_founder', 'smm_director', 'video_director',
    'smm_specialist', 'designer', 'sales_manager_smm', 'sales_manager_dev',
    'pm_dev', 'developer', 'videographer', 'video_editor', 'organizer',
    'storymaker', 'scriptwriter', 'qa', 'publisher', 'targetologist', 'employee',
  ]

  it.each(ALL_ROLES)('role "%s" has the tasks.view permission (RoleGuard must not block /tasks)', (role) => {
    expect(hasPermission(role, 'tasks.view')).toBe(true)
  })

  it.each(ALL_ROLES)('role "%s" can access /tasks', (role) => {
    expect(canAccessRoute(role, '/tasks')).toBe(true)
  })

  it.each(ALL_ROLES)('role "%s" can access /tasks/:id (detail page reached from notifications)', (role) => {
    expect(canAccessRoute(role, '/tasks/11111111-1111-1111-1111-111111111111')).toBe(true)
  })

  it('unauthenticated (no role) is denied /tasks', () => {
    expect(canAccessRoute(undefined, '/tasks')).toBe(false)
  })
})
