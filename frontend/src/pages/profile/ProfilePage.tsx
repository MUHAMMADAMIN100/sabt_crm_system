import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { authApi, projectsApi, usersApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { Avatar, ProgressBar, StatusBadge } from '@/components/ui'
import { User, Mail, Briefcase, Key, Clock, FolderKanban, CalendarDays, Camera } from 'lucide-react'
import { getUserPositionLabel } from '@/lib/permissions'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import TwoFactorSection from '@/components/profile/TwoFactorSection'
import ThemeEditorSection from '@/components/profile/ThemeEditorSection'

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const fetchMe = useAuthStore(s => s.fetchMe)
  const [changingPass, setChangingPass] = useState(false)
  const { register, handleSubmit, reset } = useForm()
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

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

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Выберите файл-изображение')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Файл слишком большой (макс. 5 МБ)')
      return
    }
    uploadAvatarMut.mutate(file)
    if (fileRef.current) fileRef.current.value = ''
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
            <Avatar name={user?.name} src={user?.avatar} size={64} />
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
            accept="image/*"
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

      {/* Персональная тема интерфейса (5-цветный редактор) */}
      <ThemeEditorSection />

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
