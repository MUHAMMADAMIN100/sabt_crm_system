import { dehydrate, hydrate } from '@tanstack/react-query'
import type { DehydratedState, Query, QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Кэш данных на устройстве между запусками (08.11.2026).
 *
 * Зачем: на телефоне CRM каждый запуск начиналась с нуля — /auth/me, потом
 * код страницы, потом все данные по сети. Теперь последние задачи, умный
 * календарь СММ, сторис и уведомления лежат в IndexedDB и показываются
 * сразу, а сервер переспрашивается в фоне.
 *
 * Правила (решение владельца):
 *  - сохраняем ТОЛЬКО безопасное — по списку разрешённых ключей (PERSIST_KEYS),
 *    а не «всё, кроме»: новый раздел с деньгами не уедет на диск случайно;
 *  - снимок привязан к пользователю и к сборке, живёт не дольше суток;
 *  - «Выйти», протухшая сессия или вход другого человека — снимок стирается;
 *  - если IndexedDB нет или она сломана (приватный режим) — молча работаем
 *    как раньше, без кэша.
 */

// ── Что можно сохранять ──────────────────────────────────────────────────

/** Первые элементы ключей запросов, которые можно класть на диск.
 *  Каждый проверен по ответу сервера: денег, паролей и переписки в них нет
 *  (вложенный проект в задачах и сторис урезается — см. scrub ниже). */
export const PERSIST_KEYS: ReadonlySet<string> = new Set([
  // Задачи
  'my-tasks', 'own-tasks', 'tasks', 'tasks-from-management', 'tasks-assigned-by-me',
  // Умный календарь СММ и кабинеты производства/продюсера
  'smm-calendar', 'smm-calendar-overdue', 'my-work', 'my-work-overdue', 'producer-shoots',
  // Сторис
  'stories', 'stories-my-month', 'stories-today', 'stories-month', 'stories-global',
  'stories-all', 'stories-check', 'stories-check-day', 'project-stories', 'employee-stories',
  // Уведомления
  'notifications', 'notifications-count', 'unread-count',
])

/** Поля, которые не пишем на диск никогда — даже если сервер однажды начнёт
 *  отдавать их внутри разрешённых ответов. Страховка поверх списка ключей. */
const DROP_FIELDS: ReadonlySet<string> = new Set([
  'password', 'passwordHash', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires',
  'fcmTokens', 'refreshToken', 'accessToken', 'clientAccess', 'briefShareToken',
  'salary', 'baseSalary',
  // Деньги проекта
  'budget', 'paidAmount', 'monthlyFee', 'totalContractValue', 'outstandingAmount',
  'internalCostEstimate', 'marginEstimate', 'tariffPriceSnapshot', 'tariffLimitOveruseCost',
  'customTariff', 'discount',
])

/** Вложенный проект: в задачах «от руководителя»/«я выдал»/общем списке и в
 *  сторис сервер отдаёт строку проекта целиком — с суммой договора, оплатой,
 *  брифом и профилем клиента. Экраны берут оттуда только имя и тип. */
const PROJECT_FIELDS = ['id', 'name', 'projectType', 'status', 'isArchived'] as const

export const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** ~3 МБ текста. Больше — выкидываем самые тяжёлые запросы, а не весь снимок. */
export const MAX_CHARS = 3_000_000
export const WRITE_THROTTLE_MS = 2000
const SCHEMA = 1

/** Метка сборки (vite define). В тестах её нет — подставляем 'dev'. */
export const BUILD_ID: string = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

export function isPersistableKey(key: QueryKey | unknown): boolean {
  return Array.isArray(key) && typeof key[0] === 'string' && PERSIST_KEYS.has(key[0])
}

function shouldPersistQuery(q: Query, now: number): boolean {
  return q.state.status === 'success'
    && q.state.data !== undefined
    && isPersistableKey(q.queryKey)
    && now - q.state.dataUpdatedAt < MAX_AGE_MS
}

function scrub(key: string, value: unknown): unknown {
  if (key && DROP_FIELDS.has(key)) return undefined
  if (key === 'project' && value && typeof value === 'object' && !Array.isArray(value)) {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const f of PROJECT_FIELDS) if (src[f] !== undefined) out[f] = src[f]
    return out
  }
  return value
}

/** JSON данных по ссылке на объект: при записи раз в пару секунд не
 *  пересериализуем запросы, которые не менялись (на телефоне это заметно). */
const dataJsonCache = new WeakMap<object, string>()
function dataToJson(data: unknown): string | undefined {
  const isObj = !!data && typeof data === 'object'
  if (isObj) {
    const hit = dataJsonCache.get(data as object)
    if (hit !== undefined) return hit
  }
  const json = JSON.stringify(data, scrub)
  if (isObj && json !== undefined) dataJsonCache.set(data as object, json)
  return json
}

type DehydratedQuery = DehydratedState['queries'][number]

export interface Snapshot {
  v: number
  userId: string
  build: string
  savedAt: number
  queries: DehydratedQuery[]
}

/** Снимок кэша в строку. null — сохранять нечего. */
export function serializeSnapshot(
  client: QueryClient,
  o: { userId: string; build: string; now: number; maxChars?: number },
): string | null {
  const maxChars = o.maxChars ?? MAX_CHARS
  const { queries } = dehydrate(client, { shouldDehydrateQuery: q => shouldPersistQuery(q, o.now) })
  let parts: string[] = []
  for (const q of queries) {
    try {
      const json = dataToJson(q.state.data)
      if (json === undefined) continue
      // Ошибки и «идёт загрузка» на диск не несём: восстановленный запрос
      // должен выглядеть просто как успешно загруженный.
      const { data: _d, ...rest } = q.state
      const state = { ...rest, fetchStatus: 'idle', error: null, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null }
      const head = JSON.stringify({
        queryKey: q.queryKey, queryHash: q.queryHash, dehydratedAt: (q as any).dehydratedAt ?? o.now, state,
      })
      // head кончается на '}}' (state и весь объект) — вставляем data внутрь state.
      parts.push(`${head.slice(0, -2)},"data":${json}}}`)
    } catch { /* несериализуемое — просто не сохраняем этот запрос */ }
  }
  let total = parts.reduce((n, s) => n + s.length + 1, 0)
  if (total > maxChars) {
    parts = parts.sort((a, b) => a.length - b.length)
    while (parts.length && total > maxChars) total -= parts.pop()!.length + 1
  }
  if (!parts.length) return null
  const head = JSON.stringify({ v: SCHEMA, userId: o.userId, build: o.build, savedAt: o.now })
  return `${head.slice(0, -1)},"queries":[${parts.join(',')}]}`
}

export function parseSnapshot(raw: unknown): Snapshot | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const s = JSON.parse(raw)
    return s && typeof s === 'object' && Array.isArray(s.queries) ? (s as Snapshot) : null
  } catch { return null }
}

/** Что из снимка можно вернуть этому пользователю в этой сборке.
 *  null — снимок чужой/устаревший/битый, его надо стереть. */
export function restorableQueries(
  snap: Snapshot | null,
  o: { userId: string; build: string; now: number },
): DehydratedQuery[] | null {
  if (!snap || snap.v !== SCHEMA) return null
  if (typeof snap.userId !== 'string' || snap.userId !== o.userId) return null
  if (snap.build !== o.build) return null
  const age = o.now - Number(snap.savedAt)
  // Часы телефона могли уйти назад — снимок «из будущего» тоже не берём.
  if (!(age > -60_000 && age < MAX_AGE_MS)) return null
  return snap.queries.filter(q => !!q
    && Array.isArray(q.queryKey) && typeof q.queryHash === 'string'
    && isPersistableKey(q.queryKey)
    && !!q.state && q.state.status === 'success' && q.state.data !== undefined
    && o.now - Number(q.state.dataUpdatedAt) < MAX_AGE_MS)
}

// ── Хранилище ────────────────────────────────────────────────────────────

export interface CacheStorage {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'sabt-cache'
const DB_STORE = 'kv'
const DB_KEY = 'react-query'

let dbPromise: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    let settled = false
    const finish = (db: IDBDatabase | null) => { if (!settled) { settled = true; resolve(db) } }
    // Открытие иногда виснет (старый Safari, приватный режим) — дольше 3 с не
    // ждём; следующая операция попробует открыть заново.
    const timer = setTimeout(() => { dbPromise = null; finish(null) }, 3000)
    try {
      const idb = typeof indexedDB !== 'undefined' ? indexedDB : null
      if (!idb) { clearTimeout(timer); finish(null); return }
      const req = idb.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        try { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE) } catch { /* ignore */ }
      }
      req.onsuccess = () => {
        clearTimeout(timer)
        const db = req.result
        if (settled) { try { db.close() } catch { /* ignore */ } return }
        db.onversionchange = () => { try { db.close() } catch { /* ignore */ } dbPromise = null }
        finish(db)
      }
      req.onerror = () => { clearTimeout(timer); finish(null) }
    } catch { clearTimeout(timer); finish(null) }
  })
  return dbPromise
}

function idbOp<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>(resolve => {
    if (!db) { resolve(null); return }
    try {
      const tx = db.transaction(DB_STORE, mode)
      const req = run(tx.objectStore(DB_STORE))
      tx.oncomplete = () => resolve(req ? (req.result as T) : null)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      // Safari умеет терять соединение, пока приложение в фоне, — в
      // следующий раз откроем заново.
      dbPromise = null
      resolve(null)
    }
  })).catch(() => null)
}

export const idbStorage: CacheStorage = {
  get: () => idbOp<unknown>('readonly', s => s.get(DB_KEY)).then(v => (typeof v === 'string' ? v : null)),
  set: value => idbOp('readwrite', s => { s.put(value, DB_KEY) }).then(() => undefined),
  clear: () => idbOp('readwrite', s => { s.delete(DB_KEY) }).then(() => undefined),
}

// ── Связка с QueryClient ────────────────────────────────────────────────

export interface PersisterOptions {
  build?: string
  now?: () => number
  throttleMs?: number
  maxChars?: number
}

export function createCachePersister(client: QueryClient, storage: CacheStorage, opts: PersisterOptions = {}) {
  const build = opts.build ?? BUILD_ID
  const now = opts.now ?? Date.now
  const throttleMs = opts.throttleMs ?? WRITE_THROTTLE_MS

  let userId: string | null = null
  /** Чьи данные могут лежать в памяти — для защиты при смене человека. */
  let lastUserId: string | null = null
  /** В памяти остались данные прошлого пользователя — до перезагрузки не пишем. */
  let frozen = false
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Растёт при каждой очистке: опоздавшие чтение/запись отбрасываются. */
  let gen = 0
  /** undefined — снимок ещё читается; null — читать нечего. */
  let loaded: Snapshot | null | undefined
  let restoredFor: string | null = null
  // Все операции с хранилищем строго по очереди: запись не обгонит очистку.
  let chain: Promise<unknown> = Promise.resolve()
  const enqueue = (op: () => Promise<unknown> | void) => {
    chain = chain.then(op).catch(() => {})
    return chain
  }

  const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null } }

  function tryRestore() {
    const uid = userId
    if (!uid || loaded === undefined || restoredFor === uid) return
    restoredFor = uid
    const snap = loaded
    loaded = null
    if (!snap) return
    const queries = restorableQueries(snap, { userId: uid, build, now: now() })
    if (!queries) { wipeStorage(); return }
    if (!queries.length) return
    try {
      // hydrate не трогает запрос, если в памяти уже есть данные новее.
      hydrate(client, { queries, mutations: [] })
      // Показываем сразу, но при первом показе всё равно спрашиваем сервер:
      // пока приложение было закрыто, сокет молчал и изменения не доходили.
      const restored = new Map(queries.map(q => [q.queryHash, q.state.dataUpdatedAt] as const))
      void client.invalidateQueries({
        predicate: q => restored.get(q.queryHash) === q.state.dataUpdatedAt,
        refetchType: 'none',
      })
    } catch { /* битый снимок — работаем без него */ }
  }

  // Читаем снимок сразу при старте — пока идёт /auth/me, он уже в памяти.
  const loadGen = gen
  const whenLoaded = enqueue(async () => {
    const raw = await storage.get()
    if (gen === loadGen) loaded = parseSnapshot(raw)
  }).then(() => {
    if (loaded === undefined) loaded = null
    tryRestore()
  })

  function wipeStorage() {
    gen += 1
    loaded = null
    cancelTimer()
    dirty = false
    void enqueue(() => storage.clear())
  }

  function write(uid: string) {
    const myGen = gen
    return enqueue(async () => {
      if (gen !== myGen || userId !== uid || frozen) return
      const payload = serializeSnapshot(client, { userId: uid, build, now: now(), maxChars: opts.maxChars })
      if (payload) await storage.set(payload)
      else await storage.clear()
    })
  }

  /** force — по уходу со страницы: пишем, даже если идут изменения. */
  function flush(force = true) {
    cancelTimer()
    if (!dirty) return
    const uid = userId
    if (!uid || frozen) { dirty = false; return }
    // Посреди сохранения на экране «черновые» данные (временные id) —
    // подождём, пока запрос дойдёт до сервера.
    if (!force && client.isMutating() > 0) { schedule(); return }
    dirty = false
    void write(uid)
  }

  function schedule() {
    dirty = true
    if (!timer) timer = setTimeout(() => { timer = null; flush(false) }, throttleMs)
  }

  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (!userId || frozen || !isPersistableKey(event.query.queryKey)) return
    if ((event.type === 'updated' && event.action.type === 'success') || event.type === 'removed') schedule()
  })

  return {
    /** Кто сейчас вошёл (id из /auth/me) или null. */
    setUser(id: string | null) {
      if (id === userId) return
      userId = id
      if (!id) { cancelTimer(); dirty = false; return }
      if (lastUserId && lastUserId !== id) {
        // Вошёл другой человек. Его снимка на диске быть не должно, а если
        // память не очищалась (сессия протухла без «Выйти») — в ней чужие
        // данные, и сохранять их под новым именем нельзя.
        wipeStorage()
        if (client.getQueryCache().getAll().some(q => isPersistableKey(q.queryKey))) frozen = true
      }
      lastUserId = id
      tryRestore()
    },
    /** «Выйти» / сессия кончилась: стереть снимок и не писать до нового входа. */
    wipe() {
      userId = null
      wipeStorage()
    },
    flush,
    whenLoaded,
    /** Дождаться всех операций с хранилищем (для тестов). */
    idle: () => chain.then(() => undefined),
    dispose() { cancelTimer(); unsubscribe() },
  }
}

// ── Единственный экземпляр приложения ───────────────────────────────────

let active: ReturnType<typeof createCachePersister> | null = null

/** Запуск из main.tsx — как можно раньше, чтобы чтение шло параллельно /auth/me. */
export function startPersistedCache(client: QueryClient): void {
  if (active || typeof window === 'undefined') return
  try {
    active = createCachePersister(client, idbStorage)
    const flushNow = () => { try { active?.flush(true) } catch { /* ignore */ } }
    // Телефон сворачивает/закрывает приложение — успеваем записать последнее.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow()
    })
    window.addEventListener('pagehide', flushNow)
  } catch { active = null }
}

export function setPersistedCacheUser(id: string | null): void {
  try { active?.setUser(id) } catch { /* ignore */ }
}

export function wipePersistedCache(): void {
  try {
    if (active) active.wipe()
    else void idbStorage.clear()
  } catch { /* ignore */ }
}
