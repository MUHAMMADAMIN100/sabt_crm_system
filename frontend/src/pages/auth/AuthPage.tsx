import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { Building2, Mail, Lock, User, Eye, EyeOff, Briefcase, Phone, Send, AtSign } from 'lucide-react'
import { Spinner } from '@/components/ui'
import toast from 'react-hot-toast'

const POSITIONS = ['SMM специалист', 'Разработчик', 'Дизайнер', 'Менеджер по продажам']

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const { login, register: doRegister } = useAuthStore()
  const { t } = useTranslation()
  const { register: reg, handleSubmit, formState: { errors }, reset } = useForm<any>()

  const onSubmit = async (data: any) => {
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(data.email, data.password)
      } else {
        await doRegister({
          name: data.name, email: data.email, password: data.password,
          position: data.position, phone: data.phone ? '+992' + data.phone.replace(/\D/g,'') : undefined,
          telegram: data.telegram, instagram: data.instagram || undefined,
        })
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || t('common.error'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 dark:from-surface-900 dark:via-surface-900 dark:to-surface-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-600 mb-4 shadow-lg">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Sabt System</h1>
        </div>

        <div className="bg-white dark:bg-surface-800 rounded-3xl shadow-modal border border-surface-100 dark:border-surface-700 p-8">
          <div className="flex gap-1 bg-surface-100 dark:bg-surface-700 rounded-xl p-1 mb-6">
            {(['login', 'register'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); reset() }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === m ? 'bg-white dark:bg-surface-600 shadow-sm text-surface-900 dark:text-surface-100' : 'text-surface-500 dark:text-surface-400'}`}>
                {m === 'login' ? t('auth.login') : t('common.create')}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            {mode === 'register' && (
              <>
                <div>
                  <label className="label">{t('profile.name')} *</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input {...reg('name', { required: 'Имя обязательно' })} placeholder={t('profile.name')} className="input pl-9" />
                  </div>
                  {errors.name && <p className="text-xs text-red-500 mt-1">{String(errors.name.message)}</p>}
                </div>
                <div>
                  <label className="label">{t('employees.position')} *</label>
                  <div className="relative">
                    <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <select {...reg('position', { required: 'Должность обязательна' })} className="input pl-9">
                      <option value="">{t('common.selectOption')}</option>
                      {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  {errors.position && <p className="text-xs text-red-500 mt-1">{String(errors.position.message)}</p>}
                </div>
                <div>
                  <label className="label">Телефон *</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-surface-500 text-sm pointer-events-none">
                      <span className="text-base">🇹🇯</span> <span className="font-medium">+992</span>
                    </div>
                    <input {...reg('phone', { required: 'Телефон обязателен', minLength: { value: 9, message: 'Минимум 9 цифр' } })}
                      placeholder="901234567" className="input pl-[100px]" maxLength={9} />
                  </div>
                  {errors.phone && <p className="text-xs text-red-500 mt-1">{String(errors.phone.message)}</p>}
                </div>
                <div>
                  <label className="label">Telegram *</label>
                  <div className="relative">
                    <Send size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input {...reg('telegram', { required: 'Telegram обязателен' })} placeholder="@username" className="input pl-9" />
                  </div>
                  {errors.telegram && <p className="text-xs text-red-500 mt-1">{String(errors.telegram.message)}</p>}
                </div>
                <div>
                  <label className="label">Instagram</label>
                  <div className="relative">
                    <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input {...reg('instagram')} placeholder="@username" className="input pl-9" />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="label">{t('auth.email')} *</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input {...reg('email', { required: 'Email обязателен', pattern: { value: /\S+@\S+\.\S+/, message: 'Введите корректный email' } })}
                  type="email" placeholder="you@company.com" className="input pl-9" />
              </div>
              {errors.email && <p className="text-xs text-red-500 mt-1">{String(errors.email.message)}</p>}
            </div>
            <div>
              <label className="label">{t('auth.password')} *</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input {...reg('password', { required: 'Пароль обязателен', minLength: { value: 4, message: 'Минимум 4 символа' } })}
                  type={showPass ? 'text' : 'password'} placeholder="••••••••" className="input pl-9 pr-10" />
                <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{String(errors.password.message)}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5 mt-2">
              {loading ? <Spinner size={16} className="text-white" /> : (mode === 'login' ? t('auth.login') : t('common.create'))}
            </button>
          </form>

          {mode === 'login' && (
            <p className="text-center text-xs text-surface-400 dark:text-surface-500 mt-4">admin@erp.com / admin123</p>
          )}
        </div>
      </div>
    </div>
  )
}
