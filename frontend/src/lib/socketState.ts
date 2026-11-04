import { useSyncExternalStore } from 'react'

/** Подключён ли сейчас вебсокет. Пока подключён, «Директ» обновляется
 *  событиями сервера; без него страницы опрашивают сервер сами. */
let connected = false
const listeners = new Set<() => void>()

export function setSocketConnected(value: boolean): void {
  if (connected === value) return
  connected = value
  listeners.forEach(listener => listener())
}

export function isSocketConnected(): boolean {
  return connected
}

export function useSocketConnected(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => connected,
    () => connected,
  )
}
