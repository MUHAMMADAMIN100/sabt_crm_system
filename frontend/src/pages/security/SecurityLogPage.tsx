import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, ShieldAlert, ShieldCheck, AlertTriangle, LogIn, LogOut, KeyRound, UserX, UserCheck, RefreshCw, Ban } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import api from '@/lib/api'

interface SecurityEvent {
  id: string
  type: string
  userId: string | null
  email: string | null
  ip: string | null
  userAgent: string | null
  details: Record<string, any> | null
  createdAt: string
}

const TYPE_META: Record<string, { label: string; tone: 'success' | 'danger' | 'warn' | 'info'; icon: any }> = {
  login_success:        { label: 'Успешный вход',           tone: 'success', icon: LogIn },
  login_fail:           { label: 'Неудача входа',           tone: 'warn',    icon: AlertTriangle },
  login_blocked:        { label: 'Вход заблокирован',       tone: 'danger',  icon: Ban },
  logout:               { label: 'Выход',                   tone: 'info',    icon: LogOut },
  password_change:      { label: 'Смена пароля',            tone: 'info',    icon: KeyRound },
  password_reset_req:   { label: 'Запрос сброса пароля',    tone: 'info',    icon: KeyRound },
  password_reset_done:  { label: 'Пароль сброшен',          tone: 'info',    icon: KeyRound },
  token_refresh:        { label: 'Обновление токена',       tone: 'info',    icon: RefreshCw },
  refresh_reuse:        { label: '🚨 Refresh re-use',        tone: 'danger',  icon: ShieldAlert },
  forbidden_access:     { label: 'Попытка доступа выше роли', tone: 'danger', icon: Shield },
  role_changed:         { label: 'Смена роли',              tone: 'warn',    icon: UserCheck },
  user_blocked:         { label: 'Блокировка пользователя', tone: 'warn',    icon: UserX },
  user_unblocked:       { label: 'Разблокировка',           tone: 'success', icon: UserCheck },
  two_factor_enabled:   { label: '2FA включена',            tone: 'success', icon: ShieldCheck },
  two_factor_disabled:  { label: '2FA отключена',           tone: 'warn',    icon: Shield },
  two_factor_fail:      { label: '2FA: неверный код',       tone: 'danger',  icon: ShieldAlert },
}

const TONE_CLASS: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
  danger:  'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  warn:    'bg-surface-50 text-surface-700 border-surface-200 dark:bg-surface-900/30 dark:text-surface-300 dark:border-surface-800',
  info:    'bg-surface-50 text-surface-700 border-surface-200 dark:bg-surface-900/30 dark:text-surface-300 dark:border-surface-800',
}

export default function SecurityLogPage() {
  const [type, setType] = useState<string>('')
  const [limit, setLimit] = useState(200)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['security-log', type, limit],
    queryFn: async () => {
      const { data } = await api.get('/auth/security-log', {
        params: { type: type || undefined, limit },
      })
      return (data?.events || []) as SecurityEvent[]
    },
    refetchOnWindowFocus: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-surface-600" />
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Журнал безопасности</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Логин/выход, попытки доступа выше роли, кража refresh-токенов, действия админов
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="input w-56"
          >
            <option value="">Все события</option>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="input w-32"
          >
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <button onClick={() => refetch()} className="btn-secondary" title="Обновить">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-surface-50 dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 dark:bg-surface-900/50 text-left text-xs uppercase text-surface-500 dark:text-surface-400">
                <th className="px-4 py-3">Время</th>
                <th className="px-4 py-3">Событие</th>
                <th className="px-4 py-3">Email / User</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Детали</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-surface-400">Загрузка...</td>
                </tr>
              )}
              {!isLoading && (!data || data.length === 0) && (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-surface-400">Событий нет</td>
                </tr>
              )}
              {!isLoading && data?.map((ev) => {
                const meta = TYPE_META[ev.type] || { label: ev.type, tone: 'info' as const, icon: Shield }
                const Icon = meta.icon
                return (
                  <tr key={ev.id} className="border-t border-surface-100 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-900/40">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-surface-600 dark:text-surface-400">
                      {format(new Date(ev.createdAt), 'dd MMM HH:mm:ss', { locale: ru })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium ${TONE_CLASS[meta.tone]}`}>
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {ev.email ? (
                        <span className="font-mono text-surface-700 dark:text-surface-300">{ev.email}</span>
                      ) : ev.userId ? (
                        <span className="font-mono text-surface-500" title={ev.userId}>{ev.userId.slice(0, 8)}...</span>
                      ) : (
                        <span className="text-surface-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-surface-500">{ev.ip || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-surface-500 max-w-md truncate">
                      {ev.details ? (
                        <code className="text-[10px]">{JSON.stringify(ev.details)}</code>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
