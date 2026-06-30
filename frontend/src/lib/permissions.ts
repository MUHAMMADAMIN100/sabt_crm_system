/**
 * Centralized role-based access control for the CRM.
 * Each role has a defined set of allowed routes and actions.
 */

import type { UserRole, User } from '@/store/auth.store'

/** Maps role enum to a Russian display label */
const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  founder: 'Основатель',
  co_founder: 'Сооснователь',
  smm_director: 'Руководитель SMM',
  video_director: 'Руководитель по видеографии',
  smm_specialist: 'SMM специалист',
  designer: 'Дизайнер',
  sales_manager_smm: 'Менеджер продаж (СММ)',
  sales_manager_dev: 'Менеджер продаж (Разработка)',
  developer: 'Разработчик',
  videographer: 'Видеограф',
  video_editor: 'Монтажёр',
  organizer: 'Организатор',
  storymaker: 'Сторисмейкер',
  scriptwriter: 'Сценарист / SMM-менеджер',
  qa: 'Контролёр качества',
  publisher: 'Публикатор',
  targetologist: 'Таргетолог',
  employee: 'Сотрудник',
}

/**
 * Get the display label for a user — prefers their employee.position
 * over the generic role label. Falls back gracefully.
 */
export function getUserPositionLabel(user: { role?: string; position?: string | null } | null | undefined): string {
  if (!user) return ''
  if (user.position && user.position.trim()) return user.position.trim()
  return ROLE_LABELS[user.role || ''] || 'Сотрудник'
}

export function getRoleLabel(role: string | undefined | null): string {
  if (!role) return 'Сотрудник'
  return ROLE_LABELS[role] || role
}

export type Permission =
  | 'clients.view'
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
  | 'tariffs.manage'
  | 'risks.view'
  | 'finance.manage'
  | 'teams.manage'
  | 'security-log.view'

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
    'tariffs.manage', 'risks.view', 'clients.view', 'security-log.view',
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
    'tariffs.manage', 'risks.view', 'finance.manage', 'teams.manage', 'clients.view', 'security-log.view',
  ],
  co_founder: [
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
    'tariffs.manage', 'risks.view', 'finance.manage', 'teams.manage', 'clients.view', 'security-log.view',
  ],
  // Руководитель по видеографии — менеджерский уровень для видео-
  // направления: управление задачами, аналитика, отчёты, риски.
  video_director: [
    'dashboard', 'projects.view', 'projects.edit',
    'projects.members.manage',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'analytics.view',
    'reports.view', 'reports.create',
    'calendar.view', 'calendar.create', 'archive.view',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat', 'risks.view',
  ],
  // Руководитель SMM — полный доступ ко ВСЕМ SMM-проектам
  // (создание/удаление/архив/смена менеджера), но без финансов.
  smm_director: [
    'dashboard', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.archive', 'projects.members.manage', 'projects.manager.change',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'analytics.view',
    'reports.view', 'reports.create',
    'calendar.view', 'calendar.create', 'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
    'ai.chat', 'tariffs.manage', 'risks.view', 'teams.manage',
  ],
  smm_specialist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
    'ai.chat',
  ],
  designer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  sales_manager_smm: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view', 'calendar.create',
    'analytics.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
    'clients.view',
  ],
  sales_manager_dev: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view', 'calendar.create',
    'analytics.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
    'clients.view',
  ],
  developer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  // Видеограф — исполнитель производства контента, права как у дизайнера.
  videographer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  // Монтажёр — исполнитель видео-продакшна.
  video_editor: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  // Организатор — исполнитель (организация съёмок/мероприятий).
  organizer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  // Сторисмейкер — ведение историй SMM-проектов. Доска проектов и Отчёты у
  // него убраны: его рабочий экран — «Истории по проектам».
  storymaker: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
    'ai.chat',
  ],
  // Сценарист / SMM-менеджер — владелец Контент-плана workflow-доски.
  scriptwriter: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
    'ai.chat',
  ],
  // Контролёр качества — этап «Внутренняя проверка».
  qa: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  // Публикатор — сбор материалов и публикация.
  publisher: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use',
    'ai.chat',
  ],
  // Таргетолог — запуск рекламы (этап «Реклама»).
  targetologist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
  employee: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view',
    'notifications.view', 'profile.view', 'time-tracker.use',
    'ai.chat',
  ],
}

export function hasPermission(role: UserRole | undefined, permission: Permission): boolean {
  if (!role) return false
  return PERMISSIONS[role]?.includes(permission) ?? false
}

/** Проверка с учётом второй роли: права = объединение обеих.
 *  Например видеограф со второй ролью «Сторисмейкер» получает
 *  stories.manage. */
export function hasPermissionAny(
  role: UserRole | undefined,
  secondaryRole: UserRole | null | undefined,
  permission: Permission,
): boolean {
  return hasPermission(role, permission)
    || (!!secondaryRole && hasPermission(secondaryRole, permission))
}

// ─── Персональные доступы (гранты) поверх роли ────────────────────────
/** Выдаваемые возможности (зеркало backend GRANTABLE). implies — какие
 *  view-права открыть, чтобы гранту было где примениться (страница/раздел). */
export const GRANTABLE_FE: Record<string, { label: string; implies: string[] }> = {
  'projects.create':     { label: 'Добавление проектов',               implies: ['projects.view'] },
  'projects.edit':       { label: 'Редактирование проектов',           implies: ['projects.view'] },
  'clients.create':      { label: 'Добавление клиентов / организаций',  implies: ['clients.view'] },
  'content-plan.manage': { label: 'Контент-план (создание и ведение)',  implies: [] },
  'tariffs.manage':      { label: 'Управление SMM-тарифами',            implies: ['tariffs.manage'] },
}

type GrantUser = { role?: string | null; secondaryRole?: string | null; extraPermissions?: string[] | null } | null | undefined

/** Может ли пользователь выполнить действие: право роли ИЛИ персональный
 *  грант ИЛИ грант, открывающий это view-право (implies). */
export function userCan(user: GrantUser, permission: string): boolean {
  if (!user) return false
  if (hasPermissionAny(user.role as UserRole, user.secondaryRole as UserRole, permission as Permission)) return true
  const extra = Array.isArray(user.extraPermissions) ? user.extraPermissions : []
  if (extra.includes(permission)) return true
  for (const g of extra) if (GRANTABLE_FE[g]?.implies.includes(permission)) return true
  return false
}

/** Управлять доступами сотрудников могут только основатель/сооснователь/админ. */
export function canManageAccess(role?: string | null): boolean {
  return role === 'admin' || role === 'founder' || role === 'co_founder'
}

/** Комбинированный лейбл ролей: «Видеограф / Монтажёр». */
export function getCombinedRoleLabel(
  role: string | undefined | null,
  secondaryRole?: string | null,
): string {
  const primary = getRoleLabel(role)
  if (!secondaryRole) return primary
  return `${primary} / ${getRoleLabel(secondaryRole)}`
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
  'clients.view': '/clients',
  'tariffs.manage': '/tariffs',
  'risks.view': '/risks',
  'finance.manage': '/finance',
  'teams.manage': '/teams',
  'security-log.view': '/security-log',
}

/** Роли, видящие глобальную «Доску проектов» — SMM-производство +
 *  руководители + топ. Менеджерам продаж и разработчику не нужна. */
export const WORKFLOW_BOARD_ROLES = [
  'admin', 'founder', 'co_founder', 'smm_director', 'video_director',
  'smm_specialist', 'designer', 'videographer', 'video_editor', 'organizer',
  'scriptwriter', 'qa', 'publisher', 'targetologist',
]
export function canSeeWorkflowBoard(role?: string | null, secondaryRole?: string | null): boolean {
  return WORKFLOW_BOARD_ROLES.includes(role || '') || WORKFLOW_BOARD_ROLES.includes(secondaryRole || '')
}

/** «Истории по проектам» — пункт только для сторисмейкера (отметка сторис по
 *  всем SMM-проектам). Остальные роли его не видят. */
export function canSeeProjectStories(role?: string | null, secondaryRole?: string | null): boolean {
  return role === 'storymaker' || secondaryRole === 'storymaker'
}

export function canAccessRoute(
  role: UserRole | undefined,
  route: string,
  secondaryRole?: UserRole | null,
  extraPermissions?: string[] | null,
): boolean {
  if (!role) return false
  const u = { role, secondaryRole, extraPermissions }

  // Always allowed routes
  if (['/profile', '/notifications', '/'].includes(route)) return true
  // Онбординг — только менеджеры по продажам.
  if (route === '/onboarding') return role === 'sales_manager_smm' || role === 'sales_manager_dev'
  // Глобальная доска проектов — SMM-производство/руководители/топ + грант КП.
  if (route === '/workflow-board') return canSeeWorkflowBoard(role, secondaryRole) || userCan(u, 'content-plan.manage')
  // «Истории по проектам» — только сторисмейкер.
  if (route === '/project-stories') return canSeeProjectStories(role, secondaryRole)
  // «Доступы сотрудников» — только основатель/сооснователь/админ.
  if (route === '/employee-access') return canManageAccess(role)

  // Detail pages — allow if user can view the parent
  if (route.startsWith('/projects/')) return userCan(u, 'projects.view')
  if (route.startsWith('/tasks/')) return hasPermissionAny(role, secondaryRole, 'tasks.view')
  if (route.startsWith('/employees/')) return hasPermissionAny(role, secondaryRole, 'employees.view')

  const perm = Object.entries(PERMISSION_TO_ROUTE).find(([_, r]) => r === route)?.[0] as Permission | undefined
  if (!perm) return true
  // Учитываем персональные гранты (например clients.view от clients.create).
  return userCan(u, perm)
}
