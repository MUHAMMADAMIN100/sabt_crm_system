import { useEffect, useState } from 'react'

/**
 * Узкий экран — телефон и планшет в портрете.
 *
 * Нужен там, где на телефоне рисуется другая разметка, а не другие стили:
 * таблицу в карточки можно свернуть правилами CSS, а вот матрицу
 * «строка × месяцы» — нет, ей нужен свой вид (полоска месяцев, ближайший
 * платёж, раскрывающийся список). Для чисто оформительских различий
 * по-прежнему хватает медиазапроса.
 */
export default function useNarrow(max = 720): boolean {
  const query = `(max-width: ${max}px)`
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return narrow
}
