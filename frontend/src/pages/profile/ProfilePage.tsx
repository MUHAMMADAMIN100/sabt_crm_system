import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { authApi, projectsApi, usersApi, notificationsApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { Avatar, ProgressBar, StatusBadge } from '@/components/ui'
import { User, Mail, Briefcase, Key, Clock, FolderKanban, CalendarDays, Camera, Bell, Globe, Check } from 'lucide-react'
import { getUserPositionLabel } from '@/lib/permissions'
import { useForm } from 'react-hook-form'
import { format, formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import TwoFactorSection from '@/components/profile/TwoFactorSection'
import ThemeEditorSection from '@/components/profile/ThemeEditorSection'
import TaskCelebrationSection from '@/components/profile/TaskCelebrationSection'
import { prepareAvatar } from '@/lib/imageCompress'

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const fetchMe = useAuthStore(s => s.fetchMe)
  const [changingPass, setChangingPass] = useState(false)
  const { register, handleSubmit, reset } = useForm()
  const { t, locale, setLocale } = useTranslation()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  // Уведомления и язык — переехали сюда с убранной верхней панели.
  const { data: allNotifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    refetchInterval: 30000,
  })
  const notifList: any[] = allNotifications ?? []
  const unreadCount = notifList.filter((n: any) => !n.isRead).length
  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread-count'] }) },
  })
  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread-count'] }) },
  })
  const onNotifClick = (n: any) => { if (!n.isRead) markReadMut.mutate(n.id); if (n.link) navigate(n.link) }
  const languages = [
    { code: 'ru', name: 'Русский' },
    { code: 'en', name: 'English' },
    { code: 'tj', name: 'Тоҷикӣ' },
  ]

  const uploadAvatarMut = useMutation({
    mutationFn: (file: File) => usersApi.uploadMyAvatar(file),
    onSuccess: () => {
      fetchMe()
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Аватар обновлён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка загрузки'),
  })

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    // Тип не проверяем по file.type: у HEIC с айфона он часто пустой,
    // а картинка при этом читается. Решает попытка сжатия ниже.
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Файл слишком большой (макс. 25 МБ)')
      return
    }
    try {
      // Жмём в браузере: фото с телефона весит мегабайты и раньше
      // отвергалось сервером — человек видел только «Ошибка загрузки».
      uploadAvatarMut.mutate(await prepareAvatar(file))
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось прочитать файл как изображение')
    }
  }

  // Refresh user profile (incl. role) on mount — admin may have changed it
  useEffect(() => { fetchMe() }, [fetchMe])

  const { data: sessions } = useQuery({
    queryKey: ['work-sessions'],
    queryFn: () => authApi.sessions(7),
  })

  const { data: allProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const myProjects = allProjects?.filter((p: any) =>
    p.members?.some((m: any) => m.id === user?.id) ||
    p.managerId === user?.id ||
    p.manager?.id === user?.id,
  ) || []

  const onChangePassword = async (data: any) => {
    if (data.newPassword !== data.confirm) { toast.error(t('auth.passwordsNotMatch')); return }
    try {
      await authApi.changePassword({ oldPassword: data.oldPassword, newPassword: data.newPassword })
      toast.success(t('auth.passwordChanged'))
      reset()
      setChangingPass(false)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || t('common.error'))
    }
  }

  // Compute today's total hours from open sessions
  const todayKey = new Date().toISOString().split('T')[0]
  const todaySessions = sessions?.filter((s: any) => s.date === todayKey) || []
  const todayHours = todaySessions.reduce((sum: number, s: any) => {
    if (s.logoutAt) return sum + Number(s.durationHours)
    // Session still open — compute live duration
    const ms = Date.now() - new Date(s.loginAt).getTime()
    return sum + ms / 3600000
  }, 0)

  /** Длительность сессии в человекочитаемом виде:
   *  < 1 мин → «< 1 мин», < 1 часа → «45 мин», без минут → «2 ч»,
   *  иначе → «2 ч 15 мин». */
  const formatDuration = (hours: number): string => {
    const totalMin = Math.round(hours * 60)
    if (totalMin < 1) return '< 1 мин'
    if (totalMin < 60) return `${totalMin} мин`
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="page-title">{t('profile.title')}</h1>

      {/* Profile Card */}
      <div className="card">
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative group rounded-full"
            title="Сменить аватар"
          >
            <Avatar name={user?.name} src={user?.avatar} size={64} zoomable={false} />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera size={20} className="text-white" />
            </span>
            {uploadAvatarMut.isPending && (
              <span className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleAvatarPick}
            className="hidden"
          />
          <div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">{user?.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="badge bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">{getUserPositionLabel(user)}</span>
              <span className={`badge ${user?.isActive ? 'status-done' : 'status-cancelled'}`}>
                {user?.isActive ? t('common.active') : t('common.inactive')}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
            <User size={16} className="text-surface-400 dark:text-surface-500 shrink-0" />
            <div>
              <p className="text-xs text-surface-400 dark:text-surface-500">{t('profile.name')}</p>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
            <Mail size={16} className="text-surface-400 dark:text-surface-500 shrink-0" />
            <div>
              <p className="text-xs text-surface-400 dark:text-surface-500">{t('profile.email')}</p>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
            <Briefcase size={16} className="text-surface-400 dark:text-surface-500 shrink-0" />
            <div>
              <p className="text-xs text-surface-400 dark:text-surface-500">Должность</p>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{getUserPositionLabel(user)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Work Sessions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-primary-600 dark:text-primary-400" />
          <h3 className="section-title">Рабочие сессии (последние 7 дней)</h3>
        </div>

        {/* Today's hours */}
        <div className="flex items-center gap-3 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-xl mb-3">
          <CalendarDays size={16} className="text-primary-600 dark:text-primary-400 shrink-0" />
          <div className="flex-1">
            <p className="text-xs text-primary-600 dark:text-primary-400">Сегодня</p>
            <p className="text-lg font-bold text-primary-700 dark:text-primary-300 tabular-nums">{formatDuration(todayHours)}</p>
          </div>
        </div>

        {/* Sessions list */}
        {sessions && sessions.length > 0 ? (
          <div className="space-y-1.5">
            {sessions.slice(0, 10).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700/50 text-sm">
                <span className="text-surface-600 dark:text-surface-300">{format(new Date(s.loginAt), 'dd.MM HH:mm')}</span>
                <span className="text-surface-400 dark:text-surface-500 text-xs">
                  {s.logoutAt ? `→ ${format(new Date(s.logoutAt), 'HH:mm')}` : '— в сети'}
                </span>
                <span className="font-medium text-surface-700 dark:text-surface-300 tabular-nums">
                  {s.logoutAt ? formatDuration(Number(s.durationHours)) : '...'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">Нет данных</p>
        )}
      </div>

      {/* My Projects */}
      {myProjects.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <FolderKanban size={16} className="text-primary-600 dark:text-primary-400" />
            <h3 className="section-title">Мои проекты</h3>
          </div>
          <div className="space-y-2">
            {myProjects.map((p: any) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: p.color || '#18181b' }}>
                  <FolderKanban size={14} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <ProgressBar value={p.progress || 0} className="w-20" />
                    <span className="text-xs text-surface-400 dark:text-surface-500">{p.progress || 0}%</span>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Уведомления — переехали с убранной верхней панели */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-primary-600 dark:text-primary-400" />
            <h3 className="section-title">Уведомления</h3>
            {unreadCount > 0 && (
              <span className="badge bg-red-500 text-white text-[10px]">{unreadCount > 99 ? '99+' : unreadCount} новых</span>
            )}
          </div>
          {unreadCount > 0 && (
            <button onClick={() => markAllReadMut.mutate()} className="text-xs text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1">
              <Check size={12} /> Прочитать все
            </button>
          )}
        </div>
        {notifList.length === 0 ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">Нет уведомлений</p>
        ) : (
          <div className="space-y-1">
            {notifList.slice(0, 8).map((n: any) => (
              <button key={n.id} onClick={() => onNotifClick(n)}
                className="w-full text-left flex items-start gap-2 p-2.5 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-primary-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm leading-snug ${n.isRead ? 'text-surface-600 dark:text-surface-300' : 'font-medium text-surface-900 dark:text-surface-100'}`}>{n.title}</p>
                  {n.message && <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 line-clamp-2">{n.message}</p>}
                  <p className="text-[10px] text-surface-400 dark:text-surface-500 mt-1">{n.createdAt ? formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ru }) : ''}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        <Link to="/notifications" className="block mt-2 text-center text-sm text-primary-600 dark:text-primary-400 hover:underline">Все уведомления →</Link>
      </div>

      {/* Язык интерфейса — переехал с убранной верхней панели */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Globe size={16} className="text-primary-600 dark:text-primary-400" />
          <h3 className="section-title">Язык интерфейса</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {languages.map(l => (
            <button key={l.code} onClick={() => setLocale(l.code as any)}
              className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${locale === l.code
                ? 'bg-primary-600 border-primary-600 text-white'
                : 'bg-surface-50 dark:bg-surface-700/50 border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:border-primary-400'}`}>
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {/* Персональная тема интерфейса (5-цветный редактор) */}
      <ThemeEditorSection />

      {/* «Печать успеха» за выполненную задачу — тоже с ролевой проверкой внутри */}
      <TaskCelebrationSection />

      {/* 2FA — двухфакторная аутентификация */}
      <TwoFactorSection />

      {/* Change Password */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{t('auth.changePassword')}</h3>
          <button onClick={() => setChangingPass(p => !p)} className="btn-secondary text-xs">
            <Key size={13} /> {t('auth.changePassword')}
          </button>
        </div>
        {changingPass && (
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3">
            <div>
              <label className="label">{t('auth.oldPassword')}</label>
              <input type="password" {...register('oldPassword', { required: true })} className="input" />
            </div>
            <div>
              <label className="label">{t('auth.newPassword')}</label>
              <input type="password" {...register('newPassword', { required: true, minLength: 8 })} className="input" minLength={8} />
            </div>
            <div>
              <label className="label">{t('auth.confirmPassword')}</label>
              <input type="password" {...register('confirm', { required: true })} className="input" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">{t('common.save')}</button>
              <button type="button" onClick={() => setChangingPass(false)} className="btn-secondary text-sm">{t('common.cancel')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
