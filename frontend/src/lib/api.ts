import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 90000, // 90s — AI requests can take 30-60s
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Prevent any HTTP cache from serving stale data
  if (config.method === 'get' || config.method === 'GET') {
    config.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    config.headers['Pragma'] = 'no-cache'
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
