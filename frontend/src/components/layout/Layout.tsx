import { useState, useEffect, Suspense, type CSSProperties } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { PageLoader } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { useSocket } from '@/hooks/useSocket'
import KpiCelebrationWatcher from '@/hooks/useKpiCelebrationWatcher'
import { authApi } from '@/services/api.service'
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
        const url = `${(import.meta as any).env.VITE_API_URL || ''}/auth/heartbeat`
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
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 993)
  const fetchMe = useAuthStore(s => s.fetchMe)
  // authenticated — флаг локального состояния. JWT теперь в httpOnly cookie,
  // фронт его не видит. Socket / heartbeat пускаем когда юзер залогинен.
  const authenticated = useAuthStore(s => s.authenticated)
  const location = useLocation()

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

  // Handle resize: auto-open on desktop, auto-close on mobile/tablet
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 993) setSidebarOpen(true)
      else setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    // app-shell — якорь для персональных обоев (lib/wallpaper.ts). Картинка
    // ложится на этот же слой поверх цвета фона, поэтому шапка, сайдбар и
    // карточки рисуются над ней без возни с z-index.
    //
    // --app-sidebar-w отдаём в CSS: сайдбар и шапка непрозрачные, и обои
    // видно только в рабочей области. Без этой ширины уменьшенная картинка
    // центровалась бы по всему экрану и уезжала левым краем под сайдбар.
    <div
      className="app-shell flex h-screen bg-surface-100 dark:bg-surface-900 overflow-hidden"
      style={{ '--app-sidebar-w': sidebarOpen ? '260px' : '72px' } as CSSProperties}
    >
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden animate-backdrop-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div
        className={clsx(
          'flex flex-col min-w-0 overflow-hidden flex-1',
          '[transition:margin-left_0.4s_cubic-bezier(0.4,0,0.2,1)]',
          sidebarOpen ? 'ml-0 lg:ml-[260px]' : 'ml-0 lg:ml-[72px]',
        )}
      >
        <Header onMenuClick={() => setSidebarOpen(o => !o)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {/* key on pathname so each navigation re-triggers the animation */}
          <div key={location.pathname} className="max-w-screen-2xl mx-auto animate-page-in">
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
    </div>
  )
}
