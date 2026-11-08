import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  MAX_AGE_MS,
  createCachePersister,
  isPersistableKey,
  parseSnapshot,
  restorableQueries,
  serializeSnapshot,
  type CacheStorage,
} from './persistCache'

// Кэш на устройстве (08.11.2026): на диск — только разрешённое, снимок чужого
// пользователя/другой сборки/старше суток не возвращается.

function memoryStorage() {
  let value: string | null = null
  const s: CacheStorage & { peek(): string | null; put(v: string | null): void } = {
    get: async () => value,
    set: async v => { value = v },
    clear: async () => { value = null },
    peek: () => value,
    put: v => { value = v },
  }
  return s
}

const BUILD = 'build-1'
const clients: QueryClient[] = []
function newClient() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  clients.push(c)
  return c
}
afterEach(() => { clients.splice(0).forEach(c => c.clear()); vi.useRealTimers() })

const task = {
  id: 't1', title: 'Снять рилс', status: 'new',
  assignee: { id: 'u1', name: 'Аня', password: 'hash' },
  project: {
    id: 'p1', name: 'Кафе', projectType: 'SMM', status: 'in_progress',
    budget: 5000, paidAmount: 2000, monthlyFee: 3000, smmData: { owner: 'x' },
    clientInfo: { phone: '+992' }, brief: { answers: {} }, briefShareToken: 'secret',
  },
}

describe('allow-list ключей', () => {
  it('пускает задачи, календарь СММ, сторис и уведомления', () => {
    for (const k of [
      ['my-tasks'], ['tasks-from-management'], ['tasks-assigned-by-me'], ['own-tasks'], ['tasks'],
      ['smm-calendar', '2026-11-01', '2026-11-30'], ['smm-calendar', 'smm', 'a', 'b'],
      ['smm-calendar', 'project', 'p1', 'a', 'b'], ['smm-calendar-overdue', 'a', 'b'],
      ['my-work', 'a', 'b'], ['stories', 'all', 'a', 'b'], ['stories-my-month', 'a', 'b'],
      ['stories-global', 'a', 'b'], ['stories-check', 'a', 'b'], ['project-stories', 'p', 'a', 'b'],
      ['notifications'], ['notifications-count'], ['unread-count'],
    ]) expect(isPersistableKey(k)).toBe(true)
  })

  it('не пускает деньги, зарплаты, доступы, Директ, лиды, заметки, сотрудников, проекты', () => {
    for (const k of [
      ['finance', 'transactions'], ['finref', 'accounts'], ['fin-payouts'], ['me', 'salary', '2026-11'],
      ['payroll'], ['me', 'sales-plan'], ['client-access', 'p1'], ['direct', 'list'], ['direct', 'unread'],
      ['clients'], ['clients-stats'], ['my-notes'], ['sales-pay-calendar', 'a', 'b'], ['smm-payments-mine'],
      ['smm-finance-clients'], ['employees'], ['projects'], ['projects', { status: 'in_progress' }],
      ['project', 'p1'], ['task', 't1'], [], 'my-tasks', null,
    ]) expect(isPersistableKey(k as any)).toBe(false)
  })
})

describe('serializeSnapshot', () => {
  it('берёт только успешные разрешённые запросы и вычищает деньги и секреты', async () => {
    const c = newClient()
    const now = Date.now()
    c.setQueryData(['my-tasks'], [task])
    c.setQueryData(['finance', 'overview'], { income: 1_000_000 })
    c.setQueryData(['projects'], [task.project])
    c.setQueryData(['notifications'], [{ id: 'n1', title: 'Привет' }])
    c.setQueryData(['stories', 'all', 'a', 'b'], [{ id: 's', storiesCount: 1 }], { updatedAt: now - MAX_AGE_MS - 1 })
    await c.prefetchQuery({ queryKey: ['unread-count'], queryFn: () => Promise.reject(new Error('нет сети')) })

    const raw = serializeSnapshot(c, { userId: 'u1', build: BUILD, now })!
    const snap = parseSnapshot(raw)!
    expect(snap.userId).toBe('u1')
    expect(snap.build).toBe(BUILD)
    expect(snap.queries.map(q => q.queryKey[0]).sort()).toEqual(['my-tasks', 'notifications'])

    const saved = (snap.queries.find(q => q.queryKey[0] === 'my-tasks')!.state.data as any[])[0]
    expect(saved.project).toEqual({ id: 'p1', name: 'Кафе', projectType: 'SMM', status: 'in_progress' })
    expect(saved.assignee).toEqual({ id: 'u1', name: 'Аня' })
    expect(raw).not.toContain('5000')
    expect(raw).not.toContain('secret')
    expect(raw).not.toContain('1000000')
    expect(raw).not.toContain('hash')
    // Исходные данные в памяти не тронуты.
    expect((c.getQueryData(['my-tasks']) as any[])[0].project.budget).toBe(5000)
  })

  it('слишком большой снимок — выкидывает самые тяжёлые запросы, а не всё', () => {
    const c = newClient()
    c.setQueryData(['notifications'], [{ id: 'n1' }])
    c.setQueryData(['tasks'], Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(50) })))
    const snap = parseSnapshot(serializeSnapshot(c, { userId: 'u1', build: BUILD, now: Date.now(), maxChars: 5000 }))!
    expect(snap.queries.map(q => q.queryKey[0])).toEqual(['notifications'])
  })

  it('нечего сохранять — null', () => {
    const c = newClient()
    c.setQueryData(['finance'], { a: 1 })
    expect(serializeSnapshot(c, { userId: 'u1', build: BUILD, now: Date.now() })).toBeNull()
  })
})

describe('restorableQueries', () => {
  const now = Date.now()
  const snapOf = (patch: Record<string, unknown> = {}) => {
    const c = newClient()
    c.setQueryData(['my-tasks'], [{ id: 't1' }])
    return { ...parseSnapshot(serializeSnapshot(c, { userId: 'u1', build: BUILD, now }))!, ...patch }
  }

  it('тот же пользователь, та же сборка, моложе суток — возвращает', () => {
    expect(restorableQueries(snapOf(), { userId: 'u1', build: BUILD, now: now + 1000 })).toHaveLength(1)
  })
  it('другой пользователь — null', () => {
    expect(restorableQueries(snapOf(), { userId: 'u2', build: BUILD, now })).toBeNull()
  })
  it('другая сборка — null', () => {
    expect(restorableQueries(snapOf(), { userId: 'u1', build: 'build-2', now })).toBeNull()
  })
  it('старше суток — null', () => {
    expect(restorableQueries(snapOf(), { userId: 'u1', build: BUILD, now: now + MAX_AGE_MS + 1 })).toBeNull()
  })
  it('снимок «из будущего» (часы ушли назад) — null', () => {
    expect(restorableQueries(snapOf(), { userId: 'u1', build: BUILD, now: now - 10 * 60_000 })).toBeNull()
  })
  it('битый снимок — null, а неразрешённые ключи внутри отсекаются', () => {
    expect(parseSnapshot('{oops')).toBeNull()
    expect(restorableQueries(null, { userId: 'u1', build: BUILD, now })).toBeNull()
    const s = snapOf()
    s.queries.push({ ...s.queries[0], queryKey: ['finance'], queryHash: '["finance"]' })
    expect(restorableQueries(s, { userId: 'u1', build: BUILD, now })!.map(q => q.queryKey[0])).toEqual(['my-tasks'])
  })
})

describe('createCachePersister', () => {
  async function savedBy(userId: string, storage = memoryStorage(), build = BUILD) {
    const c = newClient()
    const p = createCachePersister(c, storage, { build })
    await p.whenLoaded
    p.setUser(userId)
    c.setQueryData(['my-tasks'], [task])
    c.setQueryData(['finance'], { secret: 1 })
    p.flush()
    await p.idle()
    p.dispose()
    return storage
  }

  it('сохраняет и возвращает тому же пользователю; запрос всё равно переспросит сервер', async () => {
    const storage = await savedBy('u1')
    expect(storage.peek()).toContain('"my-tasks"')
    expect(storage.peek()).not.toContain('finance')

    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD })
    await p.whenLoaded
    p.setUser('u1')
    const data = c.getQueryData(['my-tasks']) as any[]
    expect(data[0].title).toBe('Снять рилс')
    expect(data[0].project.budget).toBeUndefined()
    expect(c.getQueryState(['my-tasks'])!.isInvalidated).toBe(true)
    expect(c.getQueryData(['finance'])).toBeUndefined()
    p.dispose()
  })

  it('пользователь известен раньше, чем дочитан снимок, — восстанавливает по окончании чтения', async () => {
    const storage = await savedBy('u1')
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD })
    p.setUser('u1')
    await p.whenLoaded
    expect(c.getQueryData(['my-tasks'])).toBeTruthy()
    p.dispose()
  })

  it('другой пользователь — ничего не показывает и стирает снимок', async () => {
    const storage = await savedBy('u1')
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD })
    await p.whenLoaded
    p.setUser('u2')
    await p.idle()
    expect(c.getQueryData(['my-tasks'])).toBeUndefined()
    expect(storage.peek()).toBeNull()
    p.dispose()
  })

  it('новая сборка — ничего не показывает и стирает снимок', async () => {
    const storage = await savedBy('u1')
    const c = newClient()
    const p = createCachePersister(c, storage, { build: 'build-2' })
    await p.whenLoaded
    p.setUser('u1')
    await p.idle()
    expect(c.getQueryData(['my-tasks'])).toBeUndefined()
    expect(storage.peek()).toBeNull()
    p.dispose()
  })

  it('снимок старше суток — не показывает', async () => {
    const storage = await savedBy('u1')
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD, now: () => Date.now() + MAX_AGE_MS + 1 })
    await p.whenLoaded
    p.setUser('u1')
    await p.idle()
    expect(c.getQueryData(['my-tasks'])).toBeUndefined()
    expect(storage.peek()).toBeNull()
    p.dispose()
  })

  it('не перетирает данные, которые уже пришли с сервера свежее', async () => {
    const storage = await savedBy('u1')
    const c = newClient()
    c.setQueryData(['my-tasks'], [{ id: 'fresh' }], { updatedAt: Date.now() + 5000 })
    const p = createCachePersister(c, storage, { build: BUILD })
    await p.whenLoaded
    p.setUser('u1')
    expect((c.getQueryData(['my-tasks']) as any[])[0].id).toBe('fresh')
    expect(c.getQueryState(['my-tasks'])!.isInvalidated).toBe(false)
    p.dispose()
  })

  it('пишет не чаще раза в throttleMs и только при входе', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD, throttleMs: 2000 })
    await p.whenLoaded
    c.setQueryData(['my-tasks'], [{ id: 'a' }])
    vi.advanceTimersByTime(5000)
    await p.idle()
    expect(storage.peek()).toBeNull() // никто не вошёл — не пишем

    p.setUser('u1')
    c.setQueryData(['my-tasks'], [{ id: 'b' }])
    c.setQueryData(['notifications'], [{ id: 'n' }])
    vi.advanceTimersByTime(1999)
    await p.idle()
    expect(storage.peek()).toBeNull()
    vi.advanceTimersByTime(1)
    await p.idle()
    expect(storage.peek()).toContain('"b"')
    expect(storage.peek()).toContain('"n"')
    p.dispose()
  })

  it('wipe стирает снимок и останавливает запись до нового входа', async () => {
    const storage = memoryStorage()
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD })
    await p.whenLoaded
    p.setUser('u1')
    c.setQueryData(['my-tasks'], [{ id: 'a' }])
    p.flush()
    await p.idle()
    expect(storage.peek()).not.toBeNull()

    p.wipe()
    c.setQueryData(['my-tasks'], [{ id: 'b' }])
    p.flush()
    await p.idle()
    expect(storage.peek()).toBeNull()
    p.dispose()
  })

  it('вход другого человека без очистки памяти — чужие данные не сохраняются', async () => {
    const storage = memoryStorage()
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD })
    await p.whenLoaded
    p.setUser('u1')
    c.setQueryData(['my-tasks'], [{ id: 'u1-task' }])
    p.flush()
    await p.idle()

    p.wipe()            // сессия кончилась, память не чистили
    p.setUser('u2')
    c.setQueryData(['notifications'], [{ id: 'n' }])
    p.flush()
    await p.idle()
    expect(storage.peek()).toBeNull()
    p.dispose()
  })

  it('после «Выйти» с очисткой памяти следующий пользователь сохраняется как обычно', async () => {
    const storage = memoryStorage()
    const c = newClient()
    const p = createCachePersister(c, storage, { build: BUILD })
    await p.whenLoaded
    p.setUser('u1')
    c.setQueryData(['my-tasks'], [{ id: 'u1-task' }])
    p.wipe()
    c.clear()
    p.setUser(null)
    p.setUser('u2')
    c.setQueryData(['my-tasks'], [{ id: 'u2-task' }])
    p.flush()
    await p.idle()
    const snap = parseSnapshot(storage.peek())!
    expect(snap.userId).toBe('u2')
    expect(storage.peek()).not.toContain('u1-task')
    p.dispose()
  })

  it('хранилище сломано — приложение работает без кэша', async () => {
    const broken: CacheStorage = {
      get: () => Promise.reject(new Error('blocked')),
      set: () => Promise.reject(new Error('quota')),
      clear: () => Promise.reject(new Error('blocked')),
    }
    const c = newClient()
    const p = createCachePersister(c, broken, { build: BUILD })
    await p.whenLoaded
    p.setUser('u1')
    c.setQueryData(['my-tasks'], [{ id: 'a' }])
    p.flush()
    await expect(p.idle()).resolves.toBeUndefined()
    expect(c.getQueryData(['my-tasks'])).toEqual([{ id: 'a' }])
    p.dispose()
  })
})
