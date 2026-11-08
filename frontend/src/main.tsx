import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import { initThemeFromStorage } from './lib/theme'
import { queryClient } from './lib/queryClient'
import { startPersistedCache, setPersistedCacheUser, wipePersistedCache } from './lib/persistCache'
import { useAuthStore, type User } from './store/auth.store'

// Тёмная тема зафиксирована на всю компанию — включаем класс `dark` ДО первого
// рендера, чтобы не мигало светлым (сохранённый выбор режима игнорируется).
document.documentElement.classList.add('dark')
// Применяем персональный акцентный цвет ДО первого рендера — иначе
// интерфейс мигает дефолтным ч/б, пока не придёт /auth/me.
initThemeFromStorage()
// Персональные обои интерфейса отключены: у всех сотрудников единый
// стандартный фон темы. Старый кэш картинки (сотни килобайт base64) чистим,
// чтобы он не занимал место в localStorage.
try { localStorage.removeItem('wallpaper') } catch { /* ignore */ }

/**
 * Одноразовая чистка legacy-данных в localStorage от старой схемы
 * аутентификации (до перехода на httpOnly cookie). Если ключ есть —
 * удаляем. Пользователь будет автоматически перелогинен через axios-
 * interceptor (401 → редирект на /auth) при первом запросе.
 *
 * После того как ВСЕ активные пользователи перелогинятся хотя бы один
 * раз (1-2 недели), этот блок можно убрать.
 */
try {
  if (localStorage.getItem('token')) {
    localStorage.removeItem('token')
  }
} catch {}

/**
 * Кэш данных на устройстве (08.11.2026): задачи, умный календарь, сторис и
 * уведомления с прошлого запуска показываются сразу, сервер — в фоне.
 * Чтение из IndexedDB стартует здесь, параллельно /auth/me; в кэш запросов
 * снимок попадает, только когда /auth/me подтвердит того же пользователя.
 * Не вошёл никто — снимок стираем. Любая ошибка — работаем как раньше.
 * Владелец снимка — человек вместе с ролями и доступами: после смены роли
 * или доступов данные прошлого уровня, например общий список задач, не
 * показываются даже на секунду.
 */
try {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).sort() : [])
  const cacheOwner = (u: User | null): string | null => {
    if (!u?.id) return null
    try {
      return JSON.stringify([u.id, u.role ?? '', u.secondaryRole ?? '', !!u.isStoryMaker,
        list(u.extraPermissions), list(u.deniedPermissions)])
    } catch { return null }
  }
  startPersistedCache(queryClient)
  const auth = useAuthStore.getState()
  if (!auth.authenticated) wipePersistedCache()
  setPersistedCacheUser(cacheOwner(auth.user))
  // Слушатель вызывается внутри set() стора — ни при каких данных не бросает.
  useAuthStore.subscribe(s => { try { setPersistedCacheUser(cacheOwner(s.user)) } catch { /* ignore */ } })
} catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="top-right" toastOptions={{
          style: { borderRadius: '12px', fontSize: '14px' },
        }} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
