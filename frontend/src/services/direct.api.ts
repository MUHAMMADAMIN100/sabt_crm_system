import api from '@/lib/api'

/** «Директ» — переписка Instagram аккаунта агентства в CRM. */

/** mine — чаты, которые веду я; free — ни за кем не закреплены; archived — архив. */
export type DirectView = 'all' | 'mine' | 'free' | 'unread' | 'waiting' | 'archived'

/** Фильтры списка поверх вкладки. */
export interface DirectFilters {
  labelId?: string
  /** with — лид из чата создан, without — ещё нет. */
  lead?: 'with' | 'without'
  /** Только чаты, где у меня стоит напоминание. */
  reminder?: boolean
}

export interface DirectLabel { id: string; name: string; color: string; sortOrder?: number }

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
  /** Закреплён сверху у всей команды. */
  pinned: boolean
  /** В архиве: когда и кто убрал. */
  archived: { at: string; by: string | null } | null
  /** «Пометили непрочитанным». */
  markedUnread: boolean
  labels: DirectLabel[]
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
  /** Реакция клиента. */
  reaction: string | null
  /** Реакция агентства (❤️). */
  ourReaction?: string | null
  /** Цитата: на какое сообщение это ответ. id null — оригинала нет в CRM. */
  replyTo?: DirectReplyPreview | null
  attachments: DirectAttachment[]
}

export interface DirectReplyPreview {
  id: string | null
  direction: 'in' | 'out' | 'note' | 'event' | null
  preview: string
  /** У нашего сообщения — кто написал. */
  author: string | null
}

export interface DirectTemplate { id: string; title: string; text: string; shared: boolean; canEdit: boolean }

export interface DirectReminder { id: string; conversationId: string; remindAt: string; note: string | null; fired: boolean }

export interface DirectSearchHit {
  messageId: string
  conversationId: string
  direction: 'in' | 'out' | 'note'
  sentAt: string
  snippet: string
  author: DirectPerson | null
  contact: { label: string; username: string | null; picture: string | null }
  archived: boolean
}

/** Правая панель чата. */
export interface DirectDetails {
  lead: {
    id: string; name: string; status: string
    phone: string | null; email: string | null; instagram: string | null; contactPerson: string | null
    sphere: string | null; nextStep: string | null; nextContactAt: string | null; dealPotential: number | null
    owner: DirectPerson | null
  } | null
  media: { id: string; kind: DirectAttachmentKind; mimeType: string | null; messageId: string; sentAt: string; url: string }[]
  files: { id: string; name: string | null; size: number | null; messageId: string; sentAt: string; url: string }[]
  notes: { id: string; text: string | null; sentAt: string; author: DirectPerson | null }[]
  reminders: { id: string; remindAt: string; note: string | null; fired: boolean; user: DirectPerson; mine: boolean }[]
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
  list: (params: { view?: DirectView; search?: string; assigneeId?: string; limit?: number; offset?: number } & DirectFilters) =>
    api.get<{ items: DirectConversation[]; total: number }>('/direct/conversations', { params: filterParams(params) }).then(r => r.data),
  counts: (params: { search?: string; assigneeId?: string } & DirectFilters) =>
    api.get<Record<DirectView, number>>('/direct/counts', { params: filterParams(params) }).then(r => r.data),
  managers: () => api.get<DirectManager[]>('/direct/managers').then(r => r.data),
  /** Передать чат менеджеру продаж; null — освободить. */
  assign: (id: string, userId: string | null) =>
    api.post<DirectConversation>(`/direct/conversations/${id}/assign`, { userId }).then(r => r.data),
  get: (id: string) => api.get<DirectConversation>(`/direct/conversations/${id}`).then(r => r.data),
  /** before — более ранние; until — переход к сообщению (всё от него до свежего). */
  messages: (id: string, before?: string, until?: string) =>
    api.get<{ items: DirectMessage[]; hasMore: boolean }>(`/direct/conversations/${id}/messages`, { params: { before, until, limit: 50 } }).then(r => r.data),
  read: (id: string) => api.post(`/direct/conversations/${id}/read`),
  viewing: (id: string) => api.post(`/direct/conversations/${id}/viewing`),
  leave: (id: string) => api.post(`/direct/conversations/${id}/leave`),
  send: (id: string, text: string, clientId?: string, replyToId?: string) =>
    api.post<DirectMessage[]>(`/direct/conversations/${id}/messages`, { text, clientId, replyToId }).then(r => r.data),
  sendFile: (id: string, file: File, text?: string, clientId?: string, replyToId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (text?.trim()) form.append('text', text)
    if (clientId) form.append('clientId', clientId)
    if (replyToId) form.append('replyToId', replyToId)
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
  addNote: (id: string, text: string, clientId?: string, mentions?: string[]) =>
    api.post<DirectMessage>(`/direct/conversations/${id}/notes`, { text, clientId, mentions: mentions?.length ? mentions : undefined }).then(r => r.data),
  deleteNote: (noteId: string) => api.delete(`/direct/notes/${noteId}`),
  createLead: (id: string, data: any) => api.post<{ leadId: string }>(`/direct/conversations/${id}/lead`, data).then(r => r.data),
  stats: (params: { from?: string; to?: string }) => api.get<DirectStats>('/direct/stats', { params }).then(r => r.data),

  details: (id: string) => api.get<DirectDetails>(`/direct/conversations/${id}/details`).then(r => r.data),
  pin: (id: string, on: boolean) => api.post<DirectConversation>(`/direct/conversations/${id}/pin`, { on }).then(r => r.data),
  archive: (id: string, on: boolean) => api.post<DirectConversation>(`/direct/conversations/${id}/archive`, { on }).then(r => r.data),
  markUnread: (id: string, on: boolean) => api.post<DirectConversation>(`/direct/conversations/${id}/unread`, { on }).then(r => r.data),
  setLabels: (id: string, labelIds: string[]) => api.put<DirectConversation>(`/direct/conversations/${id}/labels`, { labelIds }).then(r => r.data),
  typing: (id: string) => api.post(`/direct/conversations/${id}/typing`),
  react: (messageId: string, on: boolean) => api.post<DirectMessage>(`/direct/messages/${messageId}/react`, { on }).then(r => r.data),
  search: (q: string, conversationId?: string) =>
    api.get<{ items: DirectSearchHit[] }>('/direct/search', { params: { q, conversationId } }).then(r => r.data),
  team: () => api.get<DirectPerson[]>('/direct/team').then(r => r.data),

  labels: () => api.get<DirectLabel[]>('/direct/labels').then(r => r.data),
  createLabel: (data: { name: string; color?: string }) => api.post<DirectLabel[]>('/direct/labels', data).then(r => r.data),
  updateLabel: (id: string, data: { name?: string; color?: string; sortOrder?: number }) =>
    api.patch<DirectLabel[]>(`/direct/labels/${id}`, data).then(r => r.data),
  deleteLabel: (id: string) => api.delete<DirectLabel[]>(`/direct/labels/${id}`).then(r => r.data),

  templates: () => api.get<DirectTemplate[]>('/direct/templates').then(r => r.data),
  createTemplate: (data: { title: string; text: string; shared?: boolean }) => api.post('/direct/templates', data).then(r => r.data),
  updateTemplate: (id: string, data: { title?: string; text?: string }) => api.patch(`/direct/templates/${id}`, data).then(r => r.data),
  deleteTemplate: (id: string) => api.delete(`/direct/templates/${id}`),

  reminders: () => api.get<DirectReminder[]>('/direct/reminders').then(r => r.data),
  setReminder: (conversationId: string, remindAt: string, note?: string) =>
    api.post<DirectReminder[]>(`/direct/conversations/${conversationId}/reminders`, { remindAt, note: note || undefined }).then(r => r.data),
  removeReminder: (id: string) => api.delete<DirectReminder[]>(`/direct/reminders/${id}`).then(r => r.data),
}

/** Фильтры в адрес запроса: пустые не шлём, «с напоминанием» — как reminder=1. */
function filterParams(p: DirectFilters & object) {
  const { reminder, ...rest } = p as DirectFilters & Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null && v !== '') out[k] = v
  if (reminder) out.reminder = '1'
  return out
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
