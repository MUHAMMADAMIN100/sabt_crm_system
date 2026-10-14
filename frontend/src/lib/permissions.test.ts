import { describe, it, expect } from 'vitest'
import { canAccessRoute, hasPermission, userCan, canSeeSmmSection, isSmmViewOnly } from './permissions'
import type { UserRole } from '@/store/auth.store'

// «Задачи от руководителя»: /tasks и /tasks/:id — раньше маршрутов не было
// вовсе, RoleGuard ссылку тестировать было не на чем. Теперь маршруты
// существуют, и permission 'tasks.view' должен пускать КАЖДУЮ роль.
describe('canAccessRoute — /tasks (раздел «Задачи от руководителя»)', () => {
  const ALL_ROLES: UserRole[] = [
    'admin', 'founder', 'smm_director', 'smm_specialist', 'designer', 'sales_manager_smm', 'sales_manager_dev',
    'pm_dev', 'developer', 'videographer', 'video_editor', 'targetologist', 'employee',
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
    expect(userCan({ ...designer }, 'reports.view')).toBe(true)
  })

  it('запрет снимает право, которое даёт роль', () => {
    expect(userCan({ ...designer, deniedPermissions: ['reports.view'] }, 'reports.view')).toBe(false)
  })

  it('запрет снимает и персонально выданный грант', () => {
    const u = { ...designer, extraPermissions: ['clients.view'], deniedPermissions: ['clients.view'] }
    expect(userCan(u, 'clients.view')).toBe(false)
  })

  it('выданный грант работает, пока не запрещён', () => {
    expect(userCan({ ...designer, extraPermissions: ['clients.view'] }, 'clients.view')).toBe(true)
  })

  it('запрет одного ключа не задевает соседние', () => {
    const u = { ...designer, deniedPermissions: ['reports.view'] }
    expect(userCan(u, 'reports.view')).toBe(false)
    expect(userCan(u, 'tasks.view')).toBe(true)
  })

  it('запрет перебивает и право второй роли', () => {
    const u = { role: 'designer' as UserRole, secondaryRole: 'smm_director' as UserRole, deniedPermissions: ['analytics.view'] }
    expect(userCan({ ...u, deniedPermissions: [] }, 'analytics.view')).toBe(true)
    expect(userCan(u, 'analytics.view')).toBe(false)
  })

  it('запрет закрывает и маршрут, а не только пункт меню', () => {
    expect(canAccessRoute('designer', '/reports', null, [], [])).toBe(true)
    expect(canAccessRoute('designer', '/reports', null, [], ['reports.view'])).toBe(false)
  })

  it('запрет закрывает страницу, открытую персональным грантом', () => {
    expect(canAccessRoute('designer', '/clients', null, ['clients.view'], [])).toBe(true)
    expect(canAccessRoute('designer', '/clients', null, ['clients.view'], ['clients.view'])).toBe(false)
  })
})

// Раздел «СММ» у менеджеров по продажам (решение владельца 11.10.2026):
// менеджер продаж СММ видит раздел целиком, но только смотрит — отмечает
// лишь в «Контроле». Менеджеру продаж разработки раздел закрыт: СММ и
// разработка разделены (14.10.2026). Сервер держит то же правило @Roles.
describe('раздел «СММ» — менеджеры по продажам', () => {
  const ROUTES = ['/smm', '/smm/stories', '/smm/projects', '/smm/projects/abc', '/smm/control']

  it('менеджер продаж СММ открывает все страницы раздела', () => {
    expect(canSeeSmmSection('sales_manager_smm')).toBe(true)
    for (const route of ROUTES) expect(canAccessRoute('sales_manager_smm', route)).toBe(true)
  })

  it('менеджеру продаж разработки раздел «СММ» закрыт', () => {
    expect(canSeeSmmSection('sales_manager_dev')).toBe(false)
    for (const route of ROUTES) expect(canAccessRoute('sales_manager_dev', route)).toBe(false)
  })

  it('менеджер продаж СММ — наблюдатель, СММ-команда и руководство — нет', () => {
    expect(isSmmViewOnly('sales_manager_smm')).toBe(true)
    for (const role of ['founder', 'admin', 'smm_director', 'smm_specialist', 'sales_manager_dev'] as UserRole[]) {
      expect(isSmmViewOnly(role)).toBe(false)
    }
  })

  it('остальным ролям раздел по-прежнему закрыт', () => {
    for (const role of ['designer', 'developer', 'videographer', 'pm_dev'] as UserRole[]) {
      expect(canSeeSmmSection(role)).toBe(false)
      expect(canAccessRoute(role, '/smm')).toBe(false)
    }
  })
})
