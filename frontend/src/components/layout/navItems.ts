import { useQuery } from '@tanstack/react-query'
import { useTranslation } from '@/i18n'
import { useAuthStore } from '@/store/auth.store'
import {
  canManageAccess, canSeeProjectStories, canSeeSmmSection, canSeeDevSection, canCheckStories, isDevLead, userCan,
  hasAnyRole, canAccessRoute, type Permission,
} from '@/lib/permissions'
import {
  LayoutDashboard, Wallet, Megaphone, StickyNote, ClipboardCheck, Calendar,
  Archive, Users, ShieldCheck, Contact, Tag, Shield, Sparkles, Code2, UserCheck,
  FileText, User as UserIcon, MessageCircle, Bell, FolderOpen, TrendingUp, Sun, Compass,
} from 'lucide-react'
import { useDirectUnread } from '@/hooks/useDirectUnread'
import { notificationsApi, tasksApi } from '@/services/api.service'

/** Роли менеджера продаж. */
export const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev'] as const

/** Менеджер продаж — основной или второй ролью (15.11.2026). Руководство
 *  со второй ролью продаж меню не меняет: у него свой набор разделов. */
export function isSalesUser(user: { role?: string | null; secondaryRole?: string | null } | null | undefined): boolean {
  if (!user || ['founder', 'admin'].includes(user.role || '')) return false
  return hasAnyRole(user.role, user.secondaryRole, SALES_ROLES)
}

/** Порядок разделов менеджера продаж (Продажи, этап 2, 15.11.2026): рабочий
 *  день начинается с «Сегодня» и «Клиентов», дальше «Директ» и «Календарь»;
 *  остальное — в прежнем порядке. */
export const SALES_NAV_ORDER = ['/', '/clients', '/direct', '/calendar']

/** «Продажи» (аналитика, заявки, нормы) — руководство и директора направлений. */
const SALES_ANALYTICS_ROLES = ['founder', 'admin', 'smm_director', 'dev_director']

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
  // «Ждут вашей проверки» — число у пункта «Задачи» (17.11.2026). Кабинет
  // поручений есть у всех, кроме основателя (пункта нет) и руководителей
  // разработки (у них полный список задач без проверки). Обновляется и по
  // событию tasks:changed (ключ в TASK_QUERY_KEYS).
  const { data: reviewData } = useQuery({
    queryKey: ['tasks-review-count'],
    queryFn: tasksApi.reviewCount,
    enabled: !!user && !user.vacation && user.role !== 'founder' && !isDevLead(user),
    staleTime: 30_000,
    refetchInterval: 300_000,
  })
  const reviewCount = Math.max(0, Number(reviewData?.count) || 0)
  // В отпуске открыт только профиль (27.10.2026).
  if (user?.vacation) return [{ to: '/profile', icon: UserIcon, label: 'Профиль', permission: 'dashboard' }]
  const isTopExec = role === 'founder'
  const isSales = isSalesUser(user)
  // «Проверка сторис» открыта, только пока у человека есть право stories.view.
  const canStoriesCheck = canCheckStories(role, secondaryRole) && userCan(user, 'stories.view')

  // «Аналитика» и «Риски» убраны из меню 19.09.2026 (решение владельца).
  // Страницы и маршруты остались в коде — вернуть можно одной строкой здесь
  // и снятием запрета в canAccessRoute.
  const items: NavItem[] = [
    // У менеджера продаж главная — экран «Сегодня» (15.11.2026).
    { to: '/',                icon: isSales ? Sun : LayoutDashboard, label: isSales ? 'Сегодня' : t('nav.dashboard'), permission: 'dashboard', exact: true },
    // «Директ» — переписка Instagram (04.11.2026). Доступ как у Базы клиентов.
    { to: '/direct',          icon: MessageCircle,   label: 'Директ',            permission: 'clients.view', badge: directUnread },
    { to: '/finance',         icon: Wallet,          label: 'Финансы',           permission: 'finance.manage' },
    { to: '/smm',             icon: Megaphone,       label: 'СММ',               permission: 'dashboard' },
    { to: '/dev',             icon: Code2,           label: 'Разработка',        permission: 'dashboard' },
    { to: '/my-notes',        icon: StickyNote,      label: 'Заметки',           permission: 'dashboard' },
    { to: '/stories-check',   icon: UserCheck,       label: 'Проверка сторис',   permission: 'stories.view' },
    // «Задачи» у всех (17.11.2026): задачи ставят не только руководители, но и
    // SMM-специалисты. Число — сколько сданных задач ждут вашей проверки.
    { to: '/tasks',           icon: ClipboardCheck,  label: 'Задачи',            permission: 'tasks.view', badge: isDevLead(user) ? undefined : reviewCount },
    { to: '/calendar',        icon: Calendar,        label: t('nav.calendar'),   permission: 'calendar.view' },
    // «Компас компании» (16.11.2026) — цели компании, отделов и свои; всем
    // ролям. Стоит после основных разделов, чтобы не сдвигать закреплённые
    // вкладки нижней панели на телефоне — там он в «Ещё».
    { to: '/compass',         icon: Compass,         label: 'Компас',            permission: 'dashboard' },
    { to: '/archive',         icon: Archive,         label: t('nav.archive'),    permission: 'archive.view' },
    { to: '/employees',       icon: Users,           label: t('nav.employees'),  permission: 'employees.view' },
    { to: '/employee-access', icon: ShieldCheck,     label: 'Доступы сотрудников', permission: 'users.manage' },
    // «Клиенты» у продаж — воронка и список лидов. «Онбординг» убран
    // (15.11.2026): старый адрес ведёт в «Клиенты → Воронка».
    { to: '/clients',         icon: Contact,         label: isSales ? 'Клиенты' : 'База клиентов', permission: 'clients.view' },
    // «Продажи» — аналитика, заявки от продаж и нормы (15.11.2026).
    { to: '/sales',           icon: TrendingUp,      label: 'Продажи',           permission: 'dashboard' },
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
  const visible = items.filter(item => {
    // Только руководству и директорам направлений; и только если маршрут
    // их пускает (страницу и гард делает отдельная задача) — без мёртвых ссылок.
    if (item.to === '/sales') {
      return hasAnyRole(role, secondaryRole, SALES_ANALYTICS_ROLES)
        && canAccessRoute(role, '/sales', secondaryRole, user?.extraPermissions, user?.deniedPermissions, user?.isStoryMaker)
    }
    // «Компас» — всем (персональные запреты его не касаются, как и маршрут).
    if (item.to === '/compass') return true
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
  if (!isSales) return visible
  // Менеджеру продаж — свой порядок; сортировка устойчивая, прочее как было.
  const rank = (to: string) => { const i = SALES_NAV_ORDER.indexOf(to); return i < 0 ? SALES_NAV_ORDER.length : i }
  return visible.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item.to) - rank(b.item.to) || a.i - b.i).map(x => x.item)
}
