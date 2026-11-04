import api from '@/lib/api'

/** «Директ» — переписка Instagram аккаунта агентства в CRM. */

export type DirectView = 'all' | 'unread' | 'waiting'

export interface DirectPerson { id: string; name: string }

export interface DirectConversation {
  id: string
  contact: { name: string | null; username: string | null; label: string; picture: string | null }
  lastMessage: {
    preview: string
    direction: 'in' | 'out'
    status: DirectStatus | null
    at: string
    author: DirectPerson | null
  } | null
  lastMessageAt: string
  unreadCount: number
  /** С какого момента клиент ждёт ответа; null — никто не ждёт. */
  waitingSince: string | null
  lastReply: { at: string; by: DirectPerson | null } | null
  /** До какого момента можно ответить из CRM (правило 24 часов Instagram). */
  replyUntil: string | null
  lead: { id: string; name: string; status: string } | null
  /** Кто ещё сейчас открыл этот чат. */
  viewers: DirectPerson[]
}

export type DirectStatus = 'sending' | 'sent' | 'read' | 'failed'

export type DirectAttachmentKind = 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'share' | 'reel' | 'story' | 'unsupported'

export interface DirectAttachment {
  id: string
  kind: DirectAttachmentKind
  name: string | null
  mimeType: string | null
  size: number | null
  /** Файл, сохранённый CRM (подписанная ссылка на сутки). */
  url: string | null
  /** Оригинал в Instagram: публикация, рилс, сторис. */
  link: string | null
}

export interface DirectMessage {
  id: string
  direction: 'in' | 'out' | 'note'
  text: string | null
  status: DirectStatus | null
  error: string | null
  author: DirectPerson | null
  fromApp: boolean
  sentAt: string
  deleted: boolean
  reaction: string | null
  attachments: DirectAttachment[]
}

export interface DirectStatusInfo {
  connected: boolean
  configured: { token: boolean; secret: boolean; verifyToken: boolean }
  account: string | null
  accountId: string | null
  tokenExpiresAt: string | null
  tokenRefreshedAt: string | null
  tokenInvalid: boolean
  lastWebhookAt: string | null
  storagePersistent: boolean | null
  webhookUrl: string
}

export interface DirectStats {
  from: string
  to: string
  people: { userId: string | null; name: string; replies: number; median: number; average: number; fast: number }[]
  waiting: { count: number; since: string | null }
}

/** Полный адрес файла API: фронт и сервер на разных доменах (Vercel / Railway). */
export function apiUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^https?:\/\//.test(path)) return path
  return `${import.meta.env.VITE_API_URL || ''}${path}`
}

export const directApi = {
  status: () => api.get<DirectStatusInfo>('/direct/status').then(r => r.data),
  unread: () => api.get<{ count: number }>('/direct/unread').then(r => r.data),
  list: (params: { view?: DirectView; search?: string; limit?: number; offset?: number }) =>
    api.get<{ items: DirectConversation[]; total: number }>('/direct/conversations', { params }).then(r => r.data),
  counts: (search?: string) =>
    api.get<Record<DirectView, number>>('/direct/counts', { params: { search: search || undefined } }).then(r => r.data),
  get: (id: string) => api.get<DirectConversation>(`/direct/conversations/${id}`).then(r => r.data),
  messages: (id: string, before?: string) =>
    api.get<{ items: DirectMessage[]; hasMore: boolean }>(`/direct/conversations/${id}/messages`, { params: { before, limit: 50 } }).then(r => r.data),
  read: (id: string) => api.post(`/direct/conversations/${id}/read`),
  viewing: (id: string) => api.post(`/direct/conversations/${id}/viewing`),
  leave: (id: string) => api.post(`/direct/conversations/${id}/leave`),
  send: (id: string, text: string) =>
    api.post<DirectMessage[]>(`/direct/conversations/${id}/messages`, { text }).then(r => r.data),
  sendFile: (id: string, file: File, text?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (text?.trim()) form.append('text', text)
    return api.post<DirectMessage[]>(`/direct/conversations/${id}/files`, form, { timeout: 120000 }).then(r => r.data)
  },
  sendVoice: (id: string, blob: Blob) => {
    const type = blob.type || 'audio/webm'
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
    const form = new FormData()
    form.append('file', blob, `voice.${ext}`)
    return api.post<DirectMessage>(`/direct/conversations/${id}/voice`, form, { timeout: 120000 }).then(r => r.data)
  },
  retry: (messageId: string) => api.post<DirectMessage>(`/direct/messages/${messageId}/retry`).then(r => r.data),
  addNote: (id: string, text: string) => api.post<DirectMessage>(`/direct/conversations/${id}/notes`, { text }).then(r => r.data),
  deleteNote: (noteId: string) => api.delete(`/direct/notes/${noteId}`),
  createLead: (id: string, data: any) => api.post<{ leadId: string }>(`/direct/conversations/${id}/lead`, data).then(r => r.data),
  stats: (params: { from?: string; to?: string }) => api.get<DirectStats>('/direct/stats', { params }).then(r => r.data),
}

/** Почему сообщение не ушло — по-человечески. */
export const FAILURE_TEXT: Record<string, string> = {
  TOKEN_INVALID: 'Ключ Instagram больше не действует — нужно обновить подключение',
  WINDOW_CLOSED: 'Прошло 24 часа после сообщения клиента — ответьте из приложения Instagram',
  UNAVAILABLE: 'Клиент недоступен: заблокировал аккаунт или удалил свой',
  NETWORK: 'Сбой связи с Instagram — попробуйте ещё раз',
  INTERRUPTED: 'Сервер перезапускался во время отправки — проверьте в Instagram, дошло ли, прежде чем повторять',
  REJECTED: 'Instagram не принял сообщение',
}
