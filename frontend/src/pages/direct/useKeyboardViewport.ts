import { useEffect } from 'react'

/**
 * Клавиатура телефона (13.11.2026). iPhone при открытой клавиатуре не
 * уменьшает страницу, а прокручивает её — шапка чата уезжала вверх, лента
 * прыгала. Здесь «Директ» берёт высоту видимой части экрана (visualViewport):
 * поле ответа стоит прямо над клавиатурой, шапка — на месте. Пока страницу
 * увеличили пальцами (scale > 1), не вмешиваемся.
 */
export function useKeyboardViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const apply = () => {
      if (vv.scale > 1.01) {
        root.style.removeProperty('--direct-vh')
        return
      }
      root.style.setProperty('--direct-vh', `${Math.round(vv.height)}px`)
      // iPhone прокручивает документ к полю — возвращаем: прокручивается лента, не страница.
      if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0) window.scrollTo(0, 0)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      root.style.removeProperty('--direct-vh')
    }
  }, [])
}
