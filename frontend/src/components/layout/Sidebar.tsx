import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users, Calendar,
  FileText, BarChart3, Bell, Archive, HardDrive,
  Building2, X, ChevronRight,
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
    { to: '/analytics', icon: BarChart3, label: t('nav.analytics'), roles: ['admin', 'manager'] },
    { to: '/files', icon: HardDrive, label: t('nav.files') },
    { to: '/archive', icon: Archive, label: t('nav.archive') },
    { to: '/notifications', icon: Bell, label: t('nav.notifications') },
    { to: '/employees', icon: Users, label: t('nav.employees'), roles: ['admin', 'manager'] },
  ]

  const filtered = navItems.filter(item =>
    !item.roles || item.roles.includes(user?.role || '')
  )

  return (
    <aside
      className={clsx(
        'fixed lg:relative z-30 flex flex-col h-full bg-white dark:bg-surface-800 border-r border-surface-100 dark:border-surface-700 transition-all duration-300',
        open ? 'w-[260px]' : 'w-0 lg:w-[72px] overflow-hidden',
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-[60px] px-4 border-b border-surface-100 dark:border-surface-700 shrink-0">
        <div className={clsx('flex items-center gap-2 overflow-hidden', !open && 'lg:justify-center')}>
          <div className="w-8 h-8 rounded-xl bg-primary-600 flex items-center justify-center shrink-0">
            <Building2 size={16} className="text-white" />
          </div>
          {open && (
            <span className="font-bold text-surface-900 dark:text-surface-100 whitespace-nowrap">ERP System</span>
          )}
        </div>
        <button onClick={onClose} className="lg:hidden p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700">
          <X size={18} className="text-surface-600 dark:text-surface-300" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-0.5">
          {filtered.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  clsx(
                    'sidebar-link',
                    isActive && 'active',
                    !open && 'lg:justify-center lg:px-2',
                  )
                }
                title={!open ? item.label : undefined}
              >
                <item.icon size={18} className="shrink-0" />
                {open && <span className="truncate">{item.label}</span>}
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
                'flex items-center gap-3 p-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors',
                isActive && 'bg-primary-50 dark:bg-primary-900/30',
                !open && 'lg:justify-center',
              )
            }
          >
            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0 text-primary-700 dark:text-primary-400 font-semibold text-sm">
              {user.avatar
                ? <img src={`/uploads/avatars/${user.avatar}`} alt="" className="w-8 h-8 rounded-full object-cover" />
                : user.name[0].toUpperCase()
              }
            </div>
            {open && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{user.name}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400 truncate capitalize">{user.role}</p>
              </div>
            )}
            {open && <ChevronRight size={14} className="text-surface-400 shrink-0" />}
          </NavLink>
        </div>
      )}
    </aside>
  )
}
