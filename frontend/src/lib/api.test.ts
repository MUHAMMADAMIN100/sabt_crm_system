import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// «Постоянный вход»: tokenStore теперь пишет в localStorage (раньше — в
// sessionStorage), с фолбэком на чтение sessionStorage для плавной миграции
// со старой схемы хранения (см. frontend/src/lib/api.ts).
describe('tokenStore (постоянный вход)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('set() records access+refresh tokens in localStorage, NOT sessionStorage', async () => {
    const { tokenStore } = await import('./api')
    tokenStore.set('acc-1', 'ref-1')
    expect(localStorage.getItem('sabt-access-token')).toBe('acc-1')
    expect(localStorage.getItem('sabt-refresh-token')).toBe('ref-1')
    expect(sessionStorage.getItem('sabt-access-token')).toBeNull()
    expect(sessionStorage.getItem('sabt-refresh-token')).toBeNull()
  })

  it('getAccess()/getRefresh() read back what set() wrote', async () => {
    const { tokenStore } = await import('./api')
    tokenStore.set('acc-2', 'ref-2')
    expect(tokenStore.getAccess()).toBe('acc-2')
    expect(tokenStore.getRefresh()).toBe('ref-2')
  })

  it('set() with only accessToken does not clobber an existing refreshToken', async () => {
    const { tokenStore } = await import('./api')
    tokenStore.set('acc-1', 'ref-1')
    tokenStore.set('acc-2') // рефреш не передан
    expect(tokenStore.getAccess()).toBe('acc-2')
    expect(tokenStore.getRefresh()).toBe('ref-1') // не затёрлось
  })

  it('migration fallback: legacy tokens sitting ONLY in sessionStorage are still picked up by getAccess/getRefresh', async () => {
    sessionStorage.setItem('sabt-access-token', 'legacy-acc')
    sessionStorage.setItem('sabt-refresh-token', 'legacy-ref')
    const { tokenStore } = await import('./api')
    expect(tokenStore.getAccess()).toBe('legacy-acc')
    expect(tokenStore.getRefresh()).toBe('legacy-ref')
  })

  it('migration: reading a legacy sessionStorage token rewrites it into localStorage', async () => {
    // Смысл «постоянного входа»: у кого токен остался в sessionStorage со
    // старой схемы, тот не должен логиниться заново после перезапуска
    // браузера. Поэтому readEither() не просто читает — при первом же чтении
    // переносит найденный токен в localStorage, не дожидаясь следующего
    // tokenStore.set() (логин/refresh могут не случиться ещё долго).
    sessionStorage.setItem('sabt-access-token', 'legacy-acc')
    sessionStorage.setItem('sabt-refresh-token', 'legacy-ref')
    const { tokenStore } = await import('./api')
    expect(tokenStore.getAccess()).toBe('legacy-acc')
    expect(tokenStore.getRefresh()).toBe('legacy-ref')
    expect(localStorage.getItem('sabt-access-token')).toBe('legacy-acc')
    expect(localStorage.getItem('sabt-refresh-token')).toBe('legacy-ref')
  })

  it('migration survives a "browser restart": token stays after sessionStorage is wiped', async () => {
    // Закрытие браузера очищает sessionStorage, но не localStorage. После
    // переноса токен обязан пережить это — ради чего фича и делалась.
    sessionStorage.setItem('sabt-access-token', 'legacy-acc')
    const { tokenStore } = await import('./api')
    tokenStore.getAccess()      // первое чтение переносит токен
    sessionStorage.clear()      // «перезапуск браузера»
    expect(tokenStore.getAccess()).toBe('legacy-acc')
  })

  it('localStorage value takes priority over a stale sessionStorage value when both are present', async () => {
    sessionStorage.setItem('sabt-access-token', 'stale-session-value')
    localStorage.setItem('sabt-access-token', 'fresh-local-value')
    const { tokenStore } = await import('./api')
    expect(tokenStore.getAccess()).toBe('fresh-local-value')
  })

  it('clear() removes tokens from BOTH localStorage and sessionStorage', async () => {
    const { tokenStore } = await import('./api')
    tokenStore.set('acc-1', 'ref-1')
    sessionStorage.setItem('sabt-access-token', 'leftover-acc')
    sessionStorage.setItem('sabt-refresh-token', 'leftover-ref')
    tokenStore.clear()
    expect(localStorage.getItem('sabt-access-token')).toBeNull()
    expect(localStorage.getItem('sabt-refresh-token')).toBeNull()
    expect(sessionStorage.getItem('sabt-access-token')).toBeNull()
    expect(sessionStorage.getItem('sabt-refresh-token')).toBeNull()
  })

  it('getAccess()/getRefresh() return null when nothing is stored anywhere', async () => {
    const { tokenStore } = await import('./api')
    expect(tokenStore.getAccess()).toBeNull()
    expect(tokenStore.getRefresh()).toBeNull()
  })

  it('does not throw if localStorage access is unavailable (e.g. blocked storage)', async () => {
    const { tokenStore } = await import('./api')
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => tokenStore.getAccess()).not.toThrow()
    expect(tokenStore.getAccess()).toBeNull()
    spy.mockRestore()
  })
})

describe('markJustAuthed / isJustAuthed (грейс-окно после логина)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('isJustAuthed() is true immediately after markJustAuthed()', async () => {
    const { markJustAuthed, isJustAuthed } = await import('./api')
    markJustAuthed()
    expect(isJustAuthed()).toBe(true)
  })

  it('isJustAuthed() is false before any markJustAuthed() call', async () => {
    const { isJustAuthed } = await import('./api')
    expect(isJustAuthed()).toBe(false)
  })

  it('isJustAuthed() expires after the grace window elapses', async () => {
    vi.useFakeTimers()
    const { markJustAuthed, isJustAuthed } = await import('./api')
    markJustAuthed(1000)
    expect(isJustAuthed()).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(isJustAuthed()).toBe(false)
    vi.useRealTimers()
  })
})
