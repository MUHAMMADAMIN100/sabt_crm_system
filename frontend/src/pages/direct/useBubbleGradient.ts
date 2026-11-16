import { useEffect, type RefObject } from 'react'

/**
 * Градиент наших пузырей «как в Instagram» (16.11.2026): цвет зависит от того,
 * где пузырь на экране ленты — вверху фиолетовый, внизу синий — и меняется при
 * прокрутке. background-attachment: fixed для этого не годится: на iPhone он
 * не работает, а сдвиг строки при свайпе (transform) его ломает. Поэтому
 * картинку градиента (класс .direct-out, высотой в три ленты) двигаем сами:
 * сначала читаем положения видимых пузырей, потом пишем — без лишних пересчётов.
 */
export function useBubbleGradient(ref: RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const feed = ref.current
    if (!feed || !enabled) return
    let raf = 0
    const paint = () => {
      raf = 0
      const box = feed.getBoundingClientRect()
      const h = Math.max(1, Math.round(box.height))
      const nodes = feed.querySelectorAll<HTMLElement>('.direct-out')
      const visible: [HTMLElement, number][] = []
      nodes.forEach(n => {
        const r = n.getBoundingClientRect()
        if (r.bottom < box.top - 80 || r.top > box.bottom + 80) return
        visible.push([n, Math.round(r.top - box.top)])
      })
      for (const [n, y] of visible) {
        n.style.backgroundSize = `100% ${h * 3}px`
        n.style.backgroundPosition = `0 ${-(y + h)}px`
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint) }
    schedule()
    feed.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(feed)
    // Новые сообщения, подгрузка ранних, картинки — пузыри сдвигаются.
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null
    mo?.observe(feed, { childList: true, subtree: true })
    const onLoad = (e: Event) => { if ((e.target as Element | null)?.tagName === 'IMG') schedule() }
    feed.addEventListener('load', onLoad, true)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      feed.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      feed.removeEventListener('load', onLoad, true)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [ref, enabled])
}
