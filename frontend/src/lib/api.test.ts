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

// Подсказка на экране входа после окончательного 401 (15.11.2026): сервер
// пишет «Пароль был изменён — войдите заново» по-русски, а проверка искала
// только английское «password» — человек видел «обычное истечение».
describe('sessionEndNotice — причина выхода', () => {
  beforeEach(() => { vi.resetModules() })

  it('русское «Пароль был изменён» — подсказка про смену пароля', async () => {
    const { sessionEndNotice } = await import('./api')
    expect(sessionEndNotice('Пароль был изменён — войдите заново')).toEqual({
      key: 'session-message',
      text: 'Пароль был изменён или выполнен вход на другом устройстве. Войдите заново.',
    })
  })

  it('английские причины по-прежнему распознаются', async () => {
    const { sessionEndNotice } = await import('./api')
    expect(sessionEndNotice('Refresh token reused — session revoked').text).toMatch(/Пароль был изменён/)
    expect(sessionEndNotice('Unauthorized').text).toBe('Войдите заново, чтобы продолжить работу.')
  })

  it('блокировка — отдельное сообщение без префикса BLOCKED:', async () => {
    const { sessionEndNotice } = await import('./api')
    expect(sessionEndNotice('BLOCKED: Вас заблокировал администратор')).toEqual({
      key: 'blocked-message', text: 'Вас заблокировал администратор',
    })
  })
})

// Неверный текущий пароль при смене пароля сервер отдаёт как 401. Это ответ
// формы: interceptor не должен продлевать сессию, повторять запрос и
// выкидывать на экран входа (15.11.2026).
describe('interceptor — 401 «Wrong current password»', () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('ошибка уходит форме: без продления, повтора и выхода', async () => {
    const { default: api } = await import('./api')
    const urls: string[] = []
    ;(api.defaults as any).adapter = (config: any) => {
      urls.push(config.url)
      return Promise.reject({
        config,
        response: { status: 401, data: { message: 'Wrong current password' }, headers: {}, config },
      })
    }
    window.history.replaceState(null, '', '/profile')
    await expect(api.patch('/auth/change-password', { oldPassword: 'old', newPassword: 'new-password' }))
      .rejects.toMatchObject({ response: { status: 401 } })
    expect(urls).toEqual(['/auth/change-password'])
    expect(sessionStorage.getItem('session-message')).toBeNull()
  })
})
