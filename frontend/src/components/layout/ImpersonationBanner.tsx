import { useEffect, useState } from 'react'
import { Eye, LogOut, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { getRoleLabel } from '@/lib/permissions'
import { impersonationLocal } from '@/lib/api'
import { stopImpersonation } from '@/lib/impersonation'

/**
 * Полоса «Вы в кабинете сотрудника» (13.11.2026, «Войти как»).
 *
 * Показываем по ответу сервера (/auth/me → impersonator), а не по заметке в
 * браузере: что видит сервер, то и правда. Полоса не закрывается — забыть,
 * что работаешь в чужом кабинете, не должно получиться.
 */
export default function ImpersonationBanner() {
  const user = useAuthStore(s => s.user)
  const [leaving, setLeaving] = useState(false)

  // Сообщение после возврата / окончания входа — один раз.
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem('impersonation-message')
      if (msg) {
        sessionStorage.removeItem('impersonation-message')
        toast.success(msg)
      }
    } catch { /* ignore */ }
  }, [])

  // Вход начали или закончили в другой вкладке — эта вкладка должна стать
  // тем же человеком, иначе она показывала бы одно, а делала бы другое.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === impersonationLocal.key) window.location.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (!user?.impersonator) return null

  const leave = async () => {
    if (leaving) return
    setLeaving(true)
    try { await stopImpersonation('/employees') } catch { setLeaving(false) }
  }

  return (
    <div
      role="status"
      className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:px-6 bg-amber-400 text-amber-950 border-b border-amber-500/60"
    >
      <Eye size={18} className="shrink-0" aria-hidden />
      <div className="flex-1 min-w-0 text-sm leading-snug">
        <span className="font-semibold">Вы вошли как {user.name}</span>
        {user.role && <span className="opacity-80"> · {getRoleLabel(user.role)}</span>}
      </div>
      <button
        type="button"
        onClick={leave}
        disabled={leaving}
        aria-label="Вернуться в свой аккаунт"
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-950 text-amber-50 px-3 py-1.5 text-sm font-semibold hover:bg-amber-900 disabled:opacity-70 transition-colors"
      >
        {leaving ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
        {/* На телефоне коротко — иначе кнопка сжимает текст полосы в столбик. */}
        <span className="sm:hidden">Вернуться</span>
        <span className="hidden sm:inline">Вернуться в свой аккаунт</span>
      </button>
    </div>
  )
}
