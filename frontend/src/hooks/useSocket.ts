import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { tokenStore } from '@/lib/api'

/**
 * Подключение к WebSocket. JWT теперь живёт в httpOnly cookie — она
 * автоматически уйдёт в socket.io handshake при `withCredentials: true`.
 * Если есть legacy-токен (старая сессия в localStorage) — отдадим его
 * в auth для совместимости с пере-деплоем бэка.
 */
export function useSocket(authMarker: string | null) {
  const qc = useQueryClient()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!authMarker) return

    const wsUrl = import.meta.env.VITE_API_URL || window.location.origin
    const bearer = tokenStore.getAccess()
    const socket = io(`${wsUrl}/ws`, {
      // httpOnly cookie auth_token уйдёт в handshake благодаря
      // withCredentials. Gateway читает её из handshake.headers.cookie.
      // Параллельно отдаём токен через auth.token — это fallback для
      // браузеров, где cookies заблокированы (Chrome anti-tracking).
      withCredentials: true,
      auth: bearer ? { token: bearer } : undefined,
      transports: ['websocket'],
      reconnectionAttempts: 5,
    })

    socket.on('connect', () => {
      // On (re)connect refetch everything that might have been missed
      qc.refetchQueries({ type: 'active' })
    })

    // When admin updates this user's role/profile — refresh auth store and notify
    socket.on('me:changed', async (changes: any) => {
      try {
        await useAuthStore.getState().fetchMe()
        if (changes?.role) {
          toast.success('Ваша роль обновлена администратором', { icon: '👤', duration: 4000 })
        }
      } catch {}
    })

    // Мгновенный logout при блокировке учётки администратором.
    // Бэкенд эмитит auth:blocked адресно через notifyUser(userId, ...).
    socket.on('auth:blocked', (payload: any) => {
      const reason = payload?.reason ? ` Причина: ${payload.reason}` : ''
      toast.error(`Ваш аккаунт заблокирован администратором.${reason}`, {
        duration: 6000,
        icon: '🔒',
      })
      // Чистим токен и перебрасываем на /auth. logout() сам обнулит store.
      ;(async () => {
        try { await useAuthStore.getState().logout() } catch {}
        // Защита: если logout не довёл — точно вычистить и редирект.
        try { localStorage.removeItem('token') } catch {}
        if (!window.location.pathname.includes('/auth')) {
          window.location.href = '/auth'
        }
      })()
    })

    socket.on('notification', (notif: any) => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notifications-count'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
      toast(notif.title || 'Новое уведомление', { icon: '🔔' })
    })

    socket.on('employees:changed', () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['employee'] })
      qc.invalidateQueries({ queryKey: ['employee-tasks'] })
      qc.invalidateQueries({ queryKey: ['employee-stories'] })
      qc.invalidateQueries({ queryKey: ['employee-efficiency'] })
      qc.invalidateQueries({ queryKey: ['employee-workload'] })
      qc.invalidateQueries({ queryKey: ['emp-eff'] })
      qc.invalidateQueries({ queryKey: ['emp-activity'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics-overview'] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
    })

    socket.on('projects:changed', () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['projects-archived'] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['project-ads'] })
      qc.invalidateQueries({ queryKey: ['project-announcements'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['proj-status'] })
      qc.invalidateQueries({ queryKey: ['proj-perf'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['files'] })
      qc.invalidateQueries({ queryKey: ['files-project'] })
      qc.refetchQueries({ queryKey: ['projects'], type: 'active' })
      qc.refetchQueries({ queryKey: ['project'], type: 'active' })
      qc.refetchQueries({ queryKey: ['project-ads'], type: 'active' })
    })

    socket.on('stories:changed', () => {
      // Все возможные ключи запросов, использующие stories — иначе head_smm/PM
      // не видит отметки SMM-команды без ручного refresh.
      qc.invalidateQueries({ queryKey: ['stories'] })
      qc.invalidateQueries({ queryKey: ['employee-stories'] })
      qc.invalidateQueries({ queryKey: ['stories-all'] })
      qc.invalidateQueries({ queryKey: ['project-stories'] })   // ProjectDetailPage SMM heatmap
      qc.invalidateQueries({ queryKey: ['stories-global'] })    // Global calendar (Founder/HeadSMM)
      // Активный refetch — чтобы данные пришли мгновенно, не по визиту
      qc.refetchQueries({ queryKey: ['project-stories'], type: 'active' })
      qc.refetchQueries({ queryKey: ['stories-global'], type: 'active' })
    })

    socket.on('tasks:changed', () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['my-tasks'] })
      qc.invalidateQueries({ queryKey: ['task'] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['task-status'] })
      qc.invalidateQueries({ queryKey: ['task-priority'] })
      qc.invalidateQueries({ queryKey: ['tasks-review'] })
      qc.invalidateQueries({ queryKey: ['tasks-overdue'] })
      qc.invalidateQueries({ queryKey: ['task-results'] })
      qc.invalidateQueries({ queryKey: ['task-checklist'] })
      qc.invalidateQueries({ queryKey: ['task-files'] })
      qc.invalidateQueries({ queryKey: ['employee-tasks'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics-workload'] })
      qc.invalidateQueries({ queryKey: ['employee-workload'] })
      qc.invalidateQueries({ queryKey: ['employee-efficiency'] })
      qc.invalidateQueries({ queryKey: ['emp-eff'] })
      qc.invalidateQueries({ queryKey: ['emp-activity'] })
      qc.invalidateQueries({ queryKey: ['proj-perf'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      // Force active queries to refetch immediately
      qc.refetchQueries({ queryKey: ['tasks'], type: 'active' })
      qc.refetchQueries({ queryKey: ['project'], type: 'active' })
      qc.refetchQueries({ queryKey: ['my-tasks'], type: 'active' })
    })

    // Real-time KPI продаж: бэк броадкастит при любом изменении лида
    // (create/update/remove) — сразу инвалидируем и рефечим все KPI-кэши
    // и список клиентов. Это убирает необходимость F5 на дашборде MP и
    // у founder, когда менеджер двигает лида / меняет «Тип звонка».
    socket.on('leads:changed', () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      qc.invalidateQueries({ queryKey: ['kpi-all'] })
      qc.invalidateQueries({ queryKey: ['kpi-details'] })
      qc.refetchQueries({ queryKey: ['sales-kpi'], type: 'active' })
      qc.refetchQueries({ queryKey: ['kpi-user'], type: 'active' })
      qc.refetchQueries({ queryKey: ['kpi-all'], type: 'active' })
      qc.refetchQueries({ queryKey: ['clients'], type: 'active' })
    })

    socket.on('disconnect', () => {})

    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [authMarker, qc])

  return socketRef
}
