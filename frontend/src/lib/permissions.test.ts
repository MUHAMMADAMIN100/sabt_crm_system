import { describe, it, expect } from 'vitest'
import { canAccessRoute, hasPermission, userCan } from './permissions'
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

// Персональные запреты (deniedPermissions) — снимают право, которое есть по
// роли. Правило обязано совпадать с backend hasGrant: запрет > роль > грант.
describe('userCan — персональные запреты', () => {
  const designer = { role: 'designer' as UserRole, secondaryRole: null }

  it('право роли действует, пока его не отняли', () => {
    expect(userCan({ ...designer }, 'calendar.view')).toBe(true)
  })

  it('запрет снимает право, которое даёт роль', () => {
    expect(userCan({ ...designer, deniedPermissions: ['calendar.view'] }, 'calendar.view')).toBe(false)
  })

  it('запрет снимает и персонально выданный грант', () => {
    const u = { ...designer, extraPermissions: ['clients.view'], deniedPermissions: ['clients.view'] }
    expect(userCan(u, 'clients.view')).toBe(false)
  })

  it('выданный грант работает, пока не запрещён', () => {
    expect(userCan({ ...designer, extraPermissions: ['clients.view'] }, 'clients.view')).toBe(true)
  })

  it('запрет одного ключа не задевает соседние', () => {
    const u = { ...designer, deniedPermissions: ['calendar.view'] }
    expect(userCan(u, 'calendar.view')).toBe(false)
    expect(userCan(u, 'tasks.view')).toBe(true)
  })

  it('запрет перебивает и право второй роли', () => {
    const u = { role: 'designer' as UserRole, secondaryRole: 'smm_director' as UserRole, deniedPermissions: ['analytics.view'] }
    expect(userCan({ ...u, deniedPermissions: [] }, 'analytics.view')).toBe(true)
    expect(userCan(u, 'analytics.view')).toBe(false)
  })

  it('запрет закрывает и маршрут, а не только пункт меню', () => {
    expect(canAccessRoute('designer', '/calendar', null, [], [])).toBe(true)
    expect(canAccessRoute('designer', '/calendar', null, [], ['calendar.view'])).toBe(false)
  })

  it('запрет закрывает страницу, открытую персональным грантом', () => {
    expect(canAccessRoute('designer', '/clients', null, ['clients.view'], [])).toBe(true)
    expect(canAccessRoute('designer', '/clients', null, ['clients.view'], ['clients.view'])).toBe(false)
  })
})
