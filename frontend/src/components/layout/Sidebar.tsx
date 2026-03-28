import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users, Calendar,
  FileText, BarChart3, Bell, Archive, HardDrive,
  X, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'

interface SidebarProps { open: boolean; onClose: () => void }

export default function Sidebar({ open, onClose }: SidebarProps) {
  const user = useAuthStore(s => s.user)
  const { t } = useTranslation()

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard'), exact: true },
    { to: '/projects', icon: FolderKanban, label: t('nav.projects') },
    { to: '/tasks', icon: CheckSquare, label: t('nav.tasks') },
    { to: '/calendar', icon: Calendar, label: t('nav.calendar') },
    { to: '/reports', icon: FileText, label: t('nav.reports') },
    { to: '/analytics', icon: BarChart3, label: t('nav.analytics'), roles: ['admin'] },
    { to: '/archive', icon: Archive, label: t('nav.archive') },
    { to: '/notifications', icon: Bell, label: t('nav.notifications') },
    { to: '/employees', icon: Users, label: t('nav.employees'), roles: ['admin'] },
  ]

  const filtered = navItems.filter(item =>
    !item.roles || item.roles.includes(user?.role || '')
  )

  return (
    <aside
      className={clsx(
        'fixed lg:relative z-30 flex flex-col h-full bg-white dark:bg-surface-800',
        'border-r border-surface-100 dark:border-surface-700 transition-all duration-300',
        open ? 'w-[260px]' : 'w-0 lg:w-[72px] overflow-hidden',
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-[60px] px-3 border-b border-surface-100 dark:border-surface-700 shrink-0">
        <div className={clsx('flex items-center overflow-hidden min-w-0', open ? 'w-full justify-start pl-3' : 'lg:w-full justify-center')}>
          {/* Collapsed: S icon only */}
          {!open && (
            <div className="relative flex items-center justify-center w-9 h-9 shrink-0">
              <span
                className="font-black leading-none select-none"
                style={{ fontSize: 32, color: '#6B4FCF', fontFamily: "'Arial Black', Arial, sans-serif", lineHeight: 1 }}
              >
                S
              </span>
              <div className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500" />
            </div>
          )}

          {/* Expanded: sabt wordmark only */}
          {open && (
            <div className="flex items-baseline gap-0 animate-fade-in leading-none select-none">
              <span
                className="font-black tracking-tight"
                style={{ fontSize: 22, color: '#6B4FCF', fontFamily: "'Arial Black', Arial, sans-serif" }}
              >
                sabt
              </span>
              <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="ml-0.5 mb-0.5">
                <path
                  d="M1 1L1 11L3.8 8.2L5.6 12.5L7 11.9L5.2 7.6L9 7.6L1 1Z"
                  fill="#6B4FCF" stroke="#6B4FCF" strokeWidth="0.5" strokeLinejoin="round"
                />
              </svg>
              <div className="w-2 h-2 rounded-full bg-red-500 mb-3 ml-0.5 shrink-0" />
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="lg:hidden p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors shrink-0"
        >
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
                    {open && <span className="truncate">{item.label}</span>}
                    {/* Active indicator dot */}
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0 animate-bounce-soft" />
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
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 p-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-all duration-150 group',
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
            {open && (
              <div className="flex-1 min-w-0 animate-fade-in">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{user.name}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400 truncate capitalize">{user.role}</p>
              </div>
            )}
            {open && <ChevronRight size={14} className="text-surface-400 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />}
          </NavLink>
        </div>
      )}
    </aside>
  )
}
