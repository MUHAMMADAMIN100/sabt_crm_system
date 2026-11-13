import { useSyncExternalStore } from 'react'

/**
 * Черновики «Директа» (13.11.2026): недописанный ответ живёт в каждом чате
 * отдельно — переключились на другой чат и вернулись, текст на месте. Хранится
 * в браузере сотрудника (localStorage), режим тоже: черновик заметки не должен
 * вернуться «ответом клиенту». Список чатов показывает «Черновик: …».
 */

export type DraftMode = 'message' | 'note'
export interface Draft { text: string; mode: DraftMode }

const PREFIX = 'direct-draft:'
const listeners = new Set<() => void>()
const cache = new Map<string, Draft | null>()

const keyOf = (userId: string | undefined, conversationId: string) => `${PREFIX}${userId || 'anon'}:${conversationId}`

function read(key: string): Draft | null {
  if (cache.has(key)) return cache.get(key) ?? null
  let draft: Draft | null = null
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
        draft = { text: parsed.text, mode: parsed.mode === 'note' ? 'note' : 'message' }
      }
    }
  } catch { /* хранилище недоступно — без черновиков */ }
  cache.set(key, draft)
  return draft
}

export function getDraft(userId: string | undefined, conversationId: string): Draft | null {
  return read(keyOf(userId, conversationId))
}

export function setDraft(userId: string | undefined, conversationId: string, draft: Draft | null): void {
  const key = keyOf(userId, conversationId)
  const value = draft && draft.text.trim() ? { text: draft.text.slice(0, 4000), mode: draft.mode } : null
  const prev = read(key)
  if (prev?.text === value?.text && prev?.mode === value?.mode) return
  cache.set(key, value)
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  } catch { /* переполнено или запрещено — черновик останется до перезагрузки */ }
  listeners.forEach(fn => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Черновик чата — для строки списка; обновляется, пока сотрудник печатает. */
export function useDraft(userId: string | undefined, conversationId: string): Draft | null {
  return useSyncExternalStore(subscribe, () => getDraft(userId, conversationId))
}
