import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuthStore } from '@/store/auth.store'
import { useSocket } from '@/hooks/useSocket'
import { authApi } from '@/services/api.service'
import clsx from 'clsx'

/** Каждые 60 сек шлём heartbeat — backend обновляет lastSeenAt текущей
 *  открытой сессии, чтобы при следующем входе её длительность была
 *  посчитана до момента реального ухода пользователя, а не до бесконечности. */
function useSessionHeartbeat(token: string | null) {
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
  const token = useAuthStore(s => s.token)
  const location = useLocation()

  useEffect(() => { fetchMe() }, [])
  useSocket(token)
  useSessionHeartbeat(token)

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
    <div className="flex h-screen bg-surface-50 dark:bg-surface-900 overflow-hidden">
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
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
