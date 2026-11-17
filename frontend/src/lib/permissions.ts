/**
 * Centralized role-based access control for the CRM.
 * Each role has a defined set of allowed routes and actions.
 */

import type { UserRole, User } from '@/store/auth.store'

/** Maps role enum to a Russian display label */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  founder: 'Основатель',
  smm_director: 'Руководитель SMM',
  smm_specialist: 'SMM специалист',
  designer: 'Дизайнер',
  sales_manager_smm: 'Менеджер продаж (СММ)',
  sales_manager_dev: 'Менеджер продаж (Разработка)',
  dev_director: 'Руководитель разработки',
  pm_dev: 'Проект-менеджер (Разработка)',
  developer: 'Разработчик',
  videographer: 'Видеограф',
  video_editor: 'Монтажёр',
  producer: 'Продюсер',
  targetologist: 'Таргетолог',
  stories_checker: 'Проверяющий сторис',
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
  | 'stories.view'
  | 'organizer.directory'
  | 'time-tracker.use'
  | 'notes.use'
  | 'tariffs.manage'
  | 'risks.view'
  | 'finance.manage'
  | 'teams.manage'
  | 'security-log.view'
  | 'team-activity.view'
  | 'dev-tracker.view'
  | 'dev-tracker.manage'

const PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'dashboard', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.archive', 'projects.members.manage', 'projects.manager.change',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'employees.create', 'employees.edit', 'employees.delete',
    'employees.role.change', 'users.manage',
    'analytics.view', 'reports.view', 'reports.create', 'reports.edit.all',
    'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'stories.view', 'time-tracker.use', 'notes.use',
    'tariffs.manage', 'risks.view', 'clients.view', 'security-log.view', 'organizer.directory',
    'team-activity.view',
    'dev-tracker.view', 'dev-tracker.manage',
  ],
  founder: [
    'dashboard', 'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.archive', 'projects.members.manage', 'projects.manager.change',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'tasks.approve', 'tasks.return', 'tasks.bulk', 'tasks.export',
    'employees.view', 'employees.create', 'employees.edit', 'employees.delete',
    'employees.role.change', 'users.manage',
    'analytics.view', 'reports.view', 'reports.create', 'reports.edit.all',
    'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'ai.chat', 'stories.manage', 'stories.view', 'time-tracker.use', 'notes.use',
    'tariffs.manage', 'risks.view', 'finance.manage', 'teams.manage', 'clients.view', 'security-log.view', 'organizer.directory',
    'team-activity.view',
    'dev-tracker.view', 'dev-tracker.manage',
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
    'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'stories.manage', 'stories.view', 'time-tracker.use', 'notes.use',
    'ai.chat', 'tariffs.manage', 'risks.view', 'teams.manage', 'organizer.directory',
  ],
  smm_specialist: [
    'dashboard', 'projects.view', 'projects.create',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.manage', 'stories.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  designer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  sales_manager_smm: [
    // Проекты менеджер по продажам только смотрит: не создаёт, не правит и
    // не удаляет (решение владельца 14.11.2026, так же на сервере).
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
    'archive.view',
    'files.view', 'files.upload', 'files.delete.any',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
    'dev-tracker.view', 'dev-tracker.manage',
  ],
  // Проект-менеджер по разработке — «тестировщик» направления: все
  // dev-проекты компании, задачи-замечания, календарь и отчёты.
  // Без SMM-доски проектов, клиентов и финансов.
  pm_dev: [
    'dashboard', 'projects.view',
    // tasks.assign — ставит задачи команде разработки, а не только себе.
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
    'analytics.view',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
    'dev-tracker.view', 'dev-tracker.manage',
  ],
  developer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
    'dev-tracker.view',
  ],
  // Видеограф — исполнитель производства контента, права как у дизайнера.
  videographer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Монтажёр — исполнитель видео-продакшна.
  video_editor: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Продюсер — организует съёмки. С 09.11.2026 (решение владельца) в разделе
  // «СММ» у него права СММ-специалиста по производству: съёмки, монтаж,
  // дизайн, адрес съёмок и команда проекта; ставит задачи. Публикации,
  // бриф, рекламу и «Контроль» только смотрит, сторис не отмечает.
  producer: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'stories.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Таргетолог — запуск рекламы (этап «Реклама»).
  targetologist: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
    'reports.view', 'reports.create',
    'files.view', 'files.upload',
    'notifications.view', 'profile.view', 'time-tracker.use', 'notes.use',
    'ai.chat',
  ],
  // Проверяющий сторис — контролёр: видит ТОЛЬКО сводку «кто делал сторис,
  // а кто нет». Ни задач, ни проектов, ни отметок (stories.manage) у роли нет.
  stories_checker: [
    'dashboard', 'stories.view',
    'notifications.view', 'profile.view',
  ],
  employee: [
    'dashboard', 'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
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
/** implies — какие view-права открывает грант. Ровно то же, что
 *  GRANT_IMPLICATIONS в backend/src/modules/auth/permissions.ts, и ничего
 *  сверх: 15.11.2026 убраны clients.create ⇒ clients.view и
 *  projects.create/edit ⇒ projects.view — сервер их не знает, и меню
 *  показывало «Базу клиентов» и «Директ», где каждый запрос получал 403.
 *  Каталог возможностей приходит с бэка. */
export const GRANTABLE_FE: Record<string, { implies: string[] }> = {
  // dev-tracker.manage ⇒ dev-tracker.view (зеркало бэкенда hasGrant):
  // у кого есть управление, тот видит доску. Нужно, чтобы гард
  // /dev-board через userCan пропускал по персональному гранту manage.
  'dev-tracker.manage': { implies: ['dev-tracker.view'] },
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

/** Есть ли у человека одна из ролей — основной ИЛИ второй (15.11.2026).
 *  Разделы и подстраницы раньше смотрели только на основную роль, и,
 *  например, «МП по разработке» со второй ролью «Руководитель разработки»
 *  не видел раздела «Разработка». */
export function hasAnyRole(
  role: string | null | undefined,
  secondaryRole: string | null | undefined,
  roles: readonly string[],
): boolean {
  return [role, secondaryRole].some(r => !!r && roles.includes(r))
}

/** Управлять доступами сотрудников могут только основатель и админ. */
export function canManageAccess(role?: string | null): boolean {
  return role === 'admin' || role === 'founder'
}

/** Страница «Проверка сторис» — контролёр сторис и руководство.
 *  Обычный SMM-специалист сюда не ходит: у него своя отметка в кабинете. */
export function canCheckStories(role?: string | null, secondaryRole?: string | null): boolean {
  const CHECKERS = ['stories_checker', 'admin', 'founder', 'smm_director']
  return [role, secondaryRole].some(r => !!r && CHECKERS.includes(r))
}

/** Раздел «СММ» (Умный календарь / Сторисы / Проекты / Контроль) — вся
 *  СММ-команда, топ-менеджмент и менеджеры по продажам обоих видов
 *  (11.10.2026, подтверждено владельцем 15.10.2026: видят раздел целиком,
 *  но только смотрят — см. isSmmViewOnly). Команде разработки раздел закрыт.
 *  Роли совпадают с бэкендом (эндпоинт smm-calendar). */
export function canSeeSmmSection(role?: string | null, secondaryRole?: string | null): boolean {
  // Вторая роль тоже открывает раздел (15.11.2026).
  return hasAnyRole(role, secondaryRole, ['founder', 'admin', 'smm_director', 'smm_specialist', 'producer', 'sales_manager_smm', 'sales_manager_dev'])
}

/** Продюсер без СММ-роли (09.11.2026): в разделе «СММ» правит только
 *  производство — съёмки, монтаж, дизайн; публикации смотрит. Так же на
 *  сервере (content-plan.service, isProductionOnly). */
export function isProductionOnly(role?: string | null, secondaryRole?: string | null): boolean {
  const roles = [role, secondaryRole].filter(Boolean) as string[]
  return roles.includes('producer') && !roles.some(r => ['admin', 'founder', 'smm_director', 'smm_specialist'].includes(r))
}

/** Менеджеры по продажам в разделе «СММ» — наблюдатели: календарь, сторис
 *  и проекты только смотрят, отмечают лишь на странице «Контроль». Сервер
 *  держит то же правило сам — у изменяющих ручек этих ролей нет; здесь
 *  флаг нужен, чтобы не показывать кнопки, которые всё равно не сработают. */
export function isSmmViewOnly(role?: string | null): boolean {
  return role === 'sales_manager_smm' || role === 'sales_manager_dev'
}

/** Раздел «Разработка» (Доска / Проекты / KPI / Отчёты) — команда разработки
 *  и топ-менеджмент. Свои страницы, отдельные от СММ (14.10.2026): рилсов,
 *  циклов и контент-плана у разработки нет, календарь — вид «Календарь»
 *  на доске задач.
 *  NOTE: sales_manager_dev есть в DEV_TEAM_ROLES ниже (скоп данных: видит
 *  dev-проекты в списках/KPI), но доступа к «Доске разработки» у него НЕТ —
 *  ни здесь, ни в PERMISSIONS (dev-tracker.view), ни в бэкенде (GRANTABLE).
 *  Доска открывается только грантом dev-tracker.view. Не добавлять его сюда
 *  без выдачи права — иначе меню покажется, а гард userCan не пустит. */
export function canSeeDevSection(role?: string | null, secondaryRole?: string | null): boolean {
  // Вторая роль тоже открывает раздел (15.11.2026): «МП по разработке» со
  // второй ролью «Руководитель разработки» раньше раздела не видел.
  return hasAnyRole(role, secondaryRole, ['founder', 'admin', 'dev_director', 'pm_dev', 'developer'])
}

// ─── Раздел «Продажи» (/sales) — 15.11.2026 ──────────────────────────
// Аналитика продаж, заявки от продаж (передачи в работу) и настройки норм
// и комиссии. Договор — docs/SALES_SPEC.md §5. Помощник администратора
// приходит с ролью admin (effectiveRoleOf на сервере), co_founder слит в
// admin миграцией 1809 — держим его в списке на случай старых токенов.

/** Руководство компании в разделе «Продажи». */
const SALES_TOP_ROLES = ['founder', 'co_founder', 'admin'] as const
/** Руководители направлений: видят только «Заявки» своего направления. */
const SALES_DIRECTOR_ROLES = ['smm_director', 'dev_director'] as const

/** Открыт ли раздел «Продажи» (маршрут /sales и пункт меню). */
export function canSeeSalesHub(role?: string | null, secondaryRole?: string | null): boolean {
  return hasAnyRole(role, secondaryRole, [...SALES_TOP_ROLES, ...SALES_DIRECTOR_ROLES])
}

/** «Аналитика» и «Настройки» раздела — только руководство. */
export function canSeeSalesAnalytics(role?: string | null, secondaryRole?: string | null): boolean {
  return hasAnyRole(role, secondaryRole, SALES_TOP_ROLES)
}

/** «Заявки от продаж» — руководство и руководители направлений. */
export function canSeeSalesHandoffs(role?: string | null, secondaryRole?: string | null): boolean {
  return canSeeSalesHub(role, secondaryRole)
}

/** Нормы KPI правят основатель и админ (PUT /sales/settings, §5). */
export function canEditSalesNorms(role?: string | null, secondaryRole?: string | null): boolean {
  return hasAnyRole(role, secondaryRole, SALES_TOP_ROLES)
}

/** Комиссию менеджеров меняет только основатель. */
export function canEditSalesCommission(role?: string | null, secondaryRole?: string | null): boolean {
  return hasAnyRole(role, secondaryRole, ['founder'])
}

/** Связать заявку с уже существующим проектом — руководство
 *  (POST /sales/handoffs/:leadId/link). */
export function canLinkHandoff(role?: string | null, secondaryRole?: string | null): boolean {
  return hasAnyRole(role, secondaryRole, SALES_TOP_ROLES)
}

/** Создать проект по заявке: руководство — любой, руководитель SMM —
 *  SMM, руководитель разработки — разработку (так же проверяет сервер при
 *  создании проекта). */
export function canCreateHandoffProject(
  role: string | null | undefined,
  secondaryRole: string | null | undefined,
  direction: 'smm' | 'development',
): boolean {
  if (hasAnyRole(role, secondaryRole, SALES_TOP_ROLES)) return true
  return hasAnyRole(role, secondaryRole, [direction === 'smm' ? 'smm_director' : 'dev_director'])
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

/** Maps a permission to the route it grants access to.
 *  /reports и /teams убраны 15.11.2026: таких страниц в приложении нет. */
const PERMISSION_TO_ROUTE: Record<string, string> = {
  'dashboard': '/',
  'projects.view': '/projects',
  'tasks.view': '/tasks',
  'employees.view': '/employees',
  'calendar.view': '/calendar',
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
  'security-log.view': '/security-log',
  'team-activity.view': '/team-activity',
  'dev-tracker.view': '/dev-board',
}

/** «Заметки» — пункт для того, у кого на карточке сотрудника стоит флаг
 *  «сторисмейкер» (он же открывает истории всех SMM-проектов). Роль
 *  storymaker убрана 25.09.2026, флаг остался. */
export function canSeeProjectStories(isStoryMaker?: boolean | null): boolean {
  return !!isStoryMaker
}

/** Руководитель направления разработки — основной ролью или второй (у Сабрины
 *  она поверх «МП по разработке»). Его кабинет показывает ТОЛЬКО разработку:
 *  ни SMM-разделов, ни SMM-сотрудников, ни общекомпанейских цифр. Бэкенд
 *  сегментирует данные сам (common/direction-scope.ts), фронт прячет разделы. */
export function isDevDirector(user?: { role?: string | null; secondaryRole?: string | null } | null): boolean {
  return !!user && (user.role === 'dev_director' || user.secondaryRole === 'dev_director')
}

/** Кто ведёт задачи направления разработки: руководитель и проект-менеджер.
 *  Обоим нужен полный раздел «Задачи» — со списком команды, фильтрами и
 *  созданием, — а не личный кабинет поручений. Видимость всё равно
 *  ограничена направлением на сервере (directionScopeOf). */
export function isDevLead(user?: { role?: string | null; secondaryRole?: string | null } | null): boolean {
  const roles = [user?.role, user?.secondaryRole]
  return roles.some(r => r === 'dev_director' || r === 'pm_dev')
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
  isStoryMaker?: boolean | null,
): boolean {
  if (!role) return false
  const u = { role, secondaryRole, extraPermissions, deniedPermissions }

  // Always allowed routes
  if (['/profile', '/notifications', '/'].includes(route)) return true
  // «Компас компании» (16.11.2026) — всем ролям: цели компании видят все,
  // что показать на экране отдела, сервер решает сам (GOALS_SPEC §6).
  if (route === '/compass' || route.startsWith('/compass/')) return true
  // Онбординг — только менеджеры по продажам (основной или второй ролью).
  if (route === '/onboarding') return hasAnyRole(role, secondaryRole, ['sales_manager_smm', 'sales_manager_dev']) && userCan(u, 'clients.view')
  // «Доска проектов» удалена из системы (сент. 2026) — вся работа в Умном
  // календаре. Старый адрес держим закрытым на случай сохранённых ссылок.
  if (route === '/workflow-board') return false
  // Общий список «Проекты» (/projects) убран из приложения у всех. Детальная
  // карточка /projects/:id остаётся (ссылки из уведомлений и пр.).
  if (route === '/projects') return false
  // «Заметки» — только сторисмейкер (по флагу на карточке), и лишь пока
  // соответствующую возможность у него не отняли в «Доступах сотрудников».
  if (route === '/my-notes') return canSeeProjectStories(isStoryMaker) && userCan(u, 'notes.use')
  // «Доступы сотрудников» — только основатель/админ.
  if (route === '/employee-access') return canManageAccess(role)
  // «Отчёты СММ» (ежедневный автоотчёт) удалены полностью.
  if (route === '/smm-daily') return false
  // «Аналитика» и «Риски» убраны из системы (решение владельца, 19.09.2026).
  // Код страниц цел — закрыты маршруты и убраны пункты меню, чтобы вернуть
  // можно было одной правкой, а не восстановлением из истории.
  if (route === '/analytics') return false
  if (route === '/risks') return false
  // «Проверка сторис» — только контролёр и руководство; право можно отнять
  // персональным запретом (userCan), тогда страница закрывается.
  if (route === '/stories-check') return canCheckStories(role, secondaryRole) && userCan(u, 'stories.view')
  // «СММ» и все подстраницы (Умный календарь / Сторисы / Проекты) — СММ-команда + топ.
  if (route === '/smm' || route.startsWith('/smm/')) return canSeeSmmSection(role, secondaryRole)
  // «Разработка» и подстраницы (Умный календарь / Проекты) — dev-команда + топ.
  // Алиасы доски идут по тем же грантам, что каноника /dev-board* (иначе
  // два URL одной страницы имели бы разный гард): board/kpi — view, reports — manage.
  if (route === '/dev/board' || route === '/dev/kpi') return userCan(u, 'dev-tracker.view')
  if (route === '/dev/reports') return userCan(u, 'dev-tracker.manage')
  if (route === '/dev' || route.startsWith('/dev/')) return canSeeDevSection(role, secondaryRole)
  // «Доска разработки» (канбан dev-трекера) и подстраницы — по гранту
  // dev-tracker.view через userCan (как /tasks/:id ниже), чтобы работали
  // extraPermissions/deniedPermissions/secondaryRole. Исключение — страница
  // отчётов: только manage (как алиас /dev/reports, меню и API).
  if (route === '/dev-board/reports') return userCan(u, 'dev-tracker.manage')
  if (route === '/dev-board' || route.startsWith('/dev-board/')) return userCan(u, 'dev-tracker.view')
  // «Продажи» (15.11.2026): руководство и руководители направлений; вкладки
  // внутри страницы режет сама страница (директорам — только «Заявки»).
  if (route === '/sales' || route.startsWith('/sales/')) return canSeeSalesHub(role, secondaryRole)
  // «Активность команды» — мониторинг для основателя/админа.
  if (route === '/team-activity') return hasAnyRole(role, secondaryRole, ['founder', 'admin'])
  // «Тест новый» — черновой раздел: основатель и админ.
  if (route === '/test-new') return hasAnyRole(role, secondaryRole, ['founder', 'admin'])
  // «Директ» (переписка Instagram) — как База клиентов: по гранту clients.view.
  if (route === '/direct' || route.startsWith('/direct/')) return userCan(u, 'clients.view')
  // Финансы и все подстраницы — по гранту finance.manage.
  if (route === '/finance' || route.startsWith('/finance/')) return userCan(u, 'finance.manage')
  // Справочники организатора съёмок (клиенты/модели/места).
  if (route.startsWith('/organizer/')) return userCan(u, 'organizer.directory')

  // Detail pages — allow if user can view the parent
  if (route.startsWith('/projects/')) return userCan(u, 'projects.view')
  // userCan, а не hasPermissionAny: иначе персональный запрет закрывал бы
  // пункт меню, но страница по прямой ссылке всё равно открывалась.
  if (route.startsWith('/tasks/')) return userCan(u, 'tasks.view')
  // Подстраницы «Сотрудников» (19.10.2026): кто видит — как раньше видел
  // соответствующий значок на странице.
  if (route === '/employees/sales-plan') return hasAnyRole(role, secondaryRole, ['founder'])
  if (['/employees/kpi', '/employees/week', '/employees/activity'].includes(route)) return hasAnyRole(role, secondaryRole, ['founder', 'admin'])
  if (route.startsWith('/employees/')) return userCan(u, 'employees.view')

  const perm = Object.entries(PERMISSION_TO_ROUTE).find(([_, r]) => r === route)?.[0] as Permission | undefined
  if (!perm) return true
  // Учитываем персональные гранты и запреты (userCan).
  return userCan(u, perm)
}
