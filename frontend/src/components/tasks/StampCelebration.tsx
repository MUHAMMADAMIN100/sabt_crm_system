import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuthStore } from '@/store/auth.store'
import {
  canCelebrateTasks, onCelebrateTask, isCelebrationSoundOn, playStampSound,
  wasCelebrated, markCelebrated,
} from '@/lib/taskCelebration'

/**
 * «Печать успеха»: на белый лист с размаху падает печать THE BEST.
 *
 * Смонтирован глобально в Layout, поэтому срабатывает на любой странице,
 * где сотрудник закрыл задачу. Всё на CSS и SVG — без библиотек анимации:
 * печать остаётся чёткой на любом экране, а текст и цвет меняются строкой.
 */

/** Сколько живёт сцена: лист → удар на 0.5с → пауза → уход. */
const HOLD_MS = 2200
const FADE_MS = 320
const IMPACT_MS = 500

export default function StampCelebration() {
  const user = useAuthStore(s => s.user)
  const [phase, setPhase] = useState<'idle' | 'show' | 'leaving'>('idle')
  const timers = useRef<number[]>([])
  /** Внутри обработчика события phase из замыкания всегда был бы 'idle'. */
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const allowed = canCelebrateTasks(user)

  useEffect(() => {
    if (!allowed) return
    const clear = () => { timers.current.forEach(window.clearTimeout); timers.current = [] }

    const off = onCelebrateTask((taskId) => {
      // Одна задача — одно поздравление: пересохранение уже закрытой задачи
      // снова присылает status = done.
      if (wasCelebrated(taskId)) return
      // Уже идёт показ (закрыли пачку задач) — второй раз не начинаем.
      // Отметку ставим ПОСЛЕ этой проверки: иначе задача, закрытая во время
      // чужой анимации, считалась бы «уже отпразднованной» навсегда, хотя
      // печати за неё никто не видел.
      if (phaseRef.current !== 'idle') return
      markCelebrated(taskId)

      clear()
      setPhase('show')
      if (isCelebrationSoundOn()) {
        timers.current.push(window.setTimeout(playStampSound, IMPACT_MS))
      }
      // Встряска экрана ровно в момент удара.
      timers.current.push(window.setTimeout(() => {
        document.querySelector('.app-shell')?.classList.add('stamp-shake')
        timers.current.push(window.setTimeout(
          () => document.querySelector('.app-shell')?.classList.remove('stamp-shake'), 340))
      }, IMPACT_MS))
      timers.current.push(window.setTimeout(() => setPhase('leaving'), HOLD_MS))
      timers.current.push(window.setTimeout(() => setPhase('idle'), HOLD_MS + FADE_MS))
    })

    return () => { off(); clear() }
  }, [allowed])

  useEffect(() => () => {
    document.querySelector('.app-shell')?.classList.remove('stamp-shake')
  }, [])

  if (!allowed || phase === 'idle') return null

  /** Клик где угодно обрывает сцену — работу блокировать нельзя. */
  const skip = () => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    document.querySelector('.app-shell')?.classList.remove('stamp-shake')
    setPhase('idle')
  }

  return createPortal(
    <div
      onClick={skip}
      // z выше всего в приложении: задачу часто закрывают прямо из боковой
      // панели (TaskDrawer, z-[9999]) — иначе печать окажется под ней и
      // сотрудник её вообще не увидит.
      className={`fixed inset-0 z-[10050] flex items-center justify-center cursor-pointer
        ${phase === 'leaving' ? 'stamp-scene-out' : 'stamp-scene-in'}`}
      // Затемнение лёгкое: сцена короткая, полный блэкаут ощущался бы
      // блокировкой интерфейса.
      style={{ background: 'rgba(9, 9, 11, 0.32)' }}
      role="presentation"
    >
      <div className="stamp-paper relative w-[300px] h-[210px] sm:w-[380px] sm:h-[264px] rounded-sm bg-white shadow-2xl">
        {/* Строки «текста» на листе — намёк на документ, без смысловой нагрузки */}
        <div className="absolute inset-x-7 top-8 space-y-2.5">
          {[100, 88, 94, 62].map((w, i) => (
            <div key={i} className="h-1.5 rounded-full bg-zinc-200" style={{ width: `${w}%` }} />
          ))}
        </div>

        {/* Печать */}
        <div className="stamp-mark absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2">
          <svg width="160" height="160" viewBox="0 0 160 160" className="sm:scale-110">
            <g fill="none" stroke="#DC2626" strokeWidth="5" opacity="0.92">
              <circle cx="80" cy="80" r="70" />
              <circle cx="80" cy="80" r="58" strokeWidth="2.5" />
            </g>
            <text
              x="80" y="72" textAnchor="middle"
              fill="#DC2626" opacity="0.92"
              fontSize="30" fontWeight="900" letterSpacing="1.5"
              fontFamily="Inter, system-ui, sans-serif"
            >THE</text>
            <text
              x="80" y="106" textAnchor="middle"
              fill="#DC2626" opacity="0.92"
              fontSize="30" fontWeight="900" letterSpacing="1.5"
              fontFamily="Inter, system-ui, sans-serif"
            >BEST</text>
            <g fill="#DC2626" opacity="0.92">
              <circle cx="80" cy="26" r="3" />
              <circle cx="80" cy="134" r="3" />
            </g>
          </svg>
        </div>
      </div>
    </div>,
    document.body,
  )
}
