import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 90000, // 90s — AI requests can take 30-60s
  // httpOnly cookie с JWT уйдёт автоматически на каждый запрос (CORS +
  // credentials true на бэке). JavaScript токен прочитать не может.
  withCredentials: true,
})

api.interceptors.request.use(config => {
  // Поддержка legacy-токена в localStorage — если кто-то ещё не
  // перелогинился после миграции на httpOnly cookie. Через 1-2 недели
  // после деплоя этот блок можно убрать.
  const legacyToken = localStorage.getItem('token')
  if (legacyToken) config.headers.Authorization = `Bearer ${legacyToken}`
  if (config.method === 'get' || config.method === 'GET') {
    config.params = { ...(config.params || {}), _t: Date.now() }
  }
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    // Нормализуем err.response.data.message до строки.
    // NestJS ValidationPipe возвращает массив (["Пароль должен...", ...]),
    // другие ошибки — строку. Без нормализации любой .toLowerCase()/.includes()
    // в обработчиках крашит catch и глотает ошибку без уведомления пользователю.
    const raw = err.response?.data?.message
    if (err.response?.data) {
      if (Array.isArray(raw)) {
        err.response.data.message = raw.filter(Boolean).join('\n')
      } else if (raw && typeof raw === 'object') {
        err.response.data.message = Object.values(raw).filter(Boolean).join('\n')
      }
    }

    if (err.response?.status === 401 && !window.location.pathname.includes('/auth')) {
      // Capture blocked message so AuthPage can show the banner
      const msg: string = err.response?.data?.message || ''
      if (msg.includes('заблокировал') || msg.toLowerCase().startsWith('blocked')) {
        sessionStorage.setItem('blocked-message', msg.replace(/^BLOCKED:\s*/i, ''))
      }
      localStorage.removeItem('token')
      localStorage.removeItem('auth-storage')
      window.location.href = '/auth'
    }
    return Promise.reject(err)
  },
)

export default api
