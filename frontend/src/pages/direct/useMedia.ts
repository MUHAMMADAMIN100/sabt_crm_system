import { useEffect, useState } from 'react'

/** Совпадает ли медиа-запрос (ширина экрана) — и следит за изменением. */
export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return matches
}
