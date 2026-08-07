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
  dev_director: 'Руководитель разработки',
  pm_dev: 'Проект-менеджер (Разработка)',
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
  | 'organizer.directory'
  | 'time-tracker.use'
  | 'notes.use'
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
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'time-tracker.use', 'notes.use',
    'tariffs.manage', 'risks.view', 'clients.view', 'security-log.view', 'organizer.directory',
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
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'time-tracker.use', 'notes.use',
    'tariffs.manage', 'risks.view', 'finance.manage', 'teams.manage', 'clients.view', 'security-log.view', 'organizer.directory',
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
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'time-tracker.use', 'notes.use',
    'tariffs.manage', 'risks.view', 'finance.manage', 'teams.manage', 'clients.view', 'security-log.view', 'organizer.directory',
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
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
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
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use', 'notes.use',
    'ai.chat', 'tariffs.manage', 'risks.view', 'teams.manage', 'organizer.directory',
  ],
  smm_specialist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  designer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  sales_manager_smm: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view', 'calendar.create',
    // «Архив» у менеджера продаж — его личный список скрытых проектов.
    'archive.view',
    'analytics.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
    'clients.view',
  ],
  sales_manager_dev: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view', 'calendar.create',
    'archive.view',
    'analytics.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
    'clients.view',
  ],
  // Руководитель направления разработки — зеркало smm_director для dev:
  // все dev-проекты, задачи команде (approve/return/bulk), доска
  // «Разработка». Без SMM-доски, сторис и тарифов.
  dev_director: [
    'dashboard', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.archive', 'projects.members.manage', 'projects.manager.change',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'analytics.view', 'risks.view',
    'reports.view', 'reports.create',
    'calendar.view', 'calendar.create', 'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Проект-менеджер по разработке — «тестировщик» направления: все
  // dev-проекты компании, задачи-замечания, календарь и отчёты.
  // Без SMM-доски проектов, клиентов и финансов.
  pm_dev: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view', 'calendar.create',
    'analytics.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  developer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Видеограф — исполнитель производства контента, права как у дизайнера.
  videographer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Монтажёр — исполнитель видео-продакшна.
  video_editor: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Организатор — исполнитель (организация съёмок/мероприятий).
  organizer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat', 'organizer.directory',
  ],
  // Сторисмейкер — ведение историй SMM-проектов. Доска проектов и Отчёты у
  // него убраны: его рабочий экран — «Истории по проектам».
  storymaker: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Сценарист / SMM-менеджер — владелец Контент-плана workflow-доски.
  scriptwriter: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Контролёр качества — этап «Внутренняя проверка».
  qa: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Публикатор — сбор материалов и публикация.
  publisher: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Таргетолог — запуск рекламы (этап «Реклама»).
  targetologist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  employee: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'calendar.view',
    'reports.view', 'reports.create',
    'files.view',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
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
/** implies — какие view-права открывает грант, чтобы ему было где
 *  примениться (раздел/страница). Каталог возможностей приходит с бэка. */
export const GRANTABLE_FE: Record<string, { implies: string[] }> = {
  'projects.create': { implies: ['projects.view'] },
  'projects.edit':   { implies: ['projects.view'] },
  'clients.create':  { implies: ['clients.view'] },
}

type GrantUser = {
  role?: string | null
  secondaryRole?: string | null
  extraPermissions?: string[] | null
  deniedPermissions?: string[] | null
} | null | undefined

/** Может ли пользователь выполнить действие: право роли ИЛИ персональный
 *  грант ИЛИ грант, открывающий это view-право (implies).
 *  Персональный ЗАПРЕТ сильнее всего — снимает и право роли, и грант
 *  (та же логика, что в backend/src/modules/auth/permissions.ts). */
export function userCan(user: GrantUser, permission: string): boolean {
  if (!user) return false
  const denied = Array.isArray(user.deniedPermissions) ? user.deniedPermissions : []
  if (denied.includes(permission)) return false
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

/** «Отчёты СММ» (ежедневный автоотчёт команды) — по требованию основателя
 *  видит ТОЛЬКО основатель (пока). */
export function canSeeSmmDaily(role?: string | null): boolean {
  return role === 'founder'
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

/** Вид «Разработка» на доске проектов — канбан dev-проектов по бизнес-этапам
 *  [10%]…[100%]. Топ видит оба вида (переключатель), pm_dev — только этот. */
export const DEV_BOARD_ROLES = ['admin', 'founder', 'co_founder', 'dev_director', 'pm_dev', 'developer']
export function canSeeDevBoard(role?: string | null, secondaryRole?: string | null): boolean {
  return DEV_BOARD_ROLES.includes(role || '') || DEV_BOARD_ROLES.includes(secondaryRole || '')
}

/** «Истории по проектам» — пункт только для сторисмейкера (отметка сторис по
 *  всем SMM-проектам). Остальные роли его не видят. */
export function canSeeProjectStories(role?: string | null, secondaryRole?: string | null): boolean {
  return role === 'storymaker' || secondaryRole === 'storymaker'
}

/** Руководитель направления разработки — основной ролью или второй (у Сабрины
 *  она поверх «МП по разработке»). Его кабинет показывает ТОЛЬКО разработку:
 *  ни SMM-разделов, ни SMM-сотрудников, ни общекомпанейских цифр. Бэкенд
 *  сегментирует данные сам (common/direction-scope.ts), фронт прячет разделы. */
export function isDevDirector(user?: { role?: string | null; secondaryRole?: string | null } | null): boolean {
  return !!user && (user.role === 'dev_director' || user.secondaryRole === 'dev_director')
}

/** Команда разработки — кого руководитель видит в списках, KPI и задачах.
 *  Двойник backend/src/common/direction-scope.ts (DEV_TEAM_ROLES). */
export const DEV_TEAM_ROLES = ['developer', 'pm_dev', 'sales_manager_dev', 'dev_director']

export function canAccessRoute(
  role: UserRole | undefined,
  route: string,
  secondaryRole?: UserRole | null,
  extraPermissions?: string[] | null,
  deniedPermissions?: string[] | null,
): boolean {
  if (!role) return false
  const u = { role, secondaryRole, extraPermissions, deniedPermissions }

  // Always allowed routes
  if (['/profile', '/notifications', '/'].includes(route)) return true
  // Онбординг — только менеджеры по продажам.
  if (route === '/onboarding') return (role === 'sales_manager_smm' || role === 'sales_manager_dev') && userCan(u, 'clients.view')
  // Глобальная доска проектов — SMM-производство/руководители/топ + грант КП,
  // плюс pm_dev (его вид — «Разработка»).
  if (route === '/workflow-board') return canSeeWorkflowBoard(role, secondaryRole) || canSeeDevBoard(role, secondaryRole) || userCan(u, 'content-plan.manage') || userCan(u, 'board.view')
  // «Истории по проектам» и «Заметки» — только сторисмейкер, и лишь пока
  // соответствующую возможность у него не отняли в «Доступах сотрудников».
  if (route === '/project-stories') return canSeeProjectStories(role, secondaryRole) && userCan(u, 'stories.manage')
  if (route === '/my-notes') return canSeeProjectStories(role, secondaryRole) && userCan(u, 'notes.use')
  // «Доступы сотрудников» — только основатель/сооснователь/админ.
  if (route === '/employee-access') return canManageAccess(role)
  // «Отчёты СММ» (ежедневный автоотчёт) — только основатель.
  if (route === '/smm-daily') return canSeeSmmDaily(role)
  // Финансы и все подстраницы — по гранту finance.manage.
  if (route === '/finance' || route.startsWith('/finance/')) return userCan(u, 'finance.manage')
  // Справочники организатора съёмок (клиенты/модели/места).
  if (route.startsWith('/organizer/')) return userCan(u, 'organizer.directory')

  // Detail pages — allow if user can view the parent
  if (route.startsWith('/projects/')) return userCan(u, 'projects.view')
  // userCan, а не hasPermissionAny: иначе персональный запрет закрывал бы
  // пункт меню, но страница по прямой ссылке всё равно открывалась.
  if (route.startsWith('/tasks/')) return userCan(u, 'tasks.view')
  if (route.startsWith('/employees/')) return userCan(u, 'employees.view')

  const perm = Object.entries(PERMISSION_TO_ROUTE).find(([_, r]) => r === route)?.[0] as Permission | undefined
  if (!perm) return true
  // Учитываем персональные гранты (например clients.view от clients.create).
  return userCan(u, perm)
}
