import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Plus, X, ClipboardCheck, FolderKanban, Image as ImageIcon,
  KanbanSquare, BarChart3, FileText, CalendarRange, Search, Wallet, TrendingUp, TrendingDown, Users,
  Building2, Package, Activity, Settings, Car, Network, Target, Megaphone, Code2, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth.store'
import { canSeeSmmSection, canSeeDevSection, userCan, isDevLead, getRoleLabel } from '@/lib/permissions'
import { Avatar } from '@/components/ui'
import { tasksApi } from '@/services/api.service'
import { useNavItems } from './navItems'
import ShiftButton from './ShiftButton'

/** Сколько разделов стоит прямо на панели. Остальные уходят под «Ещё». */
const PINNED = 3

/**
 * Нижняя панель навигации для телефона (вариант Б2).
 * Три раздела, кнопка «Ещё» и центральная кнопка «плюс»: она всегда означает
 * «создать» и раскрывает веером доступные действия. Список действий зависит
 * от прав, поэтому кнопка не меняет смысл от раздела к разделу.
 */
export default function BottomNav() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const items = useNavItems()

  const [more, setMore] = useState(false)
  const [q, setQ] = useState('')
  const [fan, setFan] = useState(false)
  const [hidden, setHidden] = useState(false)

  const pinned = items.slice(0, PINNED)
  const rest = items.slice(PINNED)

  // Закрываем всё при переходе: иначе лист остаётся открытым над новой страницей.
  useEffect(() => { setMore(false); setFan(false); setQ('') }, [location.pathname])

  // Панель уезжает вниз при прокрутке вперёд и возвращается при прокрутке
  // назад — на маленьком экране это заметная прибавка полезной высоты.
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let last = main.scrollTop
    const onScroll = () => {
      const y = main.scrollTop
      if (Math.abs(y - last) > 8) {
        setHidden(y > last && y > 60)
        last = y
      }
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  // Красный кружок на «Задачах»: сколько поручений просрочено. Берём тот же
  // запрос, что и главная, поэтому лишнего обращения к серверу нет.
  const { data: myTasks } = useQuery({
    queryKey: ['my-tasks'],
    queryFn: tasksApi.my,
    enabled: !!user,
    staleTime: 60_000,
  })
  const overdue = useMemo(() => {
    const now = Date.now()
    return (Array.isArray(myTasks) ? myTasks : []).filter((t: any) =>
      t?.deadline && new Date(t.deadline).getTime() < now &&
      t.status !== 'done' && t.status !== 'cancelled').length
  }, [myTasks])

  // Действия веера — только те, что реально есть в системе и разрешены роли.
  const actions = useMemo(() => {
    const list: { key: string; label: string; icon: any; run: () => void }[] = []
    // Окно «отметить сторис» (/?day=today) есть только в кабинете
    // СММ-специалиста — у остальных панель другая, и пункт никуда не вёл.
    if (user?.role === 'smm_specialist') {
      list.push({ key: 'story', label: 'Отметить сторис', icon: ImageIcon, run: () => navigate('/?day=today') })
    }
    // Форма создания есть не на всех страницах «Задач»: у руководителя
    // разработки — список с «+ Задача», у основателя и админа — «Выдать
    // задачу» в «Задачах недели». Остальным пункт не показываем: раньше он
    // вёл на страницу без формы, и кнопка будто не работала.
    if (userCan(user, 'tasks.create')) {
      const taskHref = isDevLead(user) ? '/tasks?new=1'
        : (user?.role === 'founder' || user?.role === 'admin') ? '/employees/week?issue=1' : null
      if (taskHref) list.push({ key: 'task', label: 'Новая задача', icon: ClipboardCheck, run: () => navigate(taskHref) })
    }
    if (canSeeSmmSection(user?.role) && userCan(user, 'projects.create')) {
      list.push({ key: 'project', label: 'Добавить проект', icon: FolderKanban, run: () => navigate('/smm/projects?new=1') })
    }
    return list
  }, [user, navigate])

  const tabCls = 'relative flex flex-col items-center gap-[3px] pt-1.5 pb-1 min-h-[44px] rounded-xl'

  // Подразделы «Разработки» для шторки «Ещё»: top-level пункта доски в меню
  // больше нет (один раздел в сайдбаре), а субменю панель не умеет —
  // иначе с телефона до доски/KPI/отчётов не добраться.
  const devLinks = useMemo(() => {
    if (!canSeeDevSection(user?.role)) return []
    // «Умного календаря» у разработки нет (14.10.2026): календарь — вид на доске.
    const list = [
      { to: '/dev-board', label: 'Доска', icon: KanbanSquare, perm: 'dev-tracker.view' as const },
      { to: '/dev/projects', label: 'Проекты', icon: FolderKanban, perm: 'dev-tracker.view' as const },
      { to: '/dev-board/kpi', label: 'KPI', icon: BarChart3, perm: 'dev-tracker.view' as const },
    ] as { to: string; label: string; icon: any; perm: 'dev-tracker.view' | 'dev-tracker.manage' }[]
    if (userCan(user, 'dev-tracker.manage')) {
      list.push({ to: '/dev-board/reports', label: 'Отчёты', icon: FileText, perm: 'dev-tracker.manage' })
    }
    return list.filter(l => userCan(user, l.perm))
  }, [user])

  // Подразделы «СММ» для шторки «Ещё»: на телефоне субменю нет, и до
  // «Сторисов», «Проектов» и «Контроля» иначе не добраться.
  const smmLinks = useMemo(() => {
    if (!canSeeSmmSection(user?.role)) return []
    return [
      { to: '/smm', label: 'Умный календарь', icon: CalendarRange },
      { to: '/smm/stories', label: 'Сторисы', icon: ImageIcon },
      { to: '/smm/projects', label: 'Проекты', icon: FolderKanban },
      { to: '/smm/control', label: 'Контроль', icon: ClipboardCheck },
    ]
  }, [user])

  // Подразделы Финансов для шторки «Ещё». На компьютере в них заходят
  // плитками с обзора, а на телефоне обзор — длинная простыня, и до
  // «Зарплаты» или «Транзакций» приходилось прокручивать её целиком.
  const financeLinks = useMemo(() => {
    if (!userCan(user, 'finance.manage')) return []
    return [
      { to: '/finance', label: 'Обзор', icon: Wallet },
      { to: '/finance/income', label: 'Доходы', icon: TrendingUp },
      { to: '/finance/expense', label: 'Расходы', icon: TrendingDown },
      { to: '/finance/planning', label: 'Планирование', icon: CalendarRange },
      { to: '/finance/transactions', label: 'Транзакции', icon: FileText },
      { to: '/finance/transport', label: 'Транспорт сотрудникам', icon: Car },
      { to: '/finance/expense/salary', label: 'Зарплата', icon: Users },
      { to: '/finance/expense/rent_subs', label: 'Аренда и подписки', icon: Building2 },
      { to: '/finance/expense/debts', label: 'Долги', icon: BarChart3 },
      { to: '/finance/inventory', label: 'Инвентарь', icon: Package },
      { to: '/finance/activity', label: 'Активность', icon: Activity },
      { to: '/finance/settings', label: 'Настройки финансов', icon: Settings },
    ]
  }, [user])

  // Подразделы «Сотрудников» (19.10.2026) — как у «СММ» и «Финансов».
  // Кому какой — как в боковом меню.
  const employeeLinks = useMemo(() => {
    if (!userCan(user, 'employees.view')) return []
    const top = user?.role === 'founder' || user?.role === 'admin'
    return [
      { to: '/employees', label: 'Все сотрудники', icon: Users, show: true },
      { to: '/employees/org', label: 'Оргструктура', icon: Network, show: true },
      { to: '/employees/week', label: 'Задачи недели', icon: CalendarRange, show: top },
      { to: '/employees/activity', label: 'Активность и смены', icon: Activity, show: top },
      { to: '/employees/sales-plan', label: 'План продаж', icon: Target, show: user?.role === 'founder' },
      { to: '/employees/kpi', label: 'KPI', icon: BarChart3, show: top },
    ].filter(l => l.show)
  }, [user])

  // Поиск по шторке: разделов вместе с подразделами больше двадцати, и
  // пролистывать их глазами дольше, чем набрать два слога.
  const match = (label: string) => {
    const s = q.trim().toLowerCase()
    return !s || label.toLowerCase().includes(s)
  }
  // Шторка «Ещё» (вариант А, 05.11.2026): разделы с подразделами — группами,
  // которые раскрываются по нажатию; группа текущей страницы открыта сразу.
  // Раньше всё было раскрыто — 36 строк на пять экранов, а «СММ» и
  // «Разработка» стояли дважды: в «Разделах» и своей группой.
  const isDevRoute =
    location.pathname === '/dev' || location.pathname.startsWith('/dev/') ||
    location.pathname === '/dev-board' || location.pathname.startsWith('/dev-board/')
  const isOn = (root: string) => location.pathname === root || location.pathname.startsWith(root + '/')
  const groups = [
    { key: 'finance', title: 'Финансы', icon: Wallet, root: '/finance', links: financeLinks, end: true, on: isOn('/finance') },
    { key: 'employees', title: 'Сотрудники', icon: Users, root: '/employees', links: employeeLinks, end: true, on: isOn('/employees') },
    { key: 'smm', title: 'СММ', icon: Megaphone, root: '/smm', links: smmLinks, end: true, on: isOn('/smm') },
    { key: 'dev', title: 'Разработка', icon: Code2, root: '/dev', links: devLinks, end: false, on: isDevRoute },
  ].filter(g => g.links.length > 0)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!more) return
    const cur = groups.find(g => g.on)
    setOpenGroups(cur ? { [cur.key]: true } : {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more])
  const searching = !!q.trim()
  const groupsF = groups
    .map(g => ({ ...g, shown: g.links.filter(l => match(l.label) || match(g.title)) }))
    .filter(g => g.shown.length > 0)
  // Корень раздела с группой в «Разделах» не повторяем.
  const groupRoots = new Set(groups.map(g => g.root))
  const restF = rest.filter(i => match(i.label) && !groupRoots.has(i.to))
  const nothingFound = searching && !restF.length && !groupsF.length

  // Кнопка создания стоит в средней колонке, поэтому разделы делятся на две
  // части: два слева от неё, остальное справа.
  const left = pinned.slice(0, 2)
  const right = pinned.slice(2)

  // Таб «Разработка» ведёт не только на /dev: запоминаем последний открытый
  // подраздел (доска/KPI/проекты/отчёты) и возвращаем туда; повторный тап
  // внутри раздела открывает шторку «Ещё» со всеми подразделами.
  useEffect(() => {
    if (isDevRoute) {
      try { localStorage.setItem('last-dev-route', location.pathname + location.search) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])
  const openDevTab = () => {
    if (isDevRoute) { setFan(false); setMore(true); return }
    let last = '/dev-board'
    try { last = localStorage.getItem('last-dev-route') || '/dev-board' } catch {}
    navigate(last)
  }

  const renderTab = (i: ReturnType<typeof useNavItems>[number]) => {
    if (i.to === '/dev') {
      return (
        <button key={i.to} type="button" onClick={openDevTab} aria-label="Разработка"
          className={clsx(tabCls, isDevRoute ? 'text-white' : 'text-white/45')}>
          {isDevRoute && <span className="absolute top-0.5 w-9 h-[26px] rounded-[9px] bg-primary-500/20" />}
          <span className="relative"><i.icon size={20} /></span>
          <span className="relative text-[9.5px] font-semibold">Разработка</span>
        </button>
      )
    }
    return (
    <NavLink key={i.to} to={i.to} end={i.exact}
      className={({ isActive }) => clsx(tabCls, isActive ? 'text-white' : 'text-white/45')}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-0.5 w-9 h-[26px] rounded-[9px] bg-primary-500/20" />}
          <span className="relative">
            <i.icon size={20} />
            {!!i.badge && (
              <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-white text-surface-900 text-[9px] font-extrabold flex items-center justify-center border-[1.5px] border-[rgb(var(--sidebar-bg))]">
                {i.badge > 9 ? '9+' : i.badge}
              </span>
            )}
            {i.to === '/tasks' && overdue > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center border-[1.5px] border-[rgb(var(--sidebar-bg))]">
                {overdue > 9 ? '9+' : overdue}
              </span>
            )}
          </span>
          <span className="relative text-[9.5px] font-semibold">{i.label.split(' ')[0]}</span>
        </>
      )}
    </NavLink>
    )
  }

  // В отпуске нижней панели нет: открыт только профиль (27.10.2026).
  if (user?.vacation) return null

  return (
    <>
      {/* Веер действий и лист «Ещё» — в портале, чтобы не зависеть от стилей страницы. */}
      {(fan || more) && createPortal(
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => { setFan(false); setMore(false) }}>
          <div className="absolute inset-0 bg-black/50" />

          {fan && (
            <div className="absolute left-0 right-0 bottom-[104px] flex flex-col items-center gap-2 px-4"
              onClick={e => e.stopPropagation()}>
              {actions.length === 0 && (
                <span className="text-[12.5px] text-white/70">Доступных действий нет</span>
              )}
              {actions.map(a => (
                <button key={a.key} onClick={() => { setFan(false); a.run() }}
                  className="flex items-center gap-2.5 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 px-3.5 py-2.5 shadow-lg">
                  <a.icon size={16} className="text-primary-600 dark:text-primary-400" />
                  <b className="text-[12.5px] font-semibold text-surface-900 dark:text-surface-100">{a.label}</b>
                </button>
              ))}
            </div>
          )}

          {more && (
            <div className="absolute inset-x-0 bottom-0 rounded-t-[20px] bg-white dark:bg-surface-900 pb-[max(16px,env(safe-area-inset-bottom))] max-h-[78vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="w-9 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto my-2.5" />
              <div className="flex items-center px-4 pb-2">
                <b className="text-[13px] font-bold text-surface-900 dark:text-surface-100">Ещё</b>
                <button type="button" onClick={() => setMore(false)} aria-label="Закрыть"
                  className="ml-auto -mr-1 w-10 h-10 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-500 flex items-center justify-center"><X size={17} /></button>
              </div>
              <div className="px-2 pb-1">
                {/* Профиль и «Выйти» — сверху: раньше они стояли после 36 строк. */}
                {!searching && (
                  <div className="mx-1 mb-2 flex items-center gap-3 rounded-2xl border border-surface-200 bg-surface-50 p-2 dark:border-surface-700 dark:bg-surface-800">
                    <NavLink to="/profile" onClick={() => setMore(false)} className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={user?.name || ''} src={(user as any)?.avatar} size={36} />
                      <span className="min-w-0">
                        <b className="block truncate text-[14px] font-semibold text-surface-900 dark:text-surface-100">{user?.name || 'Профиль'}</b>
                        <span className="block truncate text-[11.5px] text-surface-500 dark:text-surface-400">{getRoleLabel(user?.role)}</span>
                      </span>
                    </NavLink>
                    <button type="button" onClick={() => { setMore(false); logout() }}
                      className="min-h-[40px] shrink-0 rounded-xl px-3 text-[13px] font-semibold text-red-600 dark:text-red-400">
                      Выйти
                    </button>
                  </div>
                )}
                {/* Поиск: разделов с подразделами больше двадцати. */}
                <div className="px-1 pb-2">
                  <label className="flex items-center gap-2.5 h-12 px-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
                    <Search size={17} className="text-surface-400 shrink-0" />
                    <span className="sr-only">Поиск по разделам</span>
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти раздел"
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none text-surface-900 dark:text-surface-100 placeholder:text-surface-400" />
                    {q && (
                      <button type="button" onClick={() => setQ('')} aria-label="Очистить поиск"
                        className="w-7 h-7 rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-500 flex items-center justify-center shrink-0">
                        <X size={13} />
                      </button>
                    )}
                  </label>
                </div>
                {/* Рабочая смена — крупной кнопкой: начало и конец дня
                    попадаются пальцем не глядя. */}
                {!searching && (
                  <div className="px-1 pb-2">
                    <ShiftButton variant="sheet" />
                  </div>
                )}
                {nothingFound && (
                  <p className="px-3 py-6 text-center text-[13.5px] text-surface-400">
                    Ничего не нашлось. Попробуйте короче — например, «зар» или «план».
                  </p>
                )}
                {/* Группы: при поиске раскрыты те, где нашлось совпадение. */}
                <div className="px-1">
                  {groupsF.map(g => {
                    const open = searching || !!openGroups[g.key]
                    return (
                      <div key={g.key}>
                        <button type="button" aria-expanded={open}
                          onClick={() => setOpenGroups(v => ({ ...v, [g.key]: !v[g.key] }))}
                          className={clsx('mb-1.5 flex min-h-[48px] w-full items-center gap-3 rounded-xl border bg-surface-50 px-3 text-surface-800 dark:bg-surface-800 dark:text-surface-200',
                            open ? 'border-surface-300 dark:border-surface-600' : 'border-surface-200 dark:border-surface-700')}>
                          <g.icon size={18} className={clsx('shrink-0', g.on ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400')} />
                          <b className="flex-1 text-left text-[14px] font-semibold">{g.title}</b>
                          <span className="text-[12px] font-medium text-surface-400">{g.links.length}</span>
                          <ChevronDown size={16} className={clsx('shrink-0 text-surface-400 transition-transform', open && 'rotate-180')} />
                        </button>
                        {open && (
                          <div className="mb-2 ml-4 border-l border-surface-200 pl-2.5 dark:border-surface-700">
                            {g.shown.map(l => (
                              <SheetLink key={l.to} to={l.to} icon={l.icon} label={l.label} onGo={() => setMore(false)} end={g.end} compact />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {restF.length > 0 && <SheetGroup title="Разделы" />}
                {restF.map(i => (
                  <SheetLink key={i.to} to={i.to} icon={i.icon} label={i.label} onGo={() => setMore(false)} />
                ))}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}

      <nav className={clsx(
        'lg:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end',
        'px-2 pt-2 pb-[max(10px,env(safe-area-inset-bottom))]',
        'transition-transform duration-200',
        hidden && !more && !fan && 'translate-y-full',
      )}>
        {/* Фон вынесен в подложку: вырез делается маской, а маска на самой
            панели обрезала бы и кнопку, и подписи. Вырез прозрачный, поэтому
            подкрашивать его под фон страницы не нужно. */}
        <span aria-hidden className="absolute inset-0 bg-[rgb(var(--sidebar-bg))] border-t border-white/[.07]"
          style={{
            WebkitMaskImage: 'radial-gradient(circle 32px at 50% 0, transparent 31px, #000 32px)',
            maskImage: 'radial-gradient(circle 32px at 50% 0, transparent 31px, #000 32px)',
          }} />
        {left.map(renderTab)}

        <button type="button" onClick={() => { setMore(false); setFan(v => !v) }} title="Создать" aria-label="Создать" aria-expanded={fan}
          className={clsx('relative justify-self-center w-[52px] h-[52px] -mt-7 rounded-full bg-primary-600 text-white',
            'flex items-center justify-center shadow-lg shadow-primary-600/40 transition-transform',
            fan && 'rotate-45')}>
          <Plus size={24} strokeWidth={2.2} />
        </button>

        {right.map(renderTab)}

        <button type="button" onClick={() => { setFan(false); setMore(v => !v) }} aria-expanded={more}
          className={clsx(tabCls, more ? 'text-white' : 'text-white/45')}>
          {more && <span className="absolute top-0.5 w-9 h-[26px] rounded-[9px] bg-primary-500/20" />}
          <span className="relative"><MoreHorizontal size={20} /></span>
          <span className="relative text-[9.5px] font-semibold">Ещё</span>
        </button>
      </nav>
    </>
  )
}

/** Заголовок группы в шторке «Ещё». */
function SheetGroup({ title }: { title: string }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">
      {title}
    </div>
  )
}

/** Строка-ссылка в шторке. Высота 48 — по ней попадают пальцем не целясь;
 *  текущий раздел подсвечен, иначе в списке из двадцати пунктов не понять,
 *  где ты находишься. */
function SheetLink({ to, icon: Icon, label, onGo, end, compact }: {
  to: string; icon: any; label: string; onGo: () => void; end?: boolean
  /** Подпункт раскрытой группы — строка ниже и без стрелки. */
  compact?: boolean
}) {
  return (
    <NavLink to={to} end={end} onClick={onGo}
      className={({ isActive }) => clsx(
        'flex items-center gap-3 px-3 rounded-xl', compact ? 'min-h-[42px]' : 'min-h-[48px]',
        isActive
          ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
          : 'text-surface-800 dark:text-surface-200',
      )}>
      {({ isActive }) => (
        <>
          <Icon size={compact ? 16 : 18} className={clsx('shrink-0', isActive ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400')} />
          <b className={clsx('flex-1', compact ? 'text-[13.5px] font-medium' : 'text-[14px] font-semibold')}>{label}</b>
          {!compact && <span className="text-surface-300 dark:text-surface-600">›</span>}
        </>
      )}
    </NavLink>
  )
}
