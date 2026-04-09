import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

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
      // connected
    })

    socket.on('notification', (notif: any) => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notifications-count'] })
      toast(notif.title || 'Новое уведомление', { icon: '🔔' })
    })

    socket.on('employees:changed', () => {
      qc.refetchQueries({ queryKey: ['employees'] })
    })

    socket.on('projects:changed', () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    })

    socket.on('tasks:changed', () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['my-tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['task-status'] })
    })

    socket.on('disconnect', () => {
      // disconnected
    })

    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [token, qc])

  return socketRef
}
