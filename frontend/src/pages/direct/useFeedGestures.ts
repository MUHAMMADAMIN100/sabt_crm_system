import { useEffect, useRef, type RefObject } from 'react'

/** Сколько тянуть, чтобы ответить, и насколько выезжает время. */
const REPLY_AT = 56
const REVEAL_MAX = 66
const LONG_PRESS_MS = 450
const MOVE_SLOP = 8
const DOUBLE_TAP_MS = 300

export interface FeedGestureHandlers {
  /** Можно ли ответить на это сообщение цитатой (свайп вправо). */
  canReply: (messageId: string) => boolean
  onReply: (messageId: string) => void
  /** Долгое нажатие — меню сообщения; rect — где пузырь на экране. */
  onLongPress: (messageId: string, rect: DOMRect) => void
  /** Двойной тап — ❤️. */
  onDoubleTap: (messageId: string) => void
}

/**
 * Жесты ленты на телефоне, как в Instagram (13.11.2026):
 *  - сообщение вправо — ответить цитатой (иконка проявляется, на 56px — готово);
 *  - лента влево — выезжает время сообщений;
 *  - долгое нажатие — меню сообщения; двойной тап — ❤️.
 * Двигаем элементы напрямую (style), без перерисовок React — плавно на телефоне.
 * Строки сообщений: [data-mid] — сообщение, [data-swipe] — то, что тянется.
 */
export function useFeedGestures(ref: RefObject<HTMLElement>, enabled: boolean, handlers: FeedGestureHandlers): void {
  const h = useRef(handlers)
  h.current = handlers

  useEffect(() => {
    const feed = ref.current
    if (!feed || !enabled) return
    let start: { x: number; y: number } | null = null
    let mode: null | 'scroll' | 'reveal' | 'reply' | 'press' = null
    let mid: string | null = null
    let swipe: HTMLElement | null = null
    let bubble: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastTap: { mid: string; at: number } | null = null

    const swallowClick = () => {
      const stop = (e: Event) => { e.stopPropagation(); e.preventDefault() }
      feed.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => feed.removeEventListener('click', stop, { capture: true }), 600)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { start = null; return }
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      mode = null
      const row = (e.target as Element | null)?.closest?.('[data-mid]') as HTMLElement | null
      // Пузырь — только у сообщений клиента и наших (у заметок и отметок жестов нет).
      bubble = row?.querySelector('[data-bubble]') as HTMLElement | null
      const onBubble = !!bubble && bubble.contains(e.target as Node)
      mid = row?.getAttribute('data-mid') ?? null
      if (mid?.startsWith('pending:')) mid = null
      swipe = row?.querySelector('[data-swipe]') as HTMLElement | null
      clearTimeout(timer)
      if (mid && onBubble) {
        timer = setTimeout(() => {
          if (mode !== null || !mid || !bubble) return
          mode = 'press'
          swallowClick()
          h.current.onLongPress(mid, bubble.getBoundingClientRect())
        }, LONG_PRESS_MS)
      }
    }

    const onMove = (e: TouchEvent) => {
      if (!start || mode === 'press' || mode === 'scroll') return
      const t = e.touches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      if (mode === null) {
        if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return
        clearTimeout(timer)
        if (Math.abs(dy) >= Math.abs(dx)) { mode = 'scroll'; return }
        if (dx < 0) {
          mode = 'reveal'
          feed.classList.add('revealing')
        } else if (mid && swipe && h.current.canReply(mid)) {
          mode = 'reply'
          swipe.style.transition = 'none'
        } else {
          mode = 'scroll'
          return
        }
      }
      if (mode === 'reveal') {
        feed.style.setProperty('--reveal', `${Math.min(REVEAL_MAX, Math.max(0, -dx))}px`)
      } else if (mode === 'reply' && swipe) {
        const x = Math.max(0, Math.min(84, dx))
        swipe.style.transform = `translateX(${x}px)`
        swipe.style.setProperty('--pull', String(Math.min(1, x / REPLY_AT)))
        swipe.dataset.ready = x >= REPLY_AT ? '1' : ''
      }
    }

    const onEnd = () => {
      clearTimeout(timer)
      if (mode === 'reveal') {
        feed.classList.remove('revealing')
        feed.style.setProperty('--reveal', '0px')
      } else if (mode === 'reply' && swipe) {
        const ready = swipe.dataset.ready === '1'
        swipe.style.transition = 'transform 0.2s ease'
        swipe.style.transform = ''
        swipe.style.setProperty('--pull', '0')
        swipe.dataset.ready = ''
        if (ready && mid) {
          navigator.vibrate?.(10)
          h.current.onReply(mid)
        }
      } else if (mode === null && mid && bubble) {
        // Тап: второй подряд по тому же сообщению — ❤️.
        const now = Date.now()
        if (lastTap && lastTap.mid === mid && now - lastTap.at < DOUBLE_TAP_MS) {
          lastTap = null
          swallowClick()
          h.current.onDoubleTap(mid)
        } else {
          lastTap = { mid, at: now }
        }
      }
      start = null
      mode = null
    }

    feed.addEventListener('touchstart', onStart, { passive: true })
    feed.addEventListener('touchmove', onMove, { passive: true })
    feed.addEventListener('touchend', onEnd)
    feed.addEventListener('touchcancel', onEnd)
    return () => {
      clearTimeout(timer)
      feed.removeEventListener('touchstart', onStart)
      feed.removeEventListener('touchmove', onMove)
      feed.removeEventListener('touchend', onEnd)
      feed.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, enabled])
}
