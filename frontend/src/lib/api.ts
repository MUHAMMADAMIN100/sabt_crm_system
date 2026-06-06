import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 90000, // 90s — AI requests can take 30-60s
  // httpOnly cookie с JWT уйдёт автоматически на каждый запрос (CORS +
  // credentials true на бэке). JavaScript токен прочитать не может.
  withCredentials: true,
})

/** Bearer-токен fallback на случай когда third-party cookies не работают
 *  (Chrome с anti-tracking, incognito, разные домены frontend/backend).
 *  Храним в sessionStorage:
 *    - живёт только в одной вкладке (закрыл — токен умер),
 *    - не доступен другим вкладкам/доменам,
 *    - не сохраняется между сессиями браузера.
 *  Безопаснее localStorage: автологин при следующем визите невозможен.
 *  Refresh-токен НЕ храним в JS-окружении — после истечения access (15 мин)
 *  в браузерах без cookies юзеру придётся перелогиниться. */
const TOKEN_KEY = 'sabt-access-token'
const REFRESH_KEY = 'sabt-refresh-token'
export const tokenStore = {
  getAccess(): string | null {
    try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  getRefresh(): string | null {
    try { return sessionStorage.getItem(REFRESH_KEY) } catch { return null }
  },
  set(accessToken?: string | null, refreshToken?: string | null) {
    try {
      if (accessToken)  sessionStorage.setItem(TOKEN_KEY, accessToken)
      if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken)
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(REFRESH_KEY)
    } catch {}
  },
}

/** Окно «грейс-периода» после успешного login/refresh. Auth store зовёт
 *  markJustAuthed() сразу после установки cookie. В течение этого окна
 *  interceptor НЕ выкидывает на /auth по 401 — это защита от гонки:
 *  dashboard'ы стартуют параллельно кучу запросов, и первый-же с косячным
 *  таймингом куки забирал пользователя обратно на экран входа, хотя
 *  cookie уже выставлена. */
let justAuthedUntil = 0
export const markJustAuthed = (windowMs = 8000) => {
  justAuthedUntil = Date.now() + windowMs
}
/** true пока действует грейс после login — auth.store смотрит на это,
 *  чтобы не сбрасывать `authenticated: false` при случайном 401 в первые
 *  секунды после входа (там могут быть гонки cookie / параллельные запросы). */
export const isJustAuthed = () => Date.now() < justAuthedUntil

api.interceptors.request.use(config => {
  // Bearer-фоллбэк: если в sessionStorage есть access-токен — отправляем
  // его в Authorization header. Cookie с тем же токеном тоже идёт через
  // withCredentials — что сработает, то backend и примет (JwtStrategy
  // умеет извлекать из обоих источников). Это нужно для браузеров,
  // блокирующих third-party cookies (Chrome anti-tracking, incognito).
  const access = tokenStore.getAccess()
  if (access && config.headers && !(config.headers as any).Authorization) {
    ;(config.headers as any).Authorization = `Bearer ${access}`
  }
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
      // Если у нас есть refresh-токен в sessionStorage (cookies заблокированы)
      // — отдаём его в body. Иначе бэк прочитает из httpOnly cookie.
      const refreshFromStore = tokenStore.getRefresh()
      const { data } = await api.post('/auth/refresh', refreshFromStore ? { refreshToken: refreshFromStore } : {})
      // Обновляем sessionStorage свежими токенами (если бэк их вернул).
      if (data?.accessToken || data?.refreshToken) {
        tokenStore.set(data.accessToken, data.refreshToken)
      }
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

    if (
      status === 401 &&
      !window.location.pathname.includes('/auth') &&
      !window.location.pathname.startsWith('/public/')
    ) {
      // Грейс после login: даём фронту 5 сек устаканиться, не делаем агрессивный
      // редирект — пользователь только-только вошёл, выкидывать его обратно
      // на /auth из-за тайминга гонки куки нельзя.
      if (Date.now() < justAuthedUntil) {
        return Promise.reject(err)
      }
      const msg: string = err.response?.data?.message || ''
      if (msg.includes('заблокировал') || msg.toLowerCase().startsWith('blocked')) {
        sessionStorage.setItem('blocked-message', msg.replace(/^BLOCKED:\s*/i, ''))
      }
      try { localStorage.removeItem('token') } catch {}
      try { localStorage.removeItem('auth-storage') } catch {}
      tokenStore.clear()
      window.location.href = '/auth'
    }
    return Promise.reject(err)
  },
)

export default api
