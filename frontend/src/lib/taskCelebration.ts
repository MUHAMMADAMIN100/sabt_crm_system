/**
 * «Печать успеха» — награда за выполненную задачу.
 *
 * Статус задачи меняется из шести мест (карточка, боковая панель, календарь,
 * страница проекта, задачи от руководителя, массовое действие). Вешать
 * анимацию на каждое — гарантированно где-то забыть, поэтому событие шлётся
 * из одной точки: api.service, сразу после успешного ответа сервера.
 */

const EVENT = 'task-celebration'

/** Кому показываем. По требованию владельца — проект-менеджер разработки. */
export const CELEBRATION_ROLES = ['pm_dev']

export const canCelebrateTasks = (
  user?: { role?: string | null; secondaryRole?: string | null } | null,
): boolean =>
  !!user && (CELEBRATION_ROLES.includes(user.role || '')
    || CELEBRATION_ROLES.includes(user.secondaryRole || ''))

/** Звук по умолчанию выключен: в открытом офисе внезапный удар штампа на
 *  весь кабинет — сомнительное удовольствие. Настройка на устройство. */
const SOUND_KEY = 'task-celebration-sound'

export const isCelebrationSoundOn = (): boolean => {
  try { return localStorage.getItem(SOUND_KEY) === 'on' } catch { return false }
}

export const setCelebrationSoundOn = (on: boolean): void => {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* приватный режим */ }
}

/** Задачи, за которые уже поздравили. Список в sessionStorage, а не в памяти
 *  компонента: иначе после F5 правка уже закрытой задачи (форма снова шлёт
 *  status = done) давала бы вторую печать за ту же работу. Живёт до закрытия
 *  вкладки — на новый рабочий день счётчик обнуляется сам. */
const SEEN_KEY = 'task-celebration-seen'
const SEEN_LIMIT = 200

export function wasCelebrated(taskId: string): boolean {
  if (!taskId) return false
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    return !!raw && (JSON.parse(raw) as string[]).includes(taskId)
  } catch { return false }
}

export function markCelebrated(taskId: string): void {
  if (!taskId) return
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    const list: string[] = raw ? JSON.parse(raw) : []
    if (list.includes(taskId)) return
    list.push(taskId)
    // Держим хвост: за смену закрывают десятки задач, копить всё незачем.
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_LIMIT)))
  } catch { /* приватный режим — обойдёмся защитой в памяти */ }
}

/** taskId нужен, чтобы не поздравлять дважды за одну и ту же задачу:
 *  пересохранение уже закрытой задачи снова присылает status = done. */
export function celebrateTask(taskId: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { taskId } }))
}

export function onCelebrateTask(cb: (taskId: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail?.taskId || '')
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** Удар штампа синтезируем через WebAudio — не тащим в сборку звуковой файл
 *  ради полусекунды. Низкий «бух» плюс короткий щелчок бумаги. */
export function playStampSound(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime

    // Тело удара: быстро падающий тон.
    const thump = ctx.createOscillator()
    const thumpGain = ctx.createGain()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(160, now)
    thump.frequency.exponentialRampToValueAtTime(45, now + 0.14)
    thumpGain.gain.setValueAtTime(0.35, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
    thump.connect(thumpGain).connect(ctx.destination)
    thump.start(now)
    thump.stop(now + 0.24)

    // Щелчок бумаги: короткий шум сверху.
    const noise = ctx.createBufferSource()
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    noise.buffer = buf
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.12, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
    noise.connect(noiseGain).connect(ctx.destination)
    noise.start(now)

    // Контекст живёт только на время звука — иначе вкладка копит их пачками.
    window.setTimeout(() => ctx.close().catch(() => { /* уже закрыт */ }), 600)
  } catch {
    // Звук — украшение. Браузер запретил автоплей или нет WebAudio — молчим.
  }
}
