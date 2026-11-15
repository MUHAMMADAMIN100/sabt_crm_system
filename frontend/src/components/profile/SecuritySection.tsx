import { useId, useState } from 'react'
import toast from 'react-hot-toast'
import { Eye, EyeOff, KeyRound, Send } from 'lucide-react'
import { authApi, telegramApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

/**
 * «Сменить пароль» в профиле (15.11.2026). Раньше authApi.changePassword
 * был, а формы — нет: пароль менял только администратор сбросом.
 * Сервер (PATCH /auth/change-password, ChangePasswordDto) ждёт текущий и
 * новый пароль, новый — от 8 до 128 символов. После смены он отзывает ВСЕ
 * сессии, в том числе эту, поэтому сразу выходим и просим войти заново.
 */
export function ChangePasswordSection() {
  const logout = useAuthStore(s => s.logout)
  const id = useId()
  const [open, setOpen] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clear = () => {
    setOldPassword(''); setNewPassword(''); setConfirm(''); setError(null); setShow(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!oldPassword) { setError('Введите текущий пароль'); return }
    if (newPassword.length < 8) { setError('Новый пароль — минимум 8 символов'); return }
    if (newPassword.length > 128) { setError('Новый пароль — не длиннее 128 символов'); return }
    if (newPassword === oldPassword) { setError('Новый пароль совпадает с текущим'); return }
    if (newPassword !== confirm) { setError('Пароли не совпадают'); return }
    setLoading(true)
    try {
      await authApi.changePassword({ oldPassword, newPassword })
      // Сессия уже недействительна — выходим, на экране входа будет подсказка.
      try { sessionStorage.setItem('session-message', 'Пароль изменён. Войдите с новым паролем.') } catch { /* ignore */ }
      toast.success('Пароль изменён')
      clear()
      await logout()
    } catch (err: any) {
      const msg = err?.response?.data?.message
      // Неверный текущий пароль сервер отдаёт как 401 «Wrong current password»
      // (lib/api.ts пропускает его форме, не выкидывая из системы).
      if (err?.response?.status === 401 || /wrong current password/i.test(String(msg || ''))) {
        setError('Текущий пароль введён неверно')
      } else {
        setError(typeof msg === 'string' && msg ? msg : 'Не удалось сменить пароль. Попробуйте ещё раз.')
      }
    } finally {
      setLoading(false)
    }
  }

  const type = show ? 'text' : 'password'

  return (
    <div className="card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <KeyRound className="w-6 h-6 text-surface-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">Пароль</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 max-w-md">
              После смены пароля все входы — и на этом устройстве — закроются, войдите заново с новым паролем.
            </p>
          </div>
        </div>
        {!open && (
          <button type="button" onClick={() => { clear(); setOpen(true) }} className="btn-secondary shrink-0">
            Сменить пароль
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3 max-w-md" noValidate>
          <div>
            <label className="label" htmlFor={`${id}-old`}>Текущий пароль</label>
            <input id={`${id}-old`} type={type} autoComplete="current-password" className="input"
              value={oldPassword} onChange={e => setOldPassword(e.target.value)} maxLength={128} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-new`}>Новый пароль</label>
            <input id={`${id}-new`} type={type} autoComplete="new-password" className="input"
              value={newPassword} onChange={e => setNewPassword(e.target.value)} maxLength={128}
              aria-describedby={`${id}-hint`} />
            <p id={`${id}-hint`} className="text-[11px] text-surface-400 mt-1">Минимум 8 символов</p>
          </div>
          <div>
            <label className="label" htmlFor={`${id}-confirm`}>Повторите новый пароль</label>
            <input id={`${id}-confirm`} type={type} autoComplete="new-password" className="input"
              value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={128} />
          </div>
          <button type="button" onClick={() => setShow(v => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
            {show ? 'Скрыть пароли' : 'Показать пароли'}
          </button>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Сохраняю…' : 'Сменить пароль'}
            </button>
            <button type="button" disabled={loading} onClick={() => { clear(); setOpen(false) }} className="btn-secondary">
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/** Ссылка от сервера — только на Telegram, другие адреса не открываем. */
const TELEGRAM_URL = /^(https:\/\/(t|telegram)\.me\/|tg:\/\/)/i

/**
 * «Привязать Telegram» (15.11.2026). POST /api/telegram/link-code отдаёт
 * одноразовую ссылку на бота ({ url, expiresAt }); в Telegram человек
 * нажимает «Start», и бот начинает присылать ему уведомления CRM.
 */
export function TelegramLinkSection() {
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)

  const start = async () => {
    // Вкладку открываем сразу по нажатию: открытую после ответа сервера
    // браузер счёл бы всплывающим окном и заблокировал.
    let tab: Window | null = null
    try { tab = window.open('', '_blank') } catch { tab = null }
    setLoading(true)
    try {
      const data = await telegramApi.linkCode()
      if (!data?.url || !TELEGRAM_URL.test(data.url)) throw new Error('bad-url')
      setLink(data)
      if (tab) {
        try { tab.opener = null } catch { /* ignore */ }
        tab.location.href = data.url
      }
    } catch (e: any) {
      try { tab?.close() } catch { /* ignore */ }
      const msg = e?.response?.data?.message
      toast.error(typeof msg === 'string' && msg ? msg : 'Не удалось получить ссылку на Telegram')
    } finally {
      setLoading(false)
    }
  }

  const until = link?.expiresAt ? new Date(link.expiresAt) : null
  const untilText = until && !isNaN(until.getTime())
    ? until.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Send className="w-6 h-6 text-surface-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">Telegram</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 max-w-md">
              Уведомления CRM — задачи, сроки, ответы — будут приходить в Telegram. Откроется бот: нажмите в нём «Start».
            </p>
          </div>
        </div>
        <button type="button" onClick={start} disabled={loading} className="btn-secondary shrink-0">
          {loading ? 'Загрузка…' : 'Привязать Telegram'}
        </button>
      </div>
      {link && (
        <p className="mt-3 text-xs text-surface-500 dark:text-surface-400">
          Telegram не открылся?{' '}
          <a href={link.url} target="_blank" rel="noopener noreferrer"
            className="font-medium text-primary-600 dark:text-primary-400 hover:underline">
            Открыть бота
          </a>
          {untilText && <> — ссылка действует до {untilText}.</>}
        </p>
      )}
    </div>
  )
}
