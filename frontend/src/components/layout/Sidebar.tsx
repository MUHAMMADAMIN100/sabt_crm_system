import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { hasPermission, getUserPositionLabel, type Permission } from '@/lib/permissions'
import { Avatar } from '@/components/ui'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users, Calendar,
  FileText, BarChart3, Archive, X, Sparkles, Contact, Tag, ShieldAlert, Wallet, UserCog, UserPlus,
  Shield, LogOut, RotateCcw,
} from 'lucide-react'
import clsx from 'clsx'

interface SidebarProps { open: boolean; onClose: () => void }

/** Тёмный сайдбар в корпоративном стиле (по референсу GRANT CHINA, но с
 *  нашим indigo акцентом вместо красного). Фон #0f0f12, белый текст,
 *  активный пункт — сплошная заливка primary, без декоративных точек.
 *  Пользовательский блок внизу — компактный, с быстрыми действиями. */
export default function Sidebar({ open, onClose }: SidebarProps) {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const { t } = useTranslation()

  const handleNavClick = () => {
    if (window.innerWidth < 993) onClose()
  }

  const role = user?.role
  const isTopExec = role === 'founder' || role === 'co_founder'

  const navItems: { to: string; icon: any; label: string; permission: Permission; exact?: boolean }[] = [
    { to: '/',              icon: LayoutDashboard, label: t('nav.dashboard'),  permission: 'dashboard',         exact: true },
    { to: '/projects',      icon: FolderKanban,    label: t('nav.projects'),   permission: 'projects.view' },
    ...(isTopExec ? [] : [
      { to: '/tasks',       icon: CheckSquare,     label: t('nav.tasks'),      permission: 'tasks.view' as Permission },
    ]),
    { to: '/calendar',      icon: Calendar,        label: t('nav.calendar'),   permission: 'calendar.view' },
    { to: '/reports',       icon: FileText,        label: t('nav.reports'),    permission: 'reports.view' },
    { to: '/analytics',     icon: BarChart3,       label: t('nav.analytics'),  permission: 'analytics.view' },
    { to: '/archive',       icon: Archive,         label: t('nav.archive'),    permission: 'archive.view' },
    { to: '/employees',     icon: Users,           label: t('nav.employees'),  permission: 'employees.view' },
    { to: '/clients',       icon: Contact,         label: 'База клиентов',     permission: 'clients.view' },
    { to: '/onboarding',    icon: UserPlus,        label: 'Онбординг',         permission: 'clients.view' },
    { to: '/tariffs',       icon: Tag,             label: 'SMM-тарифы',        permission: 'tariffs.manage' },
    { to: '/risks',         icon: ShieldAlert,     label: 'Риски',             permission: 'risks.view' },
    { to: '/finance',       icon: Wallet,          label: 'Финансы',           permission: 'finance.manage' },
    { to: '/teams',         icon: UserCog,         label: 'Команды',           permission: 'teams.manage' },
    { to: '/security-log',  icon: Shield,          label: 'Журнал безопасности', permission: 'security-log.view' },
    { to: '/ai',            icon: Sparkles,        label: 'ИИ-помощник',       permission: 'ai.chat' },
  ]

  const hideTeamsRoles = ['smm_director', 'video_director']
  const isSalesManager = role === 'sales_manager_smm' || role === 'sales_manager_dev'
  const filtered = navItems.filter(item => {
    if (item.to === '/teams' && hideTeamsRoles.includes(role || '')) return false
    // Аналитика и Отчёты — не зона работы менеджеров продаж.
    if (isSalesManager && (item.to === '/reports' || item.to === '/analytics')) return false
    // Онбординг: у sales_manager_smm встроен переключателем в Базу клиентов —
    // отдельный пункт скрываем. У sales_manager_dev — отдельный пункт сайдбара
    // (по запросу пользователя). Остальным ролям пункт не нужен.
    if (item.to === '/onboarding' && role !== 'sales_manager_dev') return false
    return hasPermission(role, item.permission)
  })

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-30 flex flex-col h-full',
        'bg-[#0f0f12] text-surface-200',
        'border-r border-black/40',
        'overflow-hidden',
        open ? 'w-[260px]' : 'w-0 lg:w-[72px]',
      )}
    >
      {/* Логотип. Открытое состояние — wordmark, свёрнутое — крупная S */}
      <div className="flex items-center justify-between h-[68px] px-4 shrink-0 overflow-hidden border-b border-white/5">
        <div className="flex items-center min-w-0 flex-1">
          {open ? (
            <div className="flex items-baseline gap-0.5 select-none">
              <span className="text-2xl font-extrabold tracking-tight text-white" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
                sabt
              </span>
              <span className="text-2xl font-extrabold tracking-tight text-surface-400" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
                .
              </span>
            </div>
          ) : (
            <div className="hidden lg:flex w-full justify-center">
              <span className="text-3xl font-black leading-none select-none text-white" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
                S
              </span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="lg:hidden p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0">
          <X size={18} className="text-white/70" />
        </button>
      </div>

      {/* Навигация */}
      <nav className="flex-1 p-3 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-1">
          {filtered.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    // Сайдбар всегда тёмный → активный пункт делаем
                    // тема-независимым: белая плашка, чёрный текст.
                    isActive
                      ? 'bg-white text-surface-900 shadow-sm'
                      : 'text-surface-300 hover:bg-white/5 hover:text-white',
                    !open && 'lg:justify-center lg:px-2',
                  )
                }
                title={!open ? item.label : undefined}
              >
                <item.icon size={18} className="shrink-0" />
                <span className={clsx(
                  'truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden whitespace-nowrap',
                  open ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0',
                )}>
                  {item.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Компактный пользовательский блок снизу с быстрыми действиями */}
      {user && (
        <div className="p-3 border-t border-white/5 shrink-0">
          <div className={clsx('flex items-center gap-2', !open && 'lg:flex-col')}>
            <NavLink
              to="/profile"
              onClick={handleNavClick}
              className="flex items-center gap-2 min-w-0 flex-1 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <Avatar name={user.name} src={user.avatar} size={32} />
              <div className={clsx(
                'min-w-0 transition-all duration-300 overflow-hidden',
                open ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0',
              )}>
                <p className="text-xs font-semibold text-white truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-surface-400 truncate leading-tight">
                  {getUserPositionLabel(user)}
                </p>
              </div>
            </NavLink>
            {open && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => window.location.reload()}
                  title="Обновить"
                  className="p-1.5 rounded-md text-surface-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  onClick={() => logout()}
                  title="Выйти"
                  className="p-1.5 rounded-md text-surface-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
