import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export function useSocket(token: string | null) {
  const qc = useQueryClient()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!token) return

    const wsUrl = import.meta.env.VITE_API_URL || ''
    const socket = io(`${wsUrl}/ws`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
    })

    socket.on('connect', () => {
      console.log('[WS] connected')
    })

    socket.on('notification', (notif: any) => {
      // Refresh the notifications count/list
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notifications-count'] })
      // Show a toast for the new notification
      toast(notif.title || 'Новое уведомление', { icon: '🔔' })
    })

    socket.on('disconnect', () => {
      console.log('[WS] disconnected')
    })

    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [token, qc])

  return socketRef
}
