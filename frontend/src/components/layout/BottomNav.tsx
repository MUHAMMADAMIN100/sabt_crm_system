import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Plus, X, LogOut, User as UserIcon, ClipboardCheck, FolderKanban, Image as ImageIcon,
  KanbanSquare, BarChart3, FileText, CalendarRange, Search, Wallet, TrendingUp, TrendingDown, Users,
  Building2, Package, Activity, Settings } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth.store'
import { canSeeSmmSection, canSeeDevSection, userCan } from '@/lib/permissions'
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
    if (canSeeSmmSection(user?.role)) {
      list.push({ key: 'story', label: 'Отметить сторис', icon: ImageIcon, run: () => navigate('/?day=today') })
    }
    if (userCan(user, 'tasks.create')) {
      list.push({ key: 'task', label: 'Новая задача', icon: ClipboardCheck, run: () => navigate('/tasks?new=1') })
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
    const list = [
      { to: '/dev', label: 'Умный календарь', icon: CalendarRange, perm: 'dev-tracker.view' as const },
      { to: '/dev/projects', label: 'Проекты', icon: FolderKanban, perm: 'dev-tracker.view' as const },
      { to: '/dev-board', label: 'Доска', icon: KanbanSquare, perm: 'dev-tracker.view' as const },
      { to: '/dev-board/kpi', label: 'KPI', icon: BarChart3, perm: 'dev-tracker.view' as const },
    ] as { to: string; label: string; icon: any; perm: 'dev-tracker.view' | 'dev-tracker.manage' }[]
    if (userCan(user, 'dev-tracker.manage')) {
      list.push({ to: '/dev-board/reports', label: 'Отчёты', icon: FileText, perm: 'dev-tracker.manage' })
    }
    return list.filter(l => userCan(user, l.perm))
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
      { to: '/finance/expense/salary', label: 'Зарплата', icon: Users },
      { to: '/finance/expense/rent_subs', label: 'Аренда и подписки', icon: Building2 },
      { to: '/finance/expense/debts', label: 'Долги', icon: BarChart3 },
      { to: '/finance/inventory', label: 'Инвентарь', icon: Package },
      { to: '/finance/activity', label: 'Активность', icon: Activity },
      { to: '/finance/settings', label: 'Настройки финансов', icon: Settings },
    ]
  }, [user])

  // Поиск по шторке: разделов вместе с подразделами больше двадцати, и
  // пролистывать их глазами дольше, чем набрать два слога.
  const match = (label: string) => {
    const s = q.trim().toLowerCase()
    return !s || label.toLowerCase().includes(s)
  }
  const restF = rest.filter(i => match(i.label))
  const financeF = financeLinks.filter(l => match(l.label))
  const devF = devLinks.filter(l => match(l.label))
  const nothingFound = !!q.trim() && !restF.length && !financeF.length && !devF.length

  // Кнопка создания стоит в средней колонке, поэтому разделы делятся на две
  // части: два слева от неё, остальное справа.
  const left = pinned.slice(0, 2)
  const right = pinned.slice(2)

  // Таб «Разработка» ведёт не только на /dev: запоминаем последний открытый
  // подраздел (доска/KPI/проекты/календарь) и возвращаем туда; повторный тап
  // внутри раздела открывает шторку «Ещё» со всеми пятью подразделами.
  const isDevRoute =
    location.pathname === '/dev' || location.pathname.startsWith('/dev/') ||
    location.pathname === '/dev-board' || location.pathname.startsWith('/dev-board/')
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
                <button onClick={() => setMore(false)} className="ml-auto w-7 h-7 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 flex items-center justify-center"><X size={14} /></button>
              </div>
              <div className="px-2 pb-1">
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
                    попадаются пальцем не глядя. В поиске её не прячем. */}
                {!q.trim() && (
                  <div className="px-1 pb-2">
                    <ShiftButton variant="sheet" />
                  </div>
                )}
                {nothingFound && (
                  <p className="px-3 py-6 text-center text-[13.5px] text-surface-400">
                    Ничего не нашлось. Попробуйте короче — например, «зар» или «план».
                  </p>
                )}
                {restF.length > 0 && <SheetGroup title="Разделы" />}
                {restF.map(i => (
                  <SheetLink key={i.to} to={i.to} icon={i.icon} label={i.label} onGo={() => setMore(false)} />
                ))}
                {financeF.length > 0 && <SheetGroup title="Финансы" />}
                {financeF.map(l => (
                  <SheetLink key={l.to} to={l.to} icon={l.icon} label={l.label} onGo={() => setMore(false)} end />
                ))}
                {devF.length > 0 && <SheetGroup title="Разработка" />}
                {devF.map(l => (
                  <SheetLink key={l.to} to={l.to} icon={l.icon} label={l.label} onGo={() => setMore(false)} />
                ))}
                {!q.trim() && (
                  <>
                    <NavLink to="/profile" onClick={() => setMore(false)}
                      className="flex items-center gap-3 px-3 min-h-[48px] rounded-xl text-surface-800 dark:text-surface-200 border-t border-surface-100 dark:border-surface-800 mt-1 pt-3">
                      <UserIcon size={18} className="text-surface-400 shrink-0" />
                      <b className="text-[14px] font-semibold flex-1">{user?.name || 'Профиль'}</b>
                      <span className="text-surface-300 dark:text-surface-600">›</span>
                    </NavLink>
                    <button onClick={() => { setMore(false); logout() }}
                      className="w-full flex items-center gap-3 px-3 min-h-[48px] rounded-xl text-red-600 dark:text-red-400">
                      <LogOut size={18} className="shrink-0" />
                      <b className="text-[14px] font-semibold flex-1 text-left">Выйти</b>
                    </button>
                  </>
                )}
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

        <button onClick={() => { setMore(false); setFan(v => !v) }} title="Создать"
          className={clsx('relative justify-self-center w-[52px] h-[52px] -mt-7 rounded-full bg-primary-600 text-white',
            'flex items-center justify-center shadow-lg shadow-primary-600/40 transition-transform',
            fan && 'rotate-45')}>
          <Plus size={24} strokeWidth={2.2} />
        </button>

        {right.map(renderTab)}

        <button onClick={() => { setFan(false); setMore(v => !v) }}
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
function SheetLink({ to, icon: Icon, label, onGo, end }: {
  to: string; icon: any; label: string; onGo: () => void; end?: boolean
}) {
  return (
    <NavLink to={to} end={end} onClick={onGo}
      className={({ isActive }) => clsx(
        'flex items-center gap-3 px-3 min-h-[48px] rounded-xl',
        isActive
          ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
          : 'text-surface-800 dark:text-surface-200',
      )}>
      {({ isActive }) => (
        <>
          <Icon size={18} className={clsx('shrink-0', isActive ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400')} />
          <b className="text-[14px] font-semibold flex-1">{label}</b>
          <span className="text-surface-300 dark:text-surface-600">›</span>
        </>
      )}
    </NavLink>
  )
}
