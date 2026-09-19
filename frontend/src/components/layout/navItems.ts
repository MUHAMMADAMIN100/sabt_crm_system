import { useTranslation } from '@/i18n'
import { useAuthStore } from '@/store/auth.store'
import {
  canManageAccess, canSeeProjectStories, canSeeSmmSection, canSeeDevSection, canCheckStories, isDevDirector, userCan,
  type Permission,
} from '@/lib/permissions'
import {
  LayoutDashboard, Wallet, Megaphone, StickyNote, ClipboardCheck, Calendar,
  Archive, Users, ShieldCheck, Contact, UserPlus, Tag, Shield, Sparkles, Code2, UserCheck,
} from 'lucide-react'

export interface NavItem {
  to: string
  icon: any
  label: string
  permission: Permission
  exact?: boolean
}

/** Пункты меню и правила видимости — ОДИН источник для бокового меню и для
 *  нижней панели на телефоне. Раньше список жил внутри Sidebar; при двух
 *  копиях правила прав разошлись бы при первой же правке. */
export function useNavItems(): NavItem[] {
  const user = useAuthStore(s => s.user)
  const { t } = useTranslation()

  const role = user?.role
  const secondaryRole = user?.secondaryRole
  const isTopExec = role === 'founder' || role === 'co_founder'
  const isSalesManager = role === 'sales_manager_smm' || role === 'sales_manager_dev'

  // «Аналитика» и «Риски» убраны из меню 19.09.2026 (решение владельца).
  // Страницы и маршруты остались в коде — вернуть можно одной строкой здесь
  // и снятием запрета в canAccessRoute.
  const items: NavItem[] = [
    { to: '/',                icon: LayoutDashboard, label: t('nav.dashboard'), permission: 'dashboard', exact: true },
    { to: '/finance',         icon: Wallet,          label: 'Финансы',           permission: 'finance.manage' },
    { to: '/smm',             icon: Megaphone,       label: 'СММ',               permission: 'dashboard' },
    { to: '/dev',             icon: Code2,           label: 'Разработка',        permission: 'dashboard' },
    { to: '/my-notes',        icon: StickyNote,      label: 'Заметки',           permission: 'dashboard' },
    { to: '/stories-check',   icon: UserCheck,       label: 'Проверка сторис',   permission: 'stories.view' },
    { to: '/tasks',           icon: ClipboardCheck,  label: isDevDirector(user) ? 'Задачи' : 'Задачи от руководителя', permission: 'tasks.view' },
    { to: '/calendar',        icon: Calendar,        label: t('nav.calendar'),   permission: 'calendar.view' },
    { to: '/archive',         icon: Archive,         label: t('nav.archive'),    permission: 'archive.view' },
    { to: '/employees',       icon: Users,           label: t('nav.employees'),  permission: 'employees.view' },
    { to: '/employee-access', icon: ShieldCheck,     label: 'Доступы сотрудников', permission: 'users.manage' },
    { to: '/clients',         icon: Contact,         label: 'База клиентов',     permission: 'clients.view' },
    { to: '/onboarding',      icon: UserPlus,        label: 'Онбординг',         permission: 'clients.view' },
    { to: '/tariffs',         icon: Tag,             label: 'SMM-тарифы',        permission: 'tariffs.manage' },
    { to: '/security-log',    icon: Shield,          label: 'Журнал безопасности', permission: 'security-log.view' },
    { to: '/ai',              icon: Sparkles,        label: 'ИИ-помощник',       permission: 'ai.chat' },
  ]

  return items.filter(item => {
    if (item.to === '/onboarding' && role !== 'sales_manager_dev') return false
    if (item.to === '/my-notes') return canSeeProjectStories(role, secondaryRole) && userCan(user, 'notes.use')
    if (item.to === '/employee-access') return canManageAccess(role)
    if (item.to === '/stories-check') return canCheckStories(role, secondaryRole) && userCan(user, 'stories.view')
    // Проверяющему сторис «Панель» не нужна: главная сразу ведёт на его страницу.
    if (item.to === '/') return role !== 'stories_checker'
    if (item.to === '/smm') return canSeeSmmSection(role)
    if (item.to === '/dev') return canSeeDevSection(role)
    if (item.to === '/tasks') return !isTopExec
    return userCan(user, item.permission)
  })
}
