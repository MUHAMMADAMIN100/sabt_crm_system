import { useAuthStore } from '@/store/auth.store'

/**
 * Звук нового сообщения в «Директе». Свой у каждого браузера: включается и
 * выключается кнопкой на странице «Директ». По умолчанию звучит у менеджеров
 * продаж — они ведут переписку; у руководства по умолчанию тихо.
 */
const KEY = 'direct-sound'

export function directSoundEnabled(): boolean {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch { /* приватный режим — берём значение по роли */ }
  const role = useAuthStore.getState().user?.role
  return role === 'sales_manager_smm' || role === 'sales_manager_dev'
}

export function setDirectSound(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* не сохранится — не страшно */ }
}

let ctx: AudioContext | null = null

/** Короткий двойной сигнал. Браузер разрешает звук только после первого
 *  клика по странице — до него сигнал просто не прозвучит.
 *  assigneeId — кто ведёт чат: менеджеру звенят только его чаты и свободные
 *  (как и пуши), руководству — все. */
export function playDirectChime(conversationId?: string, assigneeId?: string | null): void {
  if (!directSoundEnabled()) return
  const user = useAuthStore.getState().user
  const top = user?.role === 'admin' || user?.role === 'founder'
  if (assigneeId && user && !top && assigneeId !== user.id) return
  // Чат открыт и вкладка на экране — человек и так видит сообщение.
  const params = new URLSearchParams(window.location.search)
  const watching = window.location.pathname === '/direct'
    && document.visibilityState === 'visible'
    && !!conversationId && params.get('c') === conversationId
  if (watching) return
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    ctx = ctx || new AudioCtx()
    if (ctx.state === 'suspended') void ctx.resume()
    const start = ctx.currentTime
    for (const [offset, freq] of [[0, 880], [0.14, 1320]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.25)
    }
  } catch { /* без звука — не беда */ }
}
