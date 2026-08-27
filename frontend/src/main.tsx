import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import { initThemeFromStorage } from './lib/theme'
import { queryClient } from './lib/queryClient'

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
