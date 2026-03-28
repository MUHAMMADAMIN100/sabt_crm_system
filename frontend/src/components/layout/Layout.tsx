import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuthStore } from '@/store/auth.store'
import { useSocket } from '@/hooks/useSocket'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const fetchMe = useAuthStore(s => s.fetchMe)
  const token = useAuthStore(s => s.token)
  const location = useLocation()

  useEffect(() => { fetchMe() }, [])
  useSocket(token)

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

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(o => !o)} />
        <main className="flex-1 overflow-y-auto p-6">
          {/* key on pathname so each navigation re-triggers the animation */}
          <div key={location.pathname} className="max-w-screen-2xl mx-auto animate-page-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
