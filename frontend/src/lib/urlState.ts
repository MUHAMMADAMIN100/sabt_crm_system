// Состояние страницы в адресе (08.11.2026, вторая волна «Назад»): вкладка,
// месяц, неделя, вид, фильтры, поиск. Пишем с заменой шага (replace), то есть
// шагов «Назад» не прибавляется, но при возврате на страницу всё как было.
// Значение по умолчанию в адрес не пишем — ссылки остаются короткими.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Строковое значение в адресе (?key=value). allowed — допустимые значения:
 *  чужое значение из старой ссылки превращается в значение по умолчанию. */
export function useUrlState<T extends string>(key: string, def: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : def) as T
  const set = useCallback((v: T) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      if (v === def || v === '' || v == null) p.delete(key); else p.set(key, v)
      return p
    }, { replace: true })
  }, [key, def, setParams])
  return [value, set]
}

/** Целое число в адресе (смещение недели, страница списка). */
export function useUrlNumber(key: string, def: number): [number, (v: number) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const n = raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : def
  const set = useCallback((v: number) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      if (!Number.isFinite(v) || v === def) p.delete(key); else p.set(key, String(Math.trunc(v)))
      return p
    }, { replace: true })
  }, [key, def, setParams])
  return [n, set]
}

/** Флажок в адресе (?key=1). */
export function useUrlFlag(key: string): [boolean, (v: boolean) => void] {
  const [params, setParams] = useSearchParams()
  const on = params.get(key) === '1'
  const set = useCallback((v: boolean) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      if (v) p.set(key, '1'); else p.delete(key)
      return p
    }, { replace: true })
  }, [key, setParams])
  return [on, set]
}

/** Поменять несколько ключей адреса одним шагом (например, фильтр и сброс
 *  страницы списка). Два отдельных setSearchParams подряд затирают друг
 *  друга — второй не видит изменений первого. null/'' — убрать ключ. */
export function usePatchUrl(): (patch: Record<string, string | number | null | undefined>) => void {
  const [, setParams] = useSearchParams()
  return useCallback((patch) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') p.delete(k); else p.set(k, String(v))
      }
      return p
    }, { replace: true })
  }, [setParams])
}
