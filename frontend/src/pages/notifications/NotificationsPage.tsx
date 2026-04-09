import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState } from '@/components/ui'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const { data: notifications, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.list() })

  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const previous = qc.getQueryData(['notifications'])
      qc.setQueryData(['notifications'], (old: any[]) => old?.map((n: any) => n.id === id ? { ...n, isRead: true } : n) ?? [])
      qc.setQueryData(['unread-count'], (old: number) => Math.max(0, (old || 0) - 1))
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['notifications'], context?.previous)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const previous = qc.getQueryData(['notifications'])
      qc.setQueryData(['notifications'], (old: any[]) => old?.map((n: any) => ({ ...n, isRead: true })) ?? [])
      qc.setQueryData(['unread-count'], 0)
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['notifications'], context?.previous)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
  const remove = useMutation({
    mutationFn: notificationsApi.remove,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const previous = qc.getQueryData(['notifications'])
      const notif = (previous as any[])?.find((n: any) => n.id === id)
      qc.setQueryData(['notifications'], (old: any[]) => old?.filter((n: any) => n.id !== id) ?? [])
      if (notif && !notif.isRead) {
        qc.setQueryData(['unread-count'], (old: number) => Math.max(0, (old || 0) - 1))
      }
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['notifications'], context?.previous)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{t('notifications.title')}</h1>
        {notifications?.some((n: any) => !n.isRead) && (
          <button onClick={() => markAll.mutate(undefined)} className="btn-secondary text-xs">
            <CheckCheck size={14} /> {t('notifications.markAllRead')}
          </button>
        )}
      </div>
      {!notifications?.length ? (
        <EmptyState title={t('notifications.noNotifications')} description={t('notifications.noNotificationsDesc')} />
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => (
            <div key={n.id} className={clsx('card flex items-start gap-4 transition-colors', !n.isRead && 'border-primary-100 dark:border-primary-900/50 bg-primary-50/30 dark:bg-primary-900/10')}>
              <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', !n.isRead ? 'bg-primary-100 dark:bg-primary-900/30' : 'bg-surface-100 dark:bg-surface-700')}>
                <Bell size={16} className={!n.isRead ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400 dark:text-surface-500'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={clsx('text-sm font-medium', !n.isRead ? 'text-surface-900 dark:text-surface-100' : 'text-surface-600 dark:text-surface-400')}>{n.title}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{n.message}</p>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">{format(new Date(n.createdAt), 'dd.MM.yyyy HH:mm')}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {!n.isRead && (
                  <button onClick={() => markRead.mutate(n.id)} className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg">
                    <CheckCheck size={14} className="text-primary-600 dark:text-primary-400" />
                  </button>
                )}
                <button onClick={() => remove.mutate(n.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
