import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { DirectConversation, DirectMessage } from '@/services/direct.api'
import { useAuthStore } from '@/store/auth.store'
import { isTopUser } from './directAccess'

/**
 * Живые обновления «Директа» прямо в кэш страницы: сервер присылает по
 * вебсокету само сообщение или строку чата, и лента со списком меняются
 * сразу, без повторного запроса. Сверка с сервером — фоном, чуть позже.
 */

type MessagePage = { items: DirectMessage[]; hasMore: boolean }
type ListPage = { items: DirectConversation[]; total: number }

const bySentAt = (a: DirectMessage, b: DirectMessage) =>
  new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Добавляет или обновляет сообщение в открытой ленте чата. */
export function upsertDirectMessage(qc: QueryClient, conversationId: string, message: DirectMessage): void {
  qc.setQueryData<InfiniteData<MessagePage>>(['direct', 'messages', conversationId], old => {
    if (!old?.pages?.length) return old
    let found = false
    const pages = old.pages.map(page => ({
      ...page,
      items: page.items.map(m => {
        if (m.id !== message.id) return m
        found = true
        // clientId приходит только в живом событии — не теряем его при обновлении.
        return { ...m, ...message, clientId: message.clientId ?? m.clientId ?? null }
      }),
    }))
    if (!found) {
      // pages[0] — самые свежие сообщения, по возрастанию времени.
      const newest = pages[0]
      pages[0] = { ...newest, items: [...newest.items, message].sort(bySentAt) }
    }
    return { ...old, pages }
  })
}

/** Как фильтрует сервер: «Непрочитанные» и «Ждут ответа» у менеджера — его
 *  чаты и свободные, у руководства — все. */
const matchesView = (c: DirectConversation, view: string, me: string | undefined, top: boolean) => {
  const myWork = top || !c.assignee || c.assignee.id === me
  return view === 'unread' ? c.unreadCount > 0 && myWork
    : view === 'waiting' ? !!c.waitingSince && myWork
      : view === 'mine' ? !!me && c.assignee?.id === me
        : view === 'free' ? !c.assignee
          : true
}

const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Сверка с сервером через пару секунд после серии событий — на случай,
 *  если какое-то событие потерялось. */
function reconcileLater(qc: QueryClient, key: string, queryKey: readonly unknown[]) {
  clearTimeout(reconcileTimers.get(key))
  reconcileTimers.set(key, setTimeout(() => {
    reconcileTimers.delete(key)
    qc.invalidateQueries({ queryKey })
  }, 2500))
}

/** Обновляет строку чата в шапке и во всех загруженных списках. */
export function applyDirectConversation(qc: QueryClient, conversation: DirectConversation): void {
  qc.setQueryData<DirectConversation>(['direct', 'conversation', conversation.id], conversation)

  const user = useAuthStore.getState().user
  const me = user?.id
  const top = isTopUser(user)
  for (const [key, data] of qc.getQueriesData<InfiniteData<ListPage>>({ queryKey: ['direct', 'list'] })) {
    // Ключ списка: ['direct', 'list', вкладка, поиск, менеджер].
    const [, , view = 'all', search = '', assigneeId = ''] = key as [string, string, string?, string?, string?]
    // Поиск фильтрует на сервере — такой список просто перечитываем.
    if (!data?.pages?.length || search) {
      qc.invalidateQueries({ queryKey: key, exact: true })
      continue
    }
    const wasThere = data.pages.some(p => p.items.some(c => c.id === conversation.id))
    const fits = matchesView(conversation, view, me, top) && (!assigneeId || conversation.assignee?.id === assigneeId)
    const pages = data.pages.map(p => ({ ...p, items: p.items.filter(c => c.id !== conversation.id) }))
    if (fits) {
      // Свежий чат — наверх: список идёт по времени последнего сообщения.
      pages[0] = {
        ...pages[0],
        items: [conversation, ...pages[0].items].sort(
          (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        ),
      }
    }
    const delta = (fits ? 1 : 0) - (wasThere ? 1 : 0)
    qc.setQueryData<InfiniteData<ListPage>>(key, {
      ...data,
      pages: pages.map((p, i) => (i === 0 ? { ...p, total: Math.max(0, p.total + delta) } : p)),
    })
  }
  qc.invalidateQueries({ queryKey: ['direct', 'counts'] })
  qc.invalidateQueries({ queryKey: ['direct', 'unread'] })
  reconcileLater(qc, 'list', ['direct', 'list'])
}
