import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, Bell, Search, LogOut, User, ChevronDown, Globe, Moon, Sun, X, Check } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useThemeStore } from '@/store/theme.store'
import { useTranslation } from '@/i18n'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { notificationsApi, tasksApi, projectsApi, employeesApi } from '@/services/api.service'
import { getUserPositionLabel } from '@/lib/permissions'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

interface HeaderProps { onMenuClick: () => void }

export default function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const langRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { theme, toggleTheme } = useThemeStore()
  const { t, locale, setLocale } = useTranslation()

  const isFounderRole = user?.role === 'founder' || user?.role === 'co_founder'

  const { data: unreadData } = useQuery({
    queryKey: ['unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30000,
    enabled: !isFounderRole,
  })

  // Founder/co-founder: count only negative notification types
  const NEGATIVE_TYPES = ['task_overdue', 'deadline_approaching', 'deadline_tomorrow', 'task_returned', 'inactivity_24h', 'payment_reminder', 'project_overdue', 'daily_uncompleted']
  const { data: allNotifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    refetchInterval: 30000,
  })
  const founderUnreadCount = useMemo(() => {
    if (!isFounderRole || !allNotifications) return 0
    return allNotifications.filter((n: any) => !n.isRead && NEGATIVE_TYPES.includes(n.type)).length
  }, [allNotifications, isFounderRole])

  const badgeCount = isFounderRole ? founderUnreadCount : (unreadData?.count || 0)

  // Search data
  const { data: allTasks } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })
  const { data: allProjects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: allEmployees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangMenuOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Mark-read mutation
  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })

  const handleNotificationClick = (n: any) => {
    if (!n.isRead) markReadMut.mutate(n.id)
    setNotifOpen(false)
    if (n.link) navigate(n.link)
  }

  // Global search results
  const q = searchQuery.toLowerCase().trim()
  const searchResults = q.length >= 2 ? {
    tasks: (allTasks || []).filter((t: any) => t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)).slice(0, 5),
    projects: (allProjects || []).filter((p: any) => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)).slice(0, 5),
    employees: (allEmployees || []).filter((e: any) => e.fullName?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q) || e.position?.toLowerCase().includes(q)).slice(0, 5),
  } : null

  const hasResults = searchResults && (searchResults.tasks.length || searchResults.projects.length || searchResults.employees.length)

  const handleResultClick = (path: string) => {
    navigate(path)
    setSearchQuery('')
    setSearchOpen(false)
  }

  const languages = [
    { code: 'ru', name: 'Русский' },
    { code: 'en', name: 'English' },
    { code: 'tj', name: 'Тоҷикӣ' },
  ]

  const searchResultsDropdown = searchOpen && searchResults && (
    <div className="absolute top-full left-0 right-0 mt-1 bg-surface-50 dark:bg-surface-800 rounded-2xl shadow-modal border border-surface-100 dark:border-surface-700 z-50 max-h-[60vh] sm:max-h-[400px] overflow-y-auto animate-fade-in">
      {!hasResults ? (
        <p className="text-sm text-surface-400 dark:text-surface-500 p-4 text-center">{t('common.noData')}</p>
      ) : (
        <>
          {searchResults.projects.length > 0 && (
            <div className="p-2">
              <p className="text-xs font-semibold text-surface-400 dark:text-surface-500 px-2 py-1">{t('projects.title')}</p>
              {searchResults.projects.map((p: any) => (
                <button key={p.id} onClick={() => { handleResultClick(`/projects/${p.id}`); setMobileSearchOpen(false) }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xs text-primary-700 dark:text-primary-400 font-bold shrink-0">П</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{p.name}</p>
                    {p.description && <p className="text-xs text-surface-400 dark:text-surface-500 truncate">{p.description}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchResults.tasks.length > 0 && (
            <div className="p-2 border-t border-surface-50 dark:border-surface-700">
              <p className="text-xs font-semibold text-surface-400 dark:text-surface-500 px-2 py-1">{t('tasks.title')}</p>
              {searchResults.tasks.map((task: any) => (
                <button key={task.id} onClick={() => { handleResultClick(`/tasks/${task.id}`); setMobileSearchOpen(false) }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-xs text-green-700 dark:text-green-400 font-bold shrink-0">З</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500 truncate">{task.project?.name || ''}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchResults.employees.length > 0 && (
            <div className="p-2 border-t border-surface-50 dark:border-surface-700">
              <p className="text-xs font-semibold text-surface-400 dark:text-surface-500 px-2 py-1">{t('employees.title')}</p>
              {searchResults.employees.map((emp: any) => (
                <button key={emp.id} onClick={() => { handleResultClick(`/employees/${emp.id}`); setMobileSearchOpen(false) }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-surface-100 dark:bg-surface-900/30 flex items-center justify-center text-xs text-surface-700 dark:text-surface-400 font-bold shrink-0">С</div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{emp.fullName}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500 truncate">{emp.position} • {emp.department}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <header className="h-[56px] bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex items-center px-3 sm:px-4 gap-2 sm:gap-3 shrink-0 sticky-top relative z-40">
      <button onClick={onMenuClick} className="p-2 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-surface-600 dark:text-surface-300">
        <Menu size={18} />
      </button>

      {/* Desktop Search */}
      <div className="flex-1 max-w-lg hidden sm:block relative" ref={searchRef}>
        <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-1.5">
          <Search size={14} className="text-surface-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            placeholder={t('common.search') + '...'}
            className="flex-1 bg-transparent text-sm outline-none text-surface-700 dark:text-surface-200 placeholder-surface-400"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchOpen(false) }} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
              <X size={14} />
            </button>
          )}
        </div>
        {searchResultsDropdown}
      </div>

      {/* Mobile search button */}
      <button onClick={() => setMobileSearchOpen(o => !o)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-surface-600 dark:text-surface-300 sm:hidden">
        <Search size={18} />
      </button>

      <div className="flex-1 sm:hidden" />

      {/* Right corner — user menu with integrated controls */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Notifications dropdown */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen(o => !o)} className="relative p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-surface-600 dark:text-surface-300">
            <Bell size={18} />
            {badgeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-medium ring-2 ring-white dark:ring-surface-800">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-full mt-1 w-[340px] sm:w-[380px] max-w-[calc(100vw-1rem)] bg-surface-50 dark:bg-surface-800 rounded-2xl shadow-modal border border-surface-100 dark:border-surface-700 z-50 animate-slide-down flex flex-col max-h-[70vh] origin-top-right">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 dark:border-surface-700 shrink-0">
                <h3 className="font-semibold text-sm text-surface-900 dark:text-surface-100">Уведомления</h3>
                {(allNotifications ?? []).some((n: any) => !n.isRead) && (
                  <button onClick={() => markAllReadMut.mutate()} className="text-xs text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1">
                    <Check size={11} /> Прочитать все
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {(allNotifications ?? []).length === 0 ? (
                  <p className="text-sm text-surface-400 dark:text-surface-500 p-6 text-center">Нет уведомлений</p>
                ) : (
                  <ul className="divide-y divide-surface-50 dark:divide-surface-700 stagger-list">
                    {(allNotifications ?? []).slice(0, 15).map((n: any) => (
                      <li
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={clsx(
                          'px-4 py-3 cursor-pointer transition-colors hover:bg-surface-50 dark:hover:bg-surface-700/50',
                          !n.isRead && 'bg-primary-50/50 dark:bg-primary-900/10',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={clsx(
                              'text-sm leading-snug',
                              !n.isRead
                                ? 'font-medium text-surface-900 dark:text-surface-100'
                                : 'text-surface-700 dark:text-surface-300',
                            )}>
                              {n.title}
                            </p>
                            {n.message && (
                              <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 line-clamp-2">
                                {n.message}
                              </p>
                            )}
                            <p className="text-[10px] text-surface-400 dark:text-surface-500 mt-1">
                              {n.createdAt ? formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ru }) : ''}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                onClick={() => { setNotifOpen(false); navigate('/notifications') }}
                className="px-4 py-3 border-t border-surface-100 dark:border-surface-700 text-sm text-primary-600 dark:text-primary-400 hover:bg-surface-50 dark:hover:bg-surface-700/50 text-center font-medium shrink-0"
              >
                Все уведомления →
              </button>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-surface-600 dark:text-surface-300"
          title={theme === 'dark' ? t('settings.light') : t('settings.dark')}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Language selector (hidden on very small screens) */}
        <div className="relative hidden xs:block" ref={langRef}>
          <button onClick={() => setLangMenuOpen(o => !o)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-surface-600 dark:text-surface-300">
            <Globe size={18} />
          </button>
          {langMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-surface-50 dark:bg-surface-800 rounded-2xl shadow-modal border border-surface-100 dark:border-surface-700 py-1 z-50 animate-fade-in">
              {languages.map((lang) => (
                <button key={lang.code} onClick={() => { setLocale(lang.code as any); setLangMenuOpen(false) }}
                  className={clsx('w-full px-4 py-2 text-sm text-left hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors',
                    locale === lang.code && 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400')}>
                  {lang.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* User menu */}
      <div className="relative" ref={menuRef}>
        <button onClick={() => setUserMenuOpen(o => !o)} className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
          <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 dark:text-primary-400 font-semibold text-sm">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium text-surface-900 dark:text-surface-100 leading-tight">{user?.name}</p>
            <p className="text-xs text-surface-500 dark:text-surface-400">{getUserPositionLabel(user)}</p>
          </div>
          <ChevronDown size={14} className="text-surface-400 hidden sm:block" />
        </button>
        {userMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-surface-50 dark:bg-surface-800 rounded-2xl shadow-modal border border-surface-100 dark:border-surface-700 py-1 z-50 animate-fade-in">
            <button onClick={() => { navigate('/profile'); setUserMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700">
              <User size={15} /> {t('auth.profile')}
            </button>
            <div className="h-px bg-surface-100 dark:bg-surface-700 my-1" />
            <button onClick={logout}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
              <LogOut size={15} /> {t('auth.logout')}
            </button>
          </div>
        )}
      </div>
      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 z-50 bg-surface-50 dark:bg-surface-900 sm:hidden animate-fade-in">
          <div className="flex items-center gap-2 p-3 border-b border-surface-100 dark:border-surface-700">
            <button onClick={() => { setMobileSearchOpen(false); setSearchQuery(''); setSearchOpen(false) }} className="p-2 rounded-xl text-surface-600 dark:text-surface-300">
              <X size={20} />
            </button>
            <div className="flex-1 relative" ref={searchRef}>
              <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl px-3 py-2.5">
                <Search size={15} className="text-surface-400 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true) }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder={t('common.search') + '...'}
                  className="flex-1 bg-transparent text-sm outline-none text-surface-700 dark:text-surface-200 placeholder-surface-400"
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchOpen(false) }} className="text-surface-400">
                    <X size={14} />
                  </button>
                )}
              </div>
              {searchResultsDropdown}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
