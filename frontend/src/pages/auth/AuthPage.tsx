import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { Mail, Lock, User, Eye, EyeOff, Briefcase, Send, AtSign } from 'lucide-react'
import { Spinner } from '@/components/ui'
import toast from 'react-hot-toast'
import api from '@/lib/api'

const ROLES: { value: string; label: string; position: string }[] = [
  { value: 'smm_specialist',   label: 'SMM специалист',       position: 'SMM специалист' },
  { value: 'designer',         label: 'Дизайнер',             position: 'Дизайнер' },
  { value: 'targetologist',    label: 'Таргетолог',           position: 'Таргетолог' },
  { value: 'sales_manager',    label: 'Менеджер по продажам', position: 'Менеджер по продажам' },
  { value: 'project_manager',  label: 'Проект-менеджер',      position: 'Проект-менеджер' },
  { value: 'developer',        label: 'Разработчик',          position: 'Разработчик' },
  { value: 'employee',         label: 'Сотрудник',            position: 'Сотрудник' },
  { value: 'founder',          label: 'Основатель',           position: 'Основатель' },
]

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [animKey, setAnimKey] = useState(0)
  const [founderExists, setFounderExists] = useState(false)
  const { login, register: doRegister } = useAuthStore()
  const { t } = useTranslation()

  useEffect(() => {
    if (mode === 'register') {
      api.get('/users', { params: { role: 'founder' } })
        .then(r => setFounderExists((r.data?.length ?? 0) > 0))
        .catch(() => {})
    }
  }, [mode])
  const {
    register: reg,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    setError,
    clearErrors,
  } = useForm<any>()

  const switchMode = (m: 'login' | 'register') => {
    if (m === mode) return
    setMode(m)
    reset(m === 'register' ? { telegram: '@' } : {})
    clearErrors()
    setAnimKey(k => k + 1)
  }

  const onSubmit = async (data: any) => {
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(data.email, data.password)
      } else {
        const selectedRole = ROLES.find(r => r.value === data.role)
        await doRegister({
          name: data.name,
          email: data.email,
          password: data.password,
          role: data.role,
          position: selectedRole?.position || data.role || 'Сотрудник',
          phone: data.phone ? '+992' + data.phone.replace(/\D/g, '') : undefined,
          telegram: data.telegram,
          instagram: data.instagram || undefined,
        })
      }
    } catch (e: any) {
      const msg: string = e?.response?.data?.message || ''
      if (mode === 'login') {
        if (
          msg.toLowerCase().includes('invalid') ||
          msg.toLowerCase().includes('credentials') ||
          msg.toLowerCase().includes('password')
        ) {
          setError('password', { message: 'Неверный email или пароль' })
          setError('email', { message: ' ' })
        } else if (msg.toLowerCase().includes('deactivated')) {
          setError('email', { message: 'Аккаунт деактивирован администратором' })
        } else {
          setError('password', { message: 'Неверный email или пароль' })
          setError('email', { message: ' ' })
        }
      } else {
        if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('conflict')) {
          setError('email', { message: 'Этот email уже зарегистрирован' })
        } else {
          toast.error(msg || t('common.error'))
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const handleEmailBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (val && !val.includes('@')) setValue('email', val + '@gmail.com', { shouldValidate: true })
  }

  const handleTelegramChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value
    if (!val.startsWith('@')) val = '@' + val.replace(/@/g, '')
    setValue('telegram', val, { shouldValidate: true })
  }

  const handlePhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowed = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (allowed.includes(e.key)) return
    if (!/^\d$/.test(e.key)) e.preventDefault()
  }

  return (
    <div className="min-h-screen auth-page-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md auth-card-enter">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-end gap-0 leading-none select-none">
            <span
              className="font-black tracking-tight"
              style={{ fontSize: 42, color: '#6B4FCF', fontFamily: "'Arial Black', Arial, sans-serif" }}
            >
              sabt
            </span>
            <svg width="18" height="20" viewBox="0 0 12 14" fill="none" className="ml-1 mb-1.5">
              <path
                d="M1 1L1 11L3.8 8.2L5.6 12.5L7 11.9L5.2 7.6L9 7.6L1 1Z"
                fill="#6B4FCF"
                stroke="#6B4FCF"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
            </svg>
            <div className="w-3 h-3 rounded-full bg-red-500 mb-5 ml-0.5 shrink-0" />
          </div>
        </div>

        <div className="bg-white dark:bg-surface-800 rounded-3xl shadow-modal border border-surface-100 dark:border-surface-700 p-8">
          {/* Tabs */}
          <div className="flex gap-1 bg-surface-100 dark:bg-surface-700 rounded-xl p-1 mb-6">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-250 ${
                  mode === m
                    ? 'bg-white dark:bg-surface-600 shadow-sm text-surface-900 dark:text-surface-100'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                {m === 'login' ? t('auth.login') : 'Регистрация'}
              </button>
            ))}
          </div>

          {/* Form — key changes on tab switch to trigger animation */}
          <form key={animKey} onSubmit={handleSubmit(onSubmit)} className="space-y-3 auth-form-animate">
            {mode === 'register' && (
              <>
                {/* ФИО */}
                <div className="auth-field" style={{ animationDelay: '0ms' }}>
                  <label className="label">ФИО *</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      {...reg('name', { required: 'ФИО обязательно' })}
                      placeholder="Введите ФИО"
                      className={`input pl-9 ${errors.name ? 'border-red-400 focus:ring-red-400' : ''}`}
                    />
                  </div>
                  {errors.name && <p className="auth-error">{String(errors.name.message)}</p>}
                </div>

                {/* Роль */}
                <div className="auth-field" style={{ animationDelay: '50ms' }}>
                  <label className="label">Роль *</label>
                  <div className="relative">
                    <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <select
                      {...reg('role', { required: 'Роль обязательна' })}
                      className={`input pl-9 ${errors.role ? 'border-red-400 focus:ring-red-400' : ''}`}
                    >
                      <option value="">{t('common.selectOption')}</option>
                      {ROLES
                        .filter(r => !(r.value === 'founder' && founderExists))
                        .map(r => <option key={r.value} value={r.value}>{r.label}</option>)
                      }
                    </select>
                  </div>
                  {errors.role && <p className="auth-error">{String(errors.role.message)}</p>}
                </div>

                {/* Телефон */}
                <div className="auth-field" style={{ animationDelay: '100ms' }}>
                  <label className="label">Телефон *</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-surface-500 text-sm pointer-events-none">
                      <span className="text-base">🇹🇯</span>
                      <span className="font-medium">+992</span>
                    </div>
                    <input
                      {...reg('phone', {
                        required: 'Телефон обязателен',
                        minLength: { value: 9, message: 'Минимум 9 цифр' },
                      })}
                      type="tel"
                      inputMode="numeric"
                      placeholder="901234567"
                      className={`input pl-[100px] ${errors.phone ? 'border-red-400 focus:ring-red-400' : ''}`}
                      maxLength={9}
                      onKeyDown={handlePhoneKeyDown}
                    />
                  </div>
                  {errors.phone && <p className="auth-error">{String(errors.phone.message)}</p>}
                </div>

                {/* Telegram */}
                <div className="auth-field" style={{ animationDelay: '150ms' }}>
                  <label className="label">Telegram *</label>
                  <div className="relative">
                    <Send size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      {...reg('telegram', { required: 'Telegram обязателен' })}
                      onChange={handleTelegramChange}
                      placeholder="@username"
                      className={`input pl-9 ${errors.telegram ? 'border-red-400 focus:ring-red-400' : ''}`}
                    />
                  </div>
                  {errors.telegram && <p className="auth-error">{String(errors.telegram.message)}</p>}
                </div>

                {/* Instagram */}
                <div className="auth-field" style={{ animationDelay: '200ms' }}>
                  <label className="label">Instagram</label>
                  <div className="relative">
                    <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input {...reg('instagram')} placeholder="@username" className="input pl-9" />
                  </div>
                </div>
              </>
            )}

            {/* Email */}
            <div className="auth-field" style={{ animationDelay: mode === 'register' ? '250ms' : '0ms' }}>
              <label className="label">{t('auth.email')} *</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  {...reg('email', {
                    required: 'Email обязателен',
                    pattern: { value: /\S+@\S+\.\S+/, message: 'Введите корректный email' },
                  })}
                  type="email"
                  placeholder="username"
                  onBlur={handleEmailBlur}
                  className={`input pl-9 ${errors.email && String(errors.email.message ?? '').trim() ? 'border-red-400 focus:ring-red-400' : ''}`}
                />
              </div>
              {errors.email && String(errors.email.message ?? '').trim() && (
                <p className="auth-error">{String(errors.email.message)}</p>
              )}
            </div>

            {/* Пароль */}
            <div className="auth-field" style={{ animationDelay: mode === 'register' ? '300ms' : '60ms' }}>
              <label className="label">{t('auth.password')} *</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  {...reg('password', {
                    required: 'Пароль обязателен',
                    minLength: { value: 4, message: 'Минимум 4 символа' },
                  })}
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  className={`input pl-9 pr-10 ${errors.password ? 'border-red-400 focus:ring-red-400' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="auth-error">{String(errors.password.message)}</p>}
            </div>

            {/* Submit */}
            <div className="auth-field" style={{ animationDelay: mode === 'register' ? '350ms' : '120ms' }}>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full justify-center py-2.5 mt-2"
              >
                {loading ? (
                  <Spinner size={16} className="text-white" />
                ) : mode === 'login' ? (
                  t('auth.login')
                ) : (
                  'Регистрация'
                )}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  )
}
