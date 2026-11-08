/** Короткий кэш тяжёлых ответов сервера (08.11.2026, третья волна).
 *
 *  Живёт в памяти процесса (на Railway одна реплика; станет больше — каждая
 *  держит свой, сбрасывается так же). Сбрасывается ЦЕЛИКОМ при любом событии
 *  изменения: AppGateway.broadcast вызывает clearResponseCache() до рассылки,
 *  поэтому клиенты, которые сразу после события перезапрашивают данные,
 *  получают свежие, а не закэшированные до записи.
 *
 *  Одинаковые одновременные запросы ждут один расчёт. Ключ обязан включать
 *  всё, от чего зависит ответ (период, проект, роль/пользователь, если ответ
 *  зависит от прав). Финансы и зарплаты между пользователями не делить. */

type Entry = { at: number; ttl: number; value: unknown }

const MAX_ENTRIES = 300
const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
let generation = 0

export async function cachedResponse<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const gen = generation
  const p = compute()
    .then((value) => {
      // Пока считали, данные поменялись — такой ответ не кладём.
      if (gen === generation) {
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string)
        store.set(key, { at: Date.now(), ttl: ttlMs, value })
      }
      return value
    })
    .finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/** Сбросить всё: вызывается при каждом событии изменения данных. */
export function clearResponseCache() {
  generation++
  store.clear()
  inflight.clear()
}
