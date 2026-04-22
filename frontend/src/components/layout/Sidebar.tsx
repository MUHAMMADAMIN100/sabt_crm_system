import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { hasPermission, getUserPositionLabel, type Permission } from '@/lib/permissions'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users, Calendar,
  FileText, BarChart3, Bell, Archive, HardDrive,
  X, ChevronRight, Sparkles, Contact, Tag, ShieldAlert,
} from 'lucide-react'
import clsx from 'clsx'

interface SidebarProps { open: boolean; onClose: () => void }

export default function Sidebar({ open, onClose }: SidebarProps) {
  const user = useAuthStore(s => s.user)
  const { t } = useTranslation()

  const handleNavClick = () => {
    if (window.innerWidth < 993) onClose()
  }

  const role = user?.role

  const navItems: { to: string; icon: any; label: string; permission: Permission; exact?: boolean }[] = [
    { to: '/',              icon: LayoutDashboard, label: t('nav.dashboard'),  permission: 'dashboard',         exact: true },
    { to: '/projects',      icon: FolderKanban,    label: t('nav.projects'),   permission: 'projects.view' },
    { to: '/tasks',         icon: CheckSquare,     label: t('nav.tasks'),      permission: 'tasks.view' },
    { to: '/calendar',      icon: Calendar,        label: t('nav.calendar'),   permission: 'calendar.view' },
    { to: '/reports',       icon: FileText,        label: t('nav.reports'),    permission: 'reports.view' },
    { to: '/analytics',     icon: BarChart3,       label: t('nav.analytics'),  permission: 'analytics.view' },
    { to: '/archive',       icon: Archive,         label: t('nav.archive'),    permission: 'archive.view' },
    { to: '/notifications', icon: Bell,            label: t('nav.notifications'), permission: 'notifications.view' },
    { to: '/employees',     icon: Users,           label: t('nav.employees'),  permission: 'employees.view' },
    { to: '/clients',       icon: Contact,         label: 'База клиентов',     permission: 'clients.view' },
    { to: '/tariffs',       icon: Tag,             label: 'SMM-тарифы',        permission: 'tariffs.manage' },
    { to: '/risks',         icon: ShieldAlert,     label: 'Риски',             permission: 'risks.view' },
    { to: '/ai',            icon: Sparkles,        label: 'ИИ-помощник',       permission: 'ai.chat' },
  ]

  const filtered = navItems.filter(item => hasPermission(role, item.permission))

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-30 flex flex-col h-full',
        'bg-white dark:bg-surface-800',
        'border-r border-surface-100 dark:border-surface-700',
        'overflow-hidden',
        open ? 'w-[260px]' : 'w-0 lg:w-[72px]',
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-[60px] px-3 border-b border-surface-100 dark:border-surface-700 shrink-0 overflow-hidden">
        <div className="flex items-center min-w-0 flex-1 relative h-full">

          {/* Collapsed: S icon — fades out when open */}
          <div className={clsx(
            'absolute left-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            open ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100 lg:left-1/2 lg:-translate-x-1/2',
          )}>
            <div className="relative flex items-center justify-center w-9 h-9 shrink-0">
              <span className="font-black leading-none select-none" style={{ fontSize: 32, color: '#6B4FCF', fontFamily: "'Arial Black', Arial, sans-serif", lineHeight: 1 }}>S</span>
              <div className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500" />
            </div>
          </div>

          {/* Expanded: sabt wordmark — fades in when open */}
          <div className={clsx(
            'absolute left-3 flex items-baseline gap-0 leading-none select-none transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            open ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none',
          )}>
            <span className="font-black tracking-tight" style={{ fontSize: 22, color: '#6B4FCF', fontFamily: "'Arial Black', Arial, sans-serif" }}>sabt</span>
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="ml-0.5 mb-0.5">
              <path d="M1 1L1 11L3.8 8.2L5.6 12.5L7 11.9L5.2 7.6L9 7.6L1 1Z" fill="#6B4FCF" stroke="#6B4FCF" strokeWidth="0.5" strokeLinejoin="round" />
            </svg>
            <div className="w-2 h-2 rounded-full bg-red-500 mb-3 ml-0.5 shrink-0" />
          </div>
        </div>

        <button onClick={onClose} className="lg:hidden p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors shrink-0">
          <X size={18} className="text-surface-600 dark:text-surface-300" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-0.5 sidebar-nav-stagger">
          {filtered.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  clsx(
                    'sidebar-link group relative',
                    isActive && 'active',
                    !open && 'lg:justify-center lg:px-2',
                  )
                }
                title={!open ? item.label : undefined}
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={18}
                      className={clsx(
                        'shrink-0 transition-transform duration-150',
                        isActive ? 'text-primary-600 dark:text-primary-400' : 'group-hover:scale-110',
                      )}
                    />
                    <span className={clsx(
                      'truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden whitespace-nowrap',
                      open ? 'max-w-[200px] opacity-100 ml-0' : 'max-w-0 opacity-0 ml-0',
                    )}>
                      {item.label}
                    </span>
                    {isActive && (
                      <span className={clsx(
                        'w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0 animate-bounce-soft transition-all duration-300',
                        open ? 'ml-auto opacity-100' : 'ml-0 opacity-0 w-0',
                      )} />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* User */}
      {user && (
        <div className={clsx(
          'p-3 border-t border-surface-100 dark:border-surface-700 shrink-0',
          !open && 'lg:flex lg:justify-center',
        )}>
          <NavLink
            to="/profile"
            onClick={handleNavClick}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 p-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-all duration-150 group overflow-hidden',
                isActive && 'bg-primary-50 dark:bg-primary-900/30',
                !open && 'lg:justify-center',
              )
            }
          >
            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0 text-primary-700 dark:text-primary-400 font-semibold text-sm transition-transform duration-150 group-hover:scale-105">
              {user.avatar
                ? <img src={`/uploads/avatars/${user.avatar}`} alt="" className="w-8 h-8 rounded-full object-cover" />
                : user.name[0].toUpperCase()
              }
            </div>
            <div className={clsx(
              'flex-1 min-w-0 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden',
              open ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0',
            )}>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{user.name}</p>
              <p className="text-xs text-surface-500 dark:text-surface-400 truncate">
                {getUserPositionLabel(user)}
              </p>
            </div>
            <ChevronRight size={14} className={clsx(
              'text-surface-400 shrink-0 transition-all duration-300 group-hover:translate-x-0.5',
              open ? 'opacity-100 w-3.5' : 'opacity-0 w-0',
            )} />
          </NavLink>
        </div>
      )}
    </aside>
  )
}
