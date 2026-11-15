import { useQuery } from '@tanstack/react-query'
import { useTranslation } from '@/i18n'
import { useAuthStore } from '@/store/auth.store'
import {
  canManageAccess, canSeeProjectStories, canSeeSmmSection, canSeeDevSection, canCheckStories, isDevLead, userCan,
  hasAnyRole, type Permission,
} from '@/lib/permissions'
import {
  LayoutDashboard, Wallet, Megaphone, StickyNote, ClipboardCheck, Calendar,
  Archive, Users, ShieldCheck, Contact, UserPlus, Tag, Shield, Sparkles, Code2, UserCheck,
  FileText, User as UserIcon, MessageCircle, Bell, FolderOpen,
} from 'lucide-react'
import { useDirectUnread } from '@/hooks/useDirectUnread'
import { notificationsApi } from '@/services/api.service'

export interface NavItem {
  to: string
  icon: any
  label: string
  permission: Permission
  exact?: boolean
  /** Число в кружке у пункта (непрочитанные чаты «Директа»). */
  badge?: number
}

/** Пункты меню и правила видимости — ОДИН источник для бокового меню и для
 *  нижней панели на телефоне. Раньше список жил внутри Sidebar; при двух
 *  копиях правила прав разошлись бы при первой же правке. */
export function useNavItems(): NavItem[] {
  const user = useAuthStore(s => s.user)
  const { t } = useTranslation()

  const role = user?.role
  const secondaryRole = user?.secondaryRole
  // Хуки — до раннего выхода: порядок хуков не должен зависеть от отпуска.
  const directUnread = useDirectUnread()
  // Непрочитанные уведомления — число у пункта «Уведомления» (15.11.2026).
  // Ключ тот же, что сбрасывает страница уведомлений и сокет ('notification').
  const { data: notifCount } = useQuery({
    queryKey: ['unread-count'],
    queryFn: notificationsApi.unreadCount,
    enabled: !!user && !user.vacation,
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
  // Сервер отдаёт {count}; на всякий случай понимаем и голое число (15.11.2026).
  const notifUnread = Math.max(0, Number(typeof notifCount === 'number' ? notifCount : notifCount?.count) || 0)
  // В отпуске открыт только профиль (27.10.2026).
  if (user?.vacation) return [{ to: '/profile', icon: UserIcon, label: 'Профиль', permission: 'dashboard' }]
  const isTopExec = role === 'founder'
  const isSalesManager = role === 'sales_manager_smm' || role === 'sales_manager_dev'
  // «Проверка сторис» открыта, только пока у человека есть право stories.view.
  const canStoriesCheck = canCheckStories(role, secondaryRole) && userCan(user, 'stories.view')

  // «Аналитика» и «Риски» убраны из меню 19.09.2026 (решение владельца).
  // Страницы и маршруты остались в коде — вернуть можно одной строкой здесь
  // и снятием запрета в canAccessRoute.
  const items: NavItem[] = [
    { to: '/',                icon: LayoutDashboard, label: t('nav.dashboard'), permission: 'dashboard', exact: true },
    // «Директ» — переписка Instagram (04.11.2026). Доступ как у Базы клиентов.
    { to: '/direct',          icon: MessageCircle,   label: 'Директ',            permission: 'clients.view', badge: directUnread },
    { to: '/finance',         icon: Wallet,          label: 'Финансы',           permission: 'finance.manage' },
    { to: '/smm',             icon: Megaphone,       label: 'СММ',               permission: 'dashboard' },
    { to: '/dev',             icon: Code2,           label: 'Разработка',        permission: 'dashboard' },
    { to: '/my-notes',        icon: StickyNote,      label: 'Заметки',           permission: 'dashboard' },
    { to: '/stories-check',   icon: UserCheck,       label: 'Проверка сторис',   permission: 'stories.view' },
    { to: '/tasks',           icon: ClipboardCheck,  label: isDevLead(user) ? 'Задачи' : 'Задачи от руководителя', permission: 'tasks.view' },
    { to: '/calendar',        icon: Calendar,        label: t('nav.calendar'),   permission: 'calendar.view' },
    { to: '/archive',         icon: Archive,         label: t('nav.archive'),    permission: 'archive.view' },
    { to: '/employees',       icon: Users,           label: t('nav.employees'),  permission: 'employees.view' },
    { to: '/employee-access', icon: ShieldCheck,     label: 'Доступы сотрудников', permission: 'users.manage' },
    { to: '/clients',         icon: Contact,         label: 'База клиентов',     permission: 'clients.view' },
    { to: '/onboarding',      icon: UserPlus,        label: 'Онбординг',         permission: 'clients.view' },
    { to: '/tariffs',         icon: Tag,             label: 'SMM-тарифы',        permission: 'tariffs.manage' },
    { to: '/security-log',    icon: Shield,          label: 'Журнал безопасности', permission: 'security-log.view' },
    { to: '/ai',              icon: Sparkles,        label: 'ИИ-помощник',       permission: 'ai.chat' },
    // Уведомления и Файлы (15.11.2026): страницы были, а пунктов меню — нет,
    // и после убранной верхней панели до них было не добраться.
    { to: '/notifications',   icon: Bell,            label: 'Уведомления',       permission: 'notifications.view', badge: notifUnread },
    { to: '/files',           icon: FolderOpen,      label: 'Файлы',             permission: 'files.view' },
    { to: '/test-new',        icon: FileText,        label: 'Тест новый',        permission: 'dashboard' },
  ]

  // Роли разделов — основная ИЛИ вторая (15.11.2026), как в canAccessRoute.
  return items.filter(item => {
    if (item.to === '/onboarding' && !hasAnyRole(role, secondaryRole, ['sales_manager_dev'])) return false
    if (item.to === '/my-notes') return canSeeProjectStories(user?.isStoryMaker) && userCan(user, 'notes.use')
    if (item.to === '/employee-access') return canManageAccess(role)
    if (item.to === '/stories-check') return canStoriesCheck
    // Проверяющему сторис «Панель» не нужна: главная сразу ведёт на его
    // страницу. Если «Проверку» у него отняли, главная — обычная панель.
    if (item.to === '/') return role !== 'stories_checker' || !canStoriesCheck
    if (item.to === '/smm') return canSeeSmmSection(role, secondaryRole)
    if (item.to === '/dev') return canSeeDevSection(role, secondaryRole)
    if (item.to === '/tasks') return !isTopExec
    // «Тест новый» — пока только для руководства, это черновой раздел.
    if (item.to === '/test-new') return hasAnyRole(role, secondaryRole, ['founder', 'admin'])
    return userCan(user, item.permission)
  })
}
