import { useState } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { Shield, ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/lib/api'

/** Раздел «Двухфакторная аутентификация» в профиле.
 *  Поток включения:
 *   1. POST /auth/2fa/setup → { qrDataUrl, secret }
 *   2. Пользователь сканирует QR в Google Authenticator / Authy / 1Password
 *   3. Вводит 6-значный код → POST /auth/2fa/enable { code }
 *   4. С этого момента логин требует и пароль, и код.
 *  Поток выключения: ввести текущий код → POST /auth/2fa/disable. */
export default function TwoFactorSection() {
  const user = useAuthStore(s => s.user)
  const fetchMe = useAuthStore(s => s.fetchMe)
  const [step, setStep] = useState<'idle' | 'qr' | 'disabling'>('idle')
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const enabled = !!user?.twoFactorEnabled

  const startSetup = async () => {
    setLoading(true)
    try {
      const { data } = await api.post('/auth/2fa/setup')
      setQrUrl(data.qrDataUrl)
      setSecret(data.secret)
      setStep('qr')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось получить QR-код')
    } finally {
      setLoading(false)
    }
  }

  const confirmEnable = async () => {
    if (code.replace(/\D/g, '').length < 6) {
      toast.error('Введите 6-значный код из приложения')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/2fa/enable', { code: code.replace(/\D/g, '') })
      toast.success('Двухфакторная аутентификация включена ✅')
      setStep('idle')
      setCode('')
      setQrUrl(null)
      setSecret(null)
      await fetchMe()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Неверный код')
    } finally {
      setLoading(false)
    }
  }

  const startDisable = () => {
    setStep('disabling')
    setCode('')
  }

  const confirmDisable = async () => {
    if (code.replace(/\D/g, '').length < 6) {
      toast.error('Введите 6-значный код из приложения')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/2fa/disable', { code: code.replace(/\D/g, '') })
      toast.success('Двухфакторная аутентификация отключена')
      setStep('idle')
      setCode('')
      await fetchMe()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Неверный код')
    } finally {
      setLoading(false)
    }
  }

  const cancel = () => {
    setStep('idle')
    setCode('')
    setQrUrl(null)
    setSecret(null)
  }

  return (
    <div className="bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          {enabled ? (
            <ShieldCheck className="w-6 h-6 text-emerald-500 mt-0.5" />
          ) : (
            <Shield className="w-6 h-6 text-surface-400 mt-0.5" />
          )}
          <div>
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">
              Двухфакторная аутентификация
            </h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 max-w-md">
              При входе помимо пароля будет запрашиваться 6-значный код из приложения-аутентификатора (Google Authenticator, Authy, 1Password).
            </p>
            {enabled ? (
              <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-full">
                <ShieldCheck className="w-3 h-3" /> включена
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-full">
                <ShieldAlert className="w-3 h-3" /> отключена — настоятельно рекомендуем включить
              </span>
            )}
          </div>
        </div>
        <div>
          {step === 'idle' && !enabled && (
            <button onClick={startSetup} disabled={loading} className="btn-primary">
              {loading ? 'Загрузка...' : 'Включить'}
            </button>
          )}
          {step === 'idle' && enabled && (
            <button onClick={startDisable} className="btn-secondary">
              Отключить
            </button>
          )}
        </div>
      </div>

      {step === 'qr' && qrUrl && (
        <div className="mt-4 p-4 bg-surface-50 dark:bg-surface-900/50 rounded-xl border border-surface-200 dark:border-surface-700">
          <p className="text-sm text-surface-700 dark:text-surface-300 mb-3">
            1. Отсканируйте QR-код в приложении Google Authenticator / Authy / 1Password:
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img src={qrUrl} alt="QR-код 2FA" className="w-44 h-44 bg-white p-2 rounded-lg border" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-surface-500 mb-2">
                Если не удаётся отсканировать — введите вручную секрет:
              </p>
              <code className="block text-xs bg-white dark:bg-surface-800 px-2 py-1.5 rounded border break-all font-mono">
                {secret}
              </code>
              <p className="text-sm text-surface-700 dark:text-surface-300 mt-4 mb-2">
                2. Введите 6-значный код, который сгенерировало приложение:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="input flex-1 font-mono tracking-widest text-center"
                />
                <button onClick={confirmEnable} disabled={loading} className="btn-primary">
                  {loading ? '...' : 'Включить'}
                </button>
                <button onClick={cancel} disabled={loading} className="btn-secondary">
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'disabling' && (
        <div className="mt-4 p-4 bg-surface-50 dark:bg-surface-900/50 rounded-xl border border-surface-200 dark:border-surface-700">
          <p className="text-sm text-surface-700 dark:text-surface-300 mb-3">
            Введите текущий 6-значный код из приложения, чтобы подтвердить отключение:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input flex-1 font-mono tracking-widest text-center"
            />
            <button onClick={confirmDisable} disabled={loading} className="btn-danger">
              {loading ? '...' : 'Отключить 2FA'}
            </button>
            <button onClick={cancel} disabled={loading} className="btn-secondary">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
