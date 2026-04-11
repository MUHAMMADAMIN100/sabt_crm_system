import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 90000, // 90s — AI requests can take 30-60s
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
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
