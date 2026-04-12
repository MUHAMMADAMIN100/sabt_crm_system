import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState } from '@/components/ui'
import { Bell, CheckCheck, Trash2, AlertTriangle, Clock, TrendingDown, UserX, DollarSign } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import clsx from 'clsx'

// Типы уведомлений которые являются "негативными" (только для основателя)
const NEGATIVE_TYPES = [
  'task_overdue',
  'deadline_approaching',
  'deadline_tomorrow',
  'task_returned',
  'inactivity_24h',
  'payment_reminder',
  'project_overdue',
]

const NOTIFICATION_ICONS: Record<string, any> = {
  task_overdue: TrendingDown,
  deadline_approaching: Clock,
  deadline_tomorrow: Clock,
  task_returned: AlertTriangle,
  inactivity_24h: UserX,
  payment_reminder: DollarSign,
  project_overdue: AlertTriangle,
  default: Bell,
}

const NOTIFICATION_COLORS: Record<string, string> = {
  task_overdue: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  deadline_approaching: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
  deadline_tomorrow: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
  task_returned: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20',
  inactivity_24h: 'text-gray-500 bg-gray-100 dark:bg-gray-800',
  payment_reminder: 'text-red-600 bg-red-50 dark:bg-red-900/20',
  project_overdue: 'text-red-600 bg-red-50 dark:bg-red-900/20',
  default: 'text-primary-600 bg-primary-50 dark:bg-primary-900/20',
}

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const isFounder = user?.role === 'founder'

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
  })

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

  // Для основателя — только негативные уведомления
  const filtered = isFounder
    ? (notifications || []).filter((n: any) => NEGATIVE_TYPES.includes(n.type))
    : (notifications || [])

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{t('notifications.title')}</h1>
          {isFounder && (
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 flex items-center gap-1">
              <AlertTriangle size={11} className="text-orange-400" />
              Показаны только критические уведомления
            </p>
          )}
        </div>
        {filtered.some((n: any) => !n.isRead) && (
          <button onClick={() => markAll.mutate(undefined)} className="btn-secondary text-xs">
            <CheckCheck size={14} /> {t('notifications.markAllRead')}
          </button>
        )}
      </div>

      {!filtered.length ? (
        <EmptyState
          title={isFounder ? 'Нет критических уведомлений' : t('notifications.noNotifications')}
          description={isFounder ? 'Все проекты и задачи в порядке' : t('notifications.noNotificationsDesc')}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((n: any) => {
            const IconComp = NOTIFICATION_ICONS[n.type] || NOTIFICATION_ICONS.default
            const colorClass = NOTIFICATION_COLORS[n.type] || NOTIFICATION_COLORS.default
            const isNegative = NEGATIVE_TYPES.includes(n.type)
            return (
              <div
                key={n.id}
                className={clsx(
                  'card flex items-start gap-4 transition-colors',
                  !n.isRead && isNegative
                    ? 'border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-900/10'
                    : !n.isRead
                    ? 'border-primary-100 dark:border-primary-900/50 bg-primary-50/30 dark:bg-primary-900/10'
                    : '',
                )}
              >
                <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', colorClass)}>
                  <IconComp size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={clsx('text-sm font-medium', !n.isRead ? 'text-surface-900 dark:text-surface-100' : 'text-surface-600 dark:text-surface-400')}>
                    {n.title}
                  </p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{n.message}</p>
                  {n.link && (
                    <Link to={n.link} className="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-1 inline-block">
                      Перейти →
                    </Link>
                  )}
                  <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                    {format(new Date(n.createdAt), 'dd.MM.yyyy HH:mm')}
                  </p>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
