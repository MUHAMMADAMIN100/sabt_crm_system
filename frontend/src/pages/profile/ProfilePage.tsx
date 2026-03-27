import { useState } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { authApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { Avatar } from '@/components/ui'
import { User, Mail, Shield, Key } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const [changingPass, setChangingPass] = useState(false)
  const { register, handleSubmit, reset } = useForm()
  const { t } = useTranslation()

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

  const ROLE_LABELS: Record<string, string> = { admin: 'Администратор', manager: 'Менеджер', employee: 'Сотрудник', client: 'Клиент' }

  return (
    <div className="space-y-5 max-w-xl">
      <h1 className="page-title">{t('profile.title')}</h1>

      <div className="card">
        <div className="flex items-center gap-4 mb-6">
          <Avatar name={user?.name} src={user?.avatar} size={64} />
          <div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">{user?.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="badge bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">{ROLE_LABELS[user?.role || ''] || user?.role}</span>
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
            <Shield size={16} className="text-surface-400 dark:text-surface-500 shrink-0" />
            <div>
              <p className="text-xs text-surface-400 dark:text-surface-500">{t('profile.role')}</p>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{ROLE_LABELS[user?.role || ''] || user?.role}</p>
            </div>
          </div>
        </div>
      </div>

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
              <input type="password" {...register('newPassword', { required: true, minLength: 6 })} className="input" />
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
