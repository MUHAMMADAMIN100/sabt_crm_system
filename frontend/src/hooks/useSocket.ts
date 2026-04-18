import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'

export function useSocket(token: string | null) {
  const qc = useQueryClient()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!token) return

    const wsUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${wsUrl}/ws`, {
      auth: { token },
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
      qc.invalidateQueries({ queryKey: ['stories'] })
      qc.invalidateQueries({ queryKey: ['employee-stories'] })
      qc.invalidateQueries({ queryKey: ['stories-all'] })
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

    socket.on('disconnect', () => {})

    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [token, qc])

  return socketRef
}
