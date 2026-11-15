import { useState, useEffect, useRef, Suspense } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import ImpersonationBanner from './ImpersonationBanner'
import PageErrorBoundary from './PageErrorBoundary'
import { ChangePasswordSection } from '@/components/profile/SecuritySection'
import { PageLoader } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { useSocket } from '@/hooks/useSocket'
import KpiCelebrationWatcher from '@/hooks/useKpiCelebrationWatcher'
import StampCelebration from '@/components/tasks/StampCelebration'
import { authApi } from '@/services/api.service'
import clsx from 'clsx'
import { useScrollMemory } from '@/lib/navMemory'

/** Брендированный «пульсирующий S» лоадер при переходе между route'ами.
 *  Layout (Sidebar + BottomNav) остаётся смонтированным — sidebar не «мигает»
 *  и не теряет пункты при навигации, а пользователь видит знакомый
 *  логотип-плитку вместо пустоты. */
function RouteLoader() {
  return <PageLoader />
}

/** Каждые 60 сек шлём heartbeat — backend обновляет lastSeenAt текущей
 *  открытой сессии, чтобы при следующем входе её длительность была
 *  посчитана до момента реального ухода пользователя, а не до бесконечности. */
function useSessionHeartbeat(authMarker: string | null) {
  const token = authMarker // alias: токен теперь в httpOnly cookie, нам нужен только маркер «есть сессия»
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const tick = () => {
      if (cancelled || document.hidden) return
      authApi.heartbeat().catch(() => { /* heartbeat best-effort */ })
    }
    tick() // сразу же отметить «жив» при монтировании
    const id = window.setInterval(tick, 60_000)

    // При закрытии вкладки — последний beacon, чтобы lastSeenAt был
    // максимально близок к реальному уходу.
    const sendBeacon = () => {
      try {
        // Тот же базовый путь, что у axios (lib/api): без /api маяк уходил на
        // origin фронта и всегда получал 404 — сессия «жила» до бесконечности,
        // а консоль засорялась ошибками.
        const base = (import.meta as any).env.VITE_API_URL
        const url = base ? `${base}/api/auth/heartbeat` : '/api/auth/heartbeat'
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' })
        // Authorization-заголовок к sendBeacon прицепить нельзя; fallback на
        // обычный fetch с keepalive — куки/токен пойдут через axios-interceptor.
        if (!navigator.sendBeacon(url, blob)) {
          authApi.heartbeat().catch(() => {})
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('beforeunload', sendBeacon)
    window.addEventListener('pagehide', sendBeacon)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener('beforeunload', sendBeacon)
      window.removeEventListener('pagehide', sendBeacon)
    }
  }, [token])
}

export default function Layout() {
  // По умолчанию сайдбар свёрнут (разворачивается по наведению мышью). На мобильном false = скрыт.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // authenticated — флаг локального состояния. Токен — в httpOnly cookie и
  // в localStorage (tokenStore, lib/api.ts). Socket / heartbeat пускаем,
  // когда юзер залогинен.
  const authenticated = useAuthStore(s => s.authenticated)
  const location = useLocation()
  const navigate = useNavigate()
  const financeRoute = location.pathname === '/finance' || location.pathname.startsWith('/finance/')
  // «Директ» — рабочее окно чата на весь экран: без полей и ограничения ширины.
  // На телефоне открытый чат ещё и без нижней панели (как в Instagram).
  const directRoute = location.pathname === '/direct'
  const directParams = new URLSearchParams(location.search)
  const directTab = directParams.get('tab')
  const directChatOpen = directRoute && directParams.has('c') && directTab !== 'analytics' && directTab !== 'speed'

  // Свой fetchMe здесь не нужен (15.11.2026): PrivateRoute не рендерит
  // Layout, пока /auth/me не вернул user, — прежний эффект не срабатывал.
  useSocket(authenticated ? 'cookie' : null)
  useSessionHeartbeat(authenticated ? 'cookie' : null)
  // «Назад» на шаг (08.11.2026): прокрутка и «вы были здесь» для каждого шага.
  const mainRef = useRef<HTMLElement>(null)
  const navType = useScrollMemory(mainRef)

  // Auto-close sidebar on mobile/tablet navigation
  useEffect(() => {
    if (window.innerWidth < 993) setSidebarOpen(false)
  }, [location.pathname])

  // На мобильном/планшете закрываем сайдбар при ресайзе. На десктопе НЕ разворачиваем автоматически —
  // он остаётся свёрнутым (разворот по наведению), иначе наведение после загрузки не срабатывает.
  useEffect(() => {
    const onResize = () => { if (window.innerWidth < 993) setSidebarOpen(false) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // В отпуске открыт только профиль: любая другая страница ведёт туда.
  const onVacation = useAuthStore(s => !!s.user?.vacation)
  // Обязательная смена пароля (15.11.2026) — не в «Войти как»: там пароль
  // чужой, и менять его руководитель не должен.
  const mustChangePassword = useAuthStore(s => !!s.user?.mustChangePassword && !s.user?.impersonator)
  if (onVacation && !location.pathname.startsWith('/profile')) return <Navigate to="/profile" replace />

  return (
    // app-shell — якорь для эффектов на весь интерфейс (например, встряска
    // при «печати успеха» в index.css). Фон у всех один — цвет темы.
    <div className={clsx('app-shell flex h-screen bg-surface-100 dark:bg-surface-900 overflow-hidden', directRoute && 'direct-shell')}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden animate-backdrop-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onToggle={() => setSidebarOpen(o => !o)} />

      <div
        className={clsx(
          'flex flex-col min-w-0 overflow-hidden flex-1',
          '[transition:margin-left_0.4s_cubic-bezier(0.4,0,0.2,1)]',
          sidebarOpen ? 'ml-0 lg:ml-[260px]' : 'ml-0 lg:ml-[72px]',
        )}
      >
        {/* «Войти как»: основатель/админ в кабинете сотрудника — видно всегда. */}
        <ImpersonationBanner />
        {/* На телефоне навигация снизу: три раздела, «Ещё» и кнопка создания.
            Кнопка-гамбургер в углу больше не нужна. */}
        {!directChatOpen && <BottomNav />}
        <main ref={mainRef} className={clsx(
          'flex-1',
          directRoute
            ? clsx('min-h-0 overflow-hidden', !directChatOpen && 'pb-24 lg:pb-0')
            : 'overflow-y-auto p-4 lg:p-6 pb-24 lg:pb-6',
          financeRoute && 'finance-workspace min-w-0 overflow-x-hidden',
        )}>
          {/* key on pathname so each navigation re-triggers the animation */}
          <div
            key={location.pathname}
            className={clsx(
              // При «Назад» страница встаёт сразу, без проявления: возврат
              // не должен выглядеть как новая загрузка.
              directRoute ? 'h-full' : clsx('max-w-screen-2xl mx-auto', navType !== 'POP' && 'animate-page-in'),
              financeRoute && 'finance-workspace-inner w-full min-w-0',
            )}
          >
            {/* Внутренний Suspense ловит lazy-чанки страниц, не давая
                верхнему Suspense вышибить весь Layout (sidebar+header) до
                splash-логотипа. */}
            {/* Граница ошибок страницы (15.11.2026): ошибка одной страницы
                не роняет меню, переход на другой адрес её снимает. */}
            <PageErrorBoundary resetKey={location.pathname} onHome={() => navigate('/')}>
              <Suspense fallback={<RouteLoader />}>
                <Outlet />
              </Suspense>
            </PageErrorBoundary>
          </div>
        </main>
      </div>
      {/* Глобальный watcher KPI продаж — поздравительный модал поверх
          любой страницы, активен только для sales_manager_smm/dev. */}
      {!onVacation && <KpiCelebrationWatcher />}
      {/* «Печать успеха» за выполненную задачу — глобально, чтобы срабатывала
          на любом экране; сама решает, показываться ли роли. */}
      {!onVacation && <StampCelebration />}
      {/* Старый общий или выданный администратором пароль: сначала свой. */}
      {mustChangePassword && (
        <div role="dialog" aria-modal="true" aria-labelledby="force-password-title"
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4">
          <div className="w-full max-w-md">
            <ChangePasswordSection forced />
          </div>
        </div>
      )}
    </div>
  )
}
