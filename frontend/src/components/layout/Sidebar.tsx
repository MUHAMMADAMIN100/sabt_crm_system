import { NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { hasPermissionAny, getUserPositionLabel, canSeeProjectStories, canManageAccess, canSeeSmmSection, userCan, isDevDirector, type Permission } from '@/lib/permissions'
import { Avatar } from '@/components/ui'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users, Calendar,
  FileText, BarChart3, Archive, X, Sparkles, Contact, Tag, ShieldAlert, UserPlus,
  Shield, ShieldCheck, LogOut, RotateCcw, Trello, Image as ImageIcon,
  Wallet, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, TrendingUp, TrendingDown, ArrowLeftRight, SlidersHorizontal, MoreHorizontal, CalendarRange,
  Package, PersonStanding, MapPin, ClipboardList, StickyNote, ClipboardCheck, LineChart, Megaphone,
  Activity,
} from 'lucide-react'
import clsx from 'clsx'
import { useNavItems } from './navItems'
import ShiftButton from './ShiftButton'

/** Подпункты раздела «Финансы» (Fin System · WebRand). */
const FINANCE_SUBNAV = [
  { to: '/finance', label: 'Обзор', icon: LayoutGrid, exact: true },
  { to: '/finance/income', label: 'Доход', icon: TrendingUp },
  { to: '/finance/expense', label: 'Расход', icon: TrendingDown },
  { to: '/finance/planning', label: 'Планирование', icon: LineChart },
  { to: '/finance/transactions', label: 'Транзакции', icon: ArrowLeftRight },
  { to: '/finance/inventory', label: 'Инвентарь', icon: Package },
  { to: '/finance/activity', label: 'Активность', icon: RotateCcw },
  { to: '/finance/settings', label: 'Настройки', icon: SlidersHorizontal },
]

/** Подпункты раздела «СММ». */
const SMM_SUBNAV = [
  { to: '/smm', label: 'Умный календарь', icon: CalendarRange, exact: true },
  { to: '/smm/stories', label: 'Сторисы', icon: ImageIcon },
  { to: '/smm/projects', label: 'Проекты', icon: FolderKanban },
]

/** Подпункты раздела «Разработка» — устроен точь-в-точь как «СММ»,
 *  только без «Сторисов» (для dev-проектов они не нужны). */
const DEV_SUBNAV = [
  { to: '/dev', label: 'Умный календарь', icon: CalendarRange, exact: true },
  { to: '/dev/projects', label: 'Проекты', icon: FolderKanban },
]

/** Раскрывающиеся разделы с подпунктами: путь пункта меню → его подменю.
 *  «СММ» и «Разработка» рендерятся одним и тем же блоком. */
const SECTION_SUBNAV: Record<string, typeof SMM_SUBNAV> = {
  '/smm': SMM_SUBNAV,
  '/dev': DEV_SUBNAV,
}

interface SidebarProps { open: boolean; onClose: () => void; onToggle: () => void }

/** Тёмный сайдбар в корпоративном стиле (по референсу GRANT CHINA, но с
 *  нашим indigo акцентом вместо красного). Фон #0f0f12, белый текст,
 *  активный пункт — сплошная заливка primary, без декоративных точек.
 *  Пользовательский блок внизу — компактный, с быстрыми действиями. */
export default function Sidebar({ open: pinnedOpen, onClose, onToggle }: SidebarProps) {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const { t } = useTranslation()
  const location = useLocation()
  // Наведение временно разворачивает свёрнутый сайдбар (накрывает контент, не сдвигая его),
  // уход мышью — сворачивает обратно. Если закреплён открытым (pinnedOpen) — всегда развёрнут.
  const [hovered, setHovered] = useState(false)
  const open = pinnedOpen || hovered
  const financeActive = location.pathname === '/finance' || location.pathname.startsWith('/finance/')
  const [financeOpen, setFinanceOpen] = useState(financeActive)
  // Раскрытость разделов с подменю («СММ», «Разработка») — по одному флагу
  // на раздел; изначально раскрыт тот, внутри которого находится страница.
  const sectionActive = (base: string) => location.pathname === base || location.pathname.startsWith(base + '/')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.keys(SECTION_SUBNAV).map(base => [base, sectionActive(base)])))
  const toggleSection = (base: string) => setOpenSections(prev => ({ ...prev, [base]: !prev[base] }))
  // «Ещё» — свёрнутая нижняя группа навбара (только у основателя).
  const [moreOpen, setMoreOpen] = useState(false)

  const handleNavClick = () => {
    if (window.innerWidth < 993) onClose()
  }

  const role = user?.role
  const secondaryRole = user?.secondaryRole

  // Пункты и правила видимости — из общего модуля (их же берёт нижняя панель).
  const filtered = useNavItems()

  // Навбар основателя: основные пункты на виду, остальные — под кнопкой «Ещё».
  // Прочие роли видят полный список без изменений.
  const isFounder = role === 'founder'
  const FOUNDER_CORE = new Set<string>([
    '/', '/finance', '/smm', '/dev', '/calendar',
    '/employees', '/clients', '/ai',
  ])
  const coreItems = isFounder ? filtered.filter(i => FOUNDER_CORE.has(i.to)) : filtered
  const moreItems = isFounder ? filtered.filter(i => !FOUNDER_CORE.has(i.to)) : []
  // Список для рендера: у основателя вставляем маркер «Ещё» и (если раскрыто)
  // остальные пункты; у прочих ролей — просто отфильтрованный список.
  const renderList: any[] = !isFounder
    ? filtered
    : [
        ...coreItems,
        ...(moreItems.length > 0 ? [{ to: '__more__' }] : []),
        ...(moreOpen ? moreItems : []),
      ]

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={clsx(
        'fixed left-0 top-0 z-40 flex flex-col h-full',
        'transition-[width] duration-200 ease-out',
        // Фон сайдбара — отдельная переменная из роли «Фон» (НЕ «Текст»):
        // всегда тёмная панель, смена цвета текста её не трогает.
        'bg-[rgb(var(--sidebar-bg))] text-surface-200',
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
              <span className="text-2xl font-extrabold tracking-tight text-[rgb(var(--sidebar-fg))]" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
                sabt
              </span>
              <span className="text-2xl font-extrabold tracking-tight text-[rgb(var(--sidebar-fg-dim))]" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
                .
              </span>
            </div>
          ) : (
            <div className="hidden lg:flex w-full justify-center">
              <span className="text-3xl font-black leading-none select-none text-[rgb(var(--sidebar-fg))]" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
                S
              </span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="lg:hidden p-1 rounded-lg hover:bg-surface-50/10 transition-colors shrink-0">
          <X size={18} className="text-white/70" />
        </button>
      </div>

      {/* Навигация */}
      <nav className="flex-1 p-3 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-1">
          {renderList.map(item => {
            // «Ещё» — кнопка-переключатель нижней группы (только у основателя).
            if (item.to === '__more__') {
              return (
                <li key="__more__">
                  <button
                    type="button"
                    onClick={() => setMoreOpen(v => !v)}
                    className={clsx(
                      'group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      'text-[rgb(var(--sidebar-fg-dim))] hover:bg-surface-50/5 hover:text-[rgb(var(--sidebar-fg))]',
                      !open && 'lg:justify-center lg:px-2 lg:gap-0',
                    )}
                    title={!open ? (moreOpen ? 'Свернуть' : 'Ещё') : undefined}
                  >
                    <MoreHorizontal size={18} className="shrink-0" />
                    <span className={clsx(
                      'truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden whitespace-nowrap',
                      open ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0',
                    )}>
                      {moreOpen ? 'Свернуть' : 'Ещё'}
                    </span>
                    {open && (
                      <ChevronDown size={15} className={clsx('ml-auto shrink-0 transition-transform', moreOpen && 'rotate-180')} />
                    )}
                  </button>
                </li>
              )
            }
            // «Финансы» — раскрывающийся раздел с подпунктами (Fin System).
            if (item.to === '/finance') {
              return (
                <li key={item.to}>
                  <button
                    type="button"
                    onClick={() => (open ? setFinanceOpen(v => !v) : handleNavClick())}
                    className={clsx(
                      'group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      financeActive
                        ? 'bg-[#696bdc] text-white shadow-sm'
                        : 'text-[rgb(var(--sidebar-fg-dim))] hover:bg-surface-50/5 hover:text-[rgb(var(--sidebar-fg))]',
                      !open && 'lg:justify-center lg:px-2 lg:gap-0',
                    )}
                    title={!open ? item.label : undefined}
                  >
                    <item.icon size={18} className="shrink-0" />
                    <span className={clsx(
                      'truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden whitespace-nowrap',
                      open ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0',
                    )}>
                      {item.label}
                    </span>
                    {open && (
                      <ChevronDown size={15} className={clsx('ml-auto shrink-0 transition-transform', financeOpen && 'rotate-180')} />
                    )}
                  </button>
                  {open && financeOpen && (
                    <ul className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-0.5">
                      {FINANCE_SUBNAV.map(sub => (
                        <li key={sub.to}>
                          <NavLink
                            to={sub.to}
                            end={sub.exact}
                            onClick={handleNavClick}
                            className={({ isActive }) =>
                              clsx(
                                'group/finance flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
                                isActive
                                  ? 'bg-[#8385ff]/90 text-white'
                                  : 'text-[rgb(var(--sidebar-fg-dim))] hover:bg-surface-50/5 hover:text-[rgb(var(--sidebar-fg))]',
                              )
                            }
                          >
                            {({ isActive }) => <>
                              <span className={clsx(
                                'grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border transition-colors',
                                isActive
                                  ? 'border-white/15 bg-white/[.15]'
                                  : 'border-white/[.06] bg-white/[.035] group-hover/finance:border-white/10 group-hover/finance:bg-white/[.07]',
                              )}>
                                <sub.icon size={14} strokeWidth={1.75} />
                              </span>
                              <span className="truncate">{sub.label}</span>
                            </>}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            }
            // «СММ» / «Разработка» — раскрывающиеся разделы с подпунктами
            // (первый — Умный календарь). Один блок на оба раздела.
            if (SECTION_SUBNAV[item.to]) {
              const isSecActive = sectionActive(item.to)
              const isSecOpen = !!openSections[item.to]
              return (
                <li key={item.to}>
                  <button
                    type="button"
                    onClick={() => (open ? toggleSection(item.to) : handleNavClick())}
                    className={clsx(
                      'group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      isSecActive
                        ? 'bg-[#696bdc] text-white shadow-sm'
                        : 'text-[rgb(var(--sidebar-fg-dim))] hover:bg-surface-50/5 hover:text-[rgb(var(--sidebar-fg))]',
                      !open && 'lg:justify-center lg:px-2 lg:gap-0',
                    )}
                    title={!open ? item.label : undefined}
                  >
                    <item.icon size={18} className="shrink-0" />
                    <span className={clsx(
                      'truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden whitespace-nowrap',
                      open ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0',
                    )}>
                      {item.label}
                    </span>
                    {open && (
                      <ChevronDown size={15} className={clsx('ml-auto shrink-0 transition-transform', isSecOpen && 'rotate-180')} />
                    )}
                  </button>
                  {open && isSecOpen && (
                    <ul className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-0.5">
                      {SECTION_SUBNAV[item.to].map(sub => (
                        <li key={sub.to}>
                          <NavLink
                            to={sub.to}
                            end={sub.exact}
                            onClick={handleNavClick}
                            className={({ isActive }) =>
                              clsx(
                                'group/smm flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
                                isActive
                                  ? 'bg-[#8385ff]/90 text-white'
                                  : 'text-[rgb(var(--sidebar-fg-dim))] hover:bg-surface-50/5 hover:text-[rgb(var(--sidebar-fg))]',
                              )
                            }
                          >
                            {({ isActive }) => <>
                              <span className={clsx(
                                'grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border transition-colors',
                                isActive
                                  ? 'border-white/15 bg-white/[.15]'
                                  : 'border-white/[.06] bg-white/[.035] group-hover/smm:border-white/10 group-hover/smm:bg-white/[.07]',
                              )}>
                                <sub.icon size={14} strokeWidth={1.75} />
                              </span>
                              <span className="truncate">{sub.label}</span>
                            </>}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            }
            return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    // Активный пункт — заливка выбранным Primary-цветом
                    // темы (главный акцент перекрашивается вместе со всем).
                    isActive
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-[rgb(var(--sidebar-fg-dim))] hover:bg-surface-50/5 hover:text-[rgb(var(--sidebar-fg))]',
                    !open && 'lg:justify-center lg:px-2 lg:gap-0',
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
          )})}
        </ul>
      </nav>

      {/* Компактный пользовательский блок снизу с быстрыми действиями */}
      {user && (
        <div className="p-3 border-t border-white/5 shrink-0">
          {/* Рабочая смена — над карточкой сотрудника: начало и конец дня
              всегда под рукой, на любой странице. Основателю не видна. */}
          <div className="mb-2.5">
            <ShiftButton variant="sidebar" collapsed={!open} />
          </div>
          <div className={clsx('flex items-center gap-2', !open && 'lg:flex-col')}>
            <NavLink
              to="/profile"
              onClick={handleNavClick}
              className="flex items-center gap-2 min-w-0 flex-1 p-1.5 rounded-lg hover:bg-surface-50/5 transition-colors"
            >
              <Avatar name={user.name} src={user.avatar} size={32} zoomable={false} />
              <div className={clsx(
                'min-w-0 transition-all duration-300 overflow-hidden',
                open ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0',
              )}>
                <p className="text-xs font-semibold text-[rgb(var(--sidebar-fg))] truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-[rgb(var(--sidebar-fg-dim))] truncate leading-tight">
                  {getUserPositionLabel(user)}
                </p>
              </div>
            </NavLink>
            {open && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => window.location.reload()}
                  title="Обновить"
                  className="p-1.5 rounded-md text-surface-400 hover:text-white hover:bg-surface-50/5 transition-colors"
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
          {/* Свернуть/развернуть меню — заменяет кнопку из убранной верхней панели */}
          <button
            onClick={onToggle}
            title={!open ? 'Развернуть меню' : undefined}
            className={clsx(
              'mt-2 w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium bg-white/[0.05] hover:bg-white/10 text-[rgb(var(--sidebar-fg-dim))] hover:text-[rgb(var(--sidebar-fg))] transition-colors',
              !open && 'lg:justify-center lg:px-2 lg:gap-0',
            )}
          >
            {open ? <ChevronLeft size={18} className="shrink-0" /> : <ChevronRight size={18} className="shrink-0" />}
            <span className={clsx(
              'truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden whitespace-nowrap',
              open ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0',
            )}>
              Свернуть меню
            </span>
          </button>
        </div>
      )}
    </aside>
  )
}
