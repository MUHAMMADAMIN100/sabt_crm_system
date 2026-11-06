import api from '@/lib/api'

/** «Директ» — переписка Instagram аккаунта агентства в CRM. */

/** mine — чаты, которые веду я; free — ни за кем не закреплены. */
export type DirectView = 'all' | 'mine' | 'free' | 'unread' | 'waiting'

export interface DirectPerson { id: string; name: string }

/** Менеджер продаж — кому можно передать чат. */
export interface DirectManager { id: string; name: string; role: string }

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
  /** Менеджер продаж, который ведёт клиента (первым ответил из CRM или получил
   *  чат). null — чат свободный: ответить может любой менеджер продаж. */
  assignee: DirectPerson | null
  assignedAt: string | null
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
  /** Метка временного пузыря отправителя: приходит в живом событии и в ответе на отправку. */
  clientId?: string | null
  /** Только у временного пузыря: почему отправка не дошла до сервера. */
  errorText?: string
  /** note — заметка для команды; event — отметка «чат закреплён / передан». */
  direction: 'in' | 'out' | 'note' | 'event'
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

export interface DirectStatsRow {
  /** null — ответы из приложения Instagram (без автора). */
  userId: string | null
  name: string
  /** Менеджер продаж; остальные строки — руководство и ответы из приложения. */
  isManager: boolean
  /** Клиентов ведёт сейчас / закрепилось за период / из них ждут ответа. */
  clients: number
  newClients: number
  waiting: number
  replies: number
  median: number | null
  average: number | null
  fast: number
  /** Лиды из чатов «Директа», созданные за период, и сколько стали сделкой. */
  leads: number
  deals: number
}

export interface DirectStats {
  from: string
  to: string
  people: DirectStatsRow[]
  waiting: { count: number; since: string | null }
  /** Чатов ни за кем не закреплено. */
  freeClients: number
}

/** Полный адрес файла API: фронт и сервер на разных доменах (Vercel / Railway). */
export function apiUrl(path: string | null | undefined): string | null {
  if (!path) return null
  // http(s) — уже полный адрес; blob:/data: — файл, ещё не ушедший на сервер.
  if (/^(https?:\/\/|blob:|data:)/.test(path)) return path
  return `${import.meta.env.VITE_API_URL || ''}${path}`
}

export const directApi = {
  status: () => api.get<DirectStatusInfo>('/direct/status').then(r => r.data),
  unread: () => api.get<{ count: number }>('/direct/unread').then(r => r.data),
  list: (params: { view?: DirectView; search?: string; assigneeId?: string; limit?: number; offset?: number }) =>
    api.get<{ items: DirectConversation[]; total: number }>('/direct/conversations', { params }).then(r => r.data),
  counts: (search?: string, assigneeId?: string) =>
    api.get<Record<DirectView, number>>('/direct/counts', { params: { search: search || undefined, assigneeId: assigneeId || undefined } }).then(r => r.data),
  managers: () => api.get<DirectManager[]>('/direct/managers').then(r => r.data),
  /** Передать чат менеджеру продаж; null — освободить. */
  assign: (id: string, userId: string | null) =>
    api.post<DirectConversation>(`/direct/conversations/${id}/assign`, { userId }).then(r => r.data),
  get: (id: string) => api.get<DirectConversation>(`/direct/conversations/${id}`).then(r => r.data),
  messages: (id: string, before?: string) =>
    api.get<{ items: DirectMessage[]; hasMore: boolean }>(`/direct/conversations/${id}/messages`, { params: { before, limit: 50 } }).then(r => r.data),
  read: (id: string) => api.post(`/direct/conversations/${id}/read`),
  viewing: (id: string) => api.post(`/direct/conversations/${id}/viewing`),
  leave: (id: string) => api.post(`/direct/conversations/${id}/leave`),
  send: (id: string, text: string, clientId?: string) =>
    api.post<DirectMessage[]>(`/direct/conversations/${id}/messages`, { text, clientId }).then(r => r.data),
  sendFile: (id: string, file: File, text?: string, clientId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (text?.trim()) form.append('text', text)
    if (clientId) form.append('clientId', clientId)
    return api.post<DirectMessage[]>(`/direct/conversations/${id}/files`, form, { timeout: 120000 }).then(r => r.data)
  },
  sendVoice: (id: string, blob: Blob, clientId?: string) => {
    const type = blob.type || 'audio/webm'
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
    const form = new FormData()
    form.append('file', blob, `voice.${ext}`)
    if (clientId) form.append('clientId', clientId)
    return api.post<DirectMessage>(`/direct/conversations/${id}/voice`, form, { timeout: 120000 }).then(r => r.data)
  },
  retry: (messageId: string) => api.post<DirectMessage>(`/direct/messages/${messageId}/retry`).then(r => r.data),
  addNote: (id: string, text: string, clientId?: string) =>
    api.post<DirectMessage>(`/direct/conversations/${id}/notes`, { text, clientId }).then(r => r.data),
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
