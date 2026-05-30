import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 90000, // 90s — AI requests can take 30-60s
  // httpOnly cookie с JWT уйдёт автоматически на каждый запрос (CORS +
  // credentials true на бэке). JavaScript токен прочитать не может.
  withCredentials: true,
})

api.interceptors.request.use(config => {
  // Никаких токенов из localStorage — JWT теперь только в httpOnly cookie,
  // браузер сам прикрепит его благодаря withCredentials.
  if (config.method === 'get' || config.method === 'GET') {
    config.params = { ...(config.params || {}), _t: Date.now() }
  }
  return config
})

// Concurrent-safe refresh: пока один запрос обновляет access-токен,
// остальные ждут его результат, не плодя N параллельных /auth/refresh.
let refreshPromise: Promise<boolean> | null = null
const tryRefresh = (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      await api.post('/auth/refresh')
      return true
    } catch {
      return false
    } finally {
      // Освобождаем чтобы следующий 401 мог снова попробовать.
      setTimeout(() => { refreshPromise = null }, 0)
    }
  })()
  return refreshPromise
}

api.interceptors.response.use(
  res => res,
  async err => {
    const raw = err.response?.data?.message
    if (err.response?.data) {
      if (Array.isArray(raw)) {
        err.response.data.message = raw.filter(Boolean).join('\n')
      } else if (raw && typeof raw === 'object') {
        err.response.data.message = Object.values(raw).filter(Boolean).join('\n')
      }
    }

    const status = err.response?.status
    const url: string = err.config?.url || ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/register')

    // Один раз пробуем refresh при 401 (access-токен живёт всего 15 мин).
    // Не для /auth/* — иначе бесконечный цикл.
    if (status === 401 && !isAuthEndpoint && !err.config?.__retry) {
      const ok = await tryRefresh()
      if (ok) {
        err.config.__retry = true
        return api.request(err.config)
      }
    }

    if (status === 401 && !window.location.pathname.includes('/auth')) {
      const msg: string = err.response?.data?.message || ''
      if (msg.includes('заблокировал') || msg.toLowerCase().startsWith('blocked')) {
        sessionStorage.setItem('blocked-message', msg.replace(/^BLOCKED:\s*/i, ''))
      }
      try { localStorage.removeItem('token') } catch {}
      try { localStorage.removeItem('auth-storage') } catch {}
      window.location.href = '/auth'
    }
    return Promise.reject(err)
  },
)

export default api
