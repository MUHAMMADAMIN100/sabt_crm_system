import { useState, useEffect, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { PageLoader } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { useSocket } from '@/hooks/useSocket'
import KpiCelebrationWatcher from '@/hooks/useKpiCelebrationWatcher'
import StampCelebration from '@/components/tasks/StampCelebration'
import { authApi } from '@/services/api.service'
import { Menu } from 'lucide-react'
import clsx from 'clsx'

/** Брендированный «пульсирующий S» лоадер при переходе между route'ами.
 *  Layout (Sidebar + Header) остаётся смонтированным — sidebar не «мигает»
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
  const fetchMe = useAuthStore(s => s.fetchMe)
  // authenticated — флаг локального состояния. JWT теперь в httpOnly cookie,
  // фронт его не видит. Socket / heartbeat пускаем когда юзер залогинен.
  const authenticated = useAuthStore(s => s.authenticated)
  const location = useLocation()
  const financeRoute = location.pathname === '/finance' || location.pathname.startsWith('/finance/')

  // fetchMe нужен только если пришли по F5 (user пуст). После свежего login()
  // user уже загружен — повторный вызов плодит гонку с interceptor'ом
  // (если он по таймингу вернёт 401, выкинет на /auth сразу после успешного
  // входа). Поэтому вызываем строго при отсутствии user.
  useEffect(() => {
    if (!useAuthStore.getState().user) fetchMe()
  }, [])
  useSocket(authenticated ? 'cookie' : null)
  useSessionHeartbeat(authenticated ? 'cookie' : null)

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

  return (
    // app-shell — якорь для эффектов на весь интерфейс (например, встряска
    // при «печати успеха» в index.css). Фон у всех один — цвет темы.
    <div className="app-shell flex h-screen bg-surface-100 dark:bg-surface-900 overflow-hidden">
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
        {/* Мобильная кнопка открытия меню (в десктопе сайдбар всегда виден; верхней панели больше нет) */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Меню"
            className="fixed top-2 left-2 z-30 lg:hidden p-2 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shadow-md text-surface-600 dark:text-surface-300"
          >
            <Menu size={18} />
          </button>
        )}
        <main className={clsx('flex-1 overflow-y-auto p-4 lg:p-6', financeRoute && 'finance-workspace min-w-0 overflow-x-hidden')}>
          {/* key on pathname so each navigation re-triggers the animation */}
          <div
            key={location.pathname}
            className={clsx('max-w-screen-2xl mx-auto animate-page-in', financeRoute && 'finance-workspace-inner w-full min-w-0')}
          >
            {/* Внутренний Suspense ловит lazy-чанки страниц, не давая
                верхнему Suspense вышибить весь Layout (sidebar+header) до
                splash-логотипа. */}
            <Suspense fallback={<RouteLoader />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {/* Глобальный watcher KPI продаж — поздравительный модал поверх
          любой страницы, активен только для sales_manager_smm/dev. */}
      <KpiCelebrationWatcher />
      {/* «Печать успеха» за выполненную задачу — глобально, чтобы срабатывала
          на любом экране; сама решает, показываться ли роли. */}
      <StampCelebration />
    </div>
  )
}
