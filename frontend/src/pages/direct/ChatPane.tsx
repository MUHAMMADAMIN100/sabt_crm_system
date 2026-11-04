import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { ArrowLeft, Eye, ExternalLink, UserPlus, Contact } from 'lucide-react'
import { directApi, type DirectAttachment, type DirectMessage } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { isSocketConnected, useSocketConnected } from '@/lib/socketState'
import { ClientForm } from '@/pages/clients/ClientsPage'
import ContactAvatar from './ContactAvatar'
import MessageItem from './MessageItem'
import Composer from './Composer'
import { dayKey, dayLabel, duration } from './directTime'
import { upsertDirectMessage } from './directCache'

const LEAD_STATUS: Record<string, string> = {
  new: 'Новый', waiting: 'Ожидание ответа', negotiating: 'В переговорах', proposal: 'КП отправлено',
  won: 'Клиент', lost: 'Отказ', on_hold: 'На паузе', unknown: 'Неизвестно',
}

/** Сообщение, которое уже видно в ленте, но сервер его ещё не подтвердил. */
type Pending = {
  clientId: string
  kind: 'text' | 'file' | 'voice' | 'note'
  text: string
  file?: File
  blob?: Blob
  /** Локальная ссылка на фото или запись — показываем, пока файл летит на сервер. */
  previewUrl?: string
  status: 'sending' | 'failed'
  errorText?: string
  sentAt: string
}

const newClientId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

/** Открытая переписка: шапка с лидом и окном ответа, лента, поле ответа. */
export default function ChatPane({ id, connected, onBack }: { id: string; connected: boolean; onBack: () => void }) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const live = useSocketConnected()
  const isTop = user?.role === 'admin' || user?.role === 'founder'
  // Кто заводит лиды — как на сервере (clients.create): руководство и
  // менеджеры продаж по роли, остальные — по личному доступу; запрет сильнее.
  const LEAD_ROLES = ['admin', 'founder', 'sales_manager_smm', 'sales_manager_dev']
  const canCreateLead = !!user && !(user.deniedPermissions || []).includes('clients.create') && (
    LEAD_ROLES.includes(user.role || '') || LEAD_ROLES.includes(user.secondaryRole || '')
    || (user.extraPermissions || []).includes('clients.create'))
  const [showLead, setShowLead] = useState(false)
  const [pending, setPending] = useState<Pending[]>([])
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])

  // Пока вебсокет на связи, всё приходит событиями; без него — опрос раз в 10 секунд.
  const conversation = useQuery({
    queryKey: ['direct', 'conversation', id],
    queryFn: () => directApi.get(id),
    refetchInterval: live ? false : 10_000,
  })

  const feed = useInfiniteQuery({
    queryKey: ['direct', 'messages', id],
    queryFn: ({ pageParam }) => directApi.messages(id, pageParam),
    initialPageParam: undefined as string | undefined,
    // «Следующая» страница — более ранние сообщения.
    getNextPageParam: last => (last.hasMore && last.items.length ? last.items[0].id : undefined),
    refetchInterval: live ? false : 10_000,
  })
  const messages: DirectMessage[] = feed.data ? feed.data.pages.slice().reverse().flatMap(p => p.items) : []

  // Сервер подтвердил временный пузырь (пришло сообщение с его меткой) — убираем дубль.
  useEffect(() => {
    if (!pending.length) return
    const confirmed = new Set(messages.map(m => m.clientId).filter(Boolean) as string[])
    if (!pending.some(p => confirmed.has(p.clientId))) return
    setPending(list => {
      list.filter(p => confirmed.has(p.clientId)).forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
      return list.filter(p => !confirmed.has(p.clientId))
    })
  }, [messages, pending])

  // Локальные ссылки на файлы освобождаем, когда чат закрыли.
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => { pendingRef.current.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl)) }, [])

  // Прочитано: при открытии и когда, пока чат на экране, пришло новое.
  const unread = conversation.data?.unreadCount ?? 0
  useEffect(() => {
    const read = () => { if (document.visibilityState === 'visible') directApi.read(id).then(() => {
      qc.invalidateQueries({ queryKey: ['direct', 'unread'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    }).catch(() => {}) }
    read()
    const onVisible = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread])

  // «Сейчас в чате»: пульс, пока вкладка на экране; уход — сразу.
  useEffect(() => {
    const beat = () => { if (document.visibilityState === 'visible') directApi.viewing(id).catch(() => {}) }
    beat()
    const t = setInterval(beat, 20_000)
    return () => { clearInterval(t); directApi.leave(id).catch(() => {}) }
  }, [id])

  // Прокрутка: вниз при открытии, после своей отправки и когда сотрудник уже
  // внизу; ранние сообщения подгружаются без прыжка ленты.
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const opened = useRef<string | null>(null)
  const lastId = messages[messages.length - 1]?.id
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || (!messages.length && !pending.length)) return
    if (opened.current !== id) {
      opened.current = id
      el.scrollTop = el.scrollHeight
    } else if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop
      prevHeight.current = null
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, lastId, pending.length, id])

  const loadOlder = () => {
    if (scroller.current) prevHeight.current = scroller.current.scrollHeight
    void feed.fetchNextPage()
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['direct', 'messages', id] })
    qc.invalidateQueries({ queryKey: ['direct', 'conversation', id] })
    qc.invalidateQueries({ queryKey: ['direct', 'list'] })
    qc.invalidateQueries({ queryKey: ['direct', 'counts'] })
  }

  // Отправки идут строго по очереди: иначе два быстрых сообщения могли бы
  // прийти клиенту в обратном порядке. На экране каждое — сразу.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const runPending = (p: Pending) => {
    queue.current = queue.current.then(async () => {
      try {
        const sent = p.kind === 'note'
          ? await directApi.addNote(id, p.text, p.clientId)
          : p.kind === 'file'
            ? await directApi.sendFile(id, p.file!, p.text, p.clientId)
            : p.kind === 'voice'
              ? await directApi.sendVoice(id, p.blob!, p.clientId)
              : await directApi.send(id, p.text, p.clientId)
        const list = Array.isArray(sent) ? sent : [sent]
        for (const m of list) upsertDirectMessage(qc, id, { ...m, clientId: p.clientId })
        setPending(items => items.filter(x => x.clientId !== p.clientId))
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
        if (list.some(m => m.status === 'failed' && m.error === 'TOKEN_INVALID')) {
          toast.error('Ключ Instagram больше не действует — сообщите администратору')
        }
        // Без вебсокета шапка и список сами не узнают о новом сообщении.
        if (!isSocketConnected()) refresh()
      } catch (e: any) {
        const errorText = e?.response?.data?.message || (e?.code === 'ERR_NETWORK' ? 'Нет связи с сервером' : 'Не отправилось')
        setPending(items => items.map(x => (x.clientId === p.clientId ? { ...x, status: 'failed', errorText: String(errorText) } : x)))
      }
    })
  }

  const enqueue = (p: Omit<Pending, 'clientId' | 'status' | 'sentAt'>) => {
    const item: Pending = { ...p, clientId: newClientId(), status: 'sending', sentAt: new Date().toISOString() }
    nearBottom.current = true
    setPending(list => [...list, item])
    runPending(item)
  }

  const retryPending = (clientId: string) => {
    const p = pending.find(x => x.clientId === clientId)
    if (!p) return
    const again: Pending = { ...p, status: 'sending', errorText: undefined, sentAt: new Date().toISOString() }
    setPending(list => list.map(x => (x.clientId === clientId ? again : x)))
    runPending(again)
  }

  const dismissPending = (clientId: string) => {
    setPending(list => {
      list.filter(x => x.clientId === clientId).forEach(x => x.previewUrl && URL.revokeObjectURL(x.previewUrl))
      return list.filter(x => x.clientId !== clientId)
    })
  }

  const retry = useMutation({
    mutationFn: directApi.retry,
    onSuccess: (m: DirectMessage) => { upsertDirectMessage(qc, id, m); if (!isSocketConnected()) refresh() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось'),
  })
  const removeNote = useMutation({ mutationFn: directApi.deleteNote, onSuccess: refresh, onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось') })
  const createLead = useMutation({
    mutationFn: (data: any) => directApi.createLead(id, data),
    onSuccess: () => {
      setShowLead(false)
      toast.success('Лид создан в Базе клиентов')
      refresh()
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Лид не создан'),
  })

  const c = conversation.data
  if (conversation.isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>
  if (!c) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-surface-500">
        Чат не найден
        <button type="button" onClick={onBack} className="btn-secondary">К списку чатов</button>
      </div>
    )
  }

  const viewers = c.viewers.filter(v => v.id !== user?.id)
  const igLink = c.contact.username ? `https://ig.me/m/${c.contact.username}` : 'https://www.instagram.com/direct/inbox/'
  const left = c.replyUntil ? new Date(c.replyUntil).getTime() - Date.now() : null
  const blockedReason = !connected
    ? 'Instagram ещё не подключён к CRM — отвечайте из приложения Instagram.'
    : left === null
      ? 'Клиент ещё не писал — Instagram не даёт написать первым.'
      : left <= 0
        ? 'Прошло больше 24 часов после последнего сообщения клиента. Ответьте из приложения Instagram — ответ всё равно появится здесь.'
        : null

  const prefill = {
    name: c.contact.name || (c.contact.username ? `@${c.contact.username}` : ''),
    contactPerson: c.contact.name || '',
    contactInstagram: c.contact.username ? `@${c.contact.username}` : '',
    leadSource: 'Instagram',
    channel: 'Instagram',
    problem: messages.filter(m => m.direction === 'in' && m.text).slice(-3).map(m => m.text).join('\n').slice(0, 1500),
  }

  // Временные пузыри — в конце ленты, в том же виде, что настоящие.
  const pendingMessages: DirectMessage[] = pending.map(p => {
    const attachments: DirectAttachment[] = p.kind === 'file' && p.file
      ? [{ id: `pf-${p.clientId}`, kind: isPdf(p.file) ? 'file' : 'image', name: p.file.name, mimeType: p.file.type || (isPdf(p.file) ? 'application/pdf' : 'image/jpeg'), size: p.file.size, url: p.previewUrl ?? null, link: null }]
      : p.kind === 'voice' && p.blob
        ? [{ id: `pv-${p.clientId}`, kind: 'audio', name: null, mimeType: p.blob.type || 'audio/webm', size: p.blob.size, url: p.previewUrl ?? null, link: null }]
        : []
    return {
      id: `pending:${p.clientId}`,
      clientId: p.clientId,
      direction: p.kind === 'note' ? 'note' : 'out',
      text: p.text || null,
      status: p.kind === 'note' ? null : p.status,
      error: p.status === 'failed' ? 'CLIENT' : null,
      errorText: p.status === 'failed' ? p.errorText : undefined,
      author: user ? { id: user.id, name: user.name } : null,
      fromApp: false,
      sentAt: p.sentAt,
      deleted: false,
      reaction: null,
      attachments,
    }
  })
  const feedItems = [...messages, ...pendingMessages]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Шапка */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-3 py-2.5 dark:border-surface-700">
        <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 lg:hidden dark:hover:bg-surface-700" aria-label="К списку чатов">
          <ArrowLeft size={18} />
        </button>
        <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-surface-900 dark:text-white">{c.contact.label}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-surface-500">
            {c.contact.username && (
              <a href={`https://www.instagram.com/${c.contact.username}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-surface-800 dark:hover:text-surface-200">
                @{c.contact.username} <ExternalLink size={11} />
              </a>
            )}
            {left !== null && left > 0 && (
              <span className={clsx(left < 60 * 60 * 1000 && 'font-medium text-amber-700 dark:text-amber-300')}>
                ответить из CRM можно ещё {duration(left)}
              </span>
            )}
            {viewers.length > 0 && (
              <span className="inline-flex items-center gap-1"><Eye size={12} /> сейчас в чате: {viewers.map(v => v.name.split(' ')[0]).join(', ')}</span>
            )}
          </div>
        </div>
        {c.lead ? (
          <Link to={`/clients?id=${c.lead.id}`} className="btn-secondary !py-1.5 shrink-0 text-xs" title="Открыть карточку в Базе клиентов">
            <Contact size={14} /> <span className="hidden sm:inline">Лид:</span> {LEAD_STATUS[c.lead.status] || c.lead.status}
          </Link>
        ) : canCreateLead ? (
          <button type="button" onClick={() => setShowLead(true)} className="btn-secondary !py-1.5 shrink-0 text-xs">
            <UserPlus size={14} /> Создать лид
          </button>
        ) : null}
      </div>

      {/* Кто ответил последним и сколько ждёт клиент */}
      {(c.waitingSince || c.lastReply) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-surface-100 bg-surface-50 px-4 py-1.5 text-[12px] text-surface-500 dark:border-surface-700/60 dark:bg-surface-800/60">
          {c.waitingSince && (
            <span className="font-medium text-amber-700 dark:text-amber-300">Клиент ждёт ответа {duration(Date.now() - new Date(c.waitingSince).getTime())}</span>
          )}
          {c.lastReply && (
            <span>Последним ответил{c.lastReply.by ? `: ${c.lastReply.by.id === user?.id ? 'вы' : c.lastReply.by.name}` : ' из приложения Instagram'}</span>
          )}
        </div>
      )}

      {/* Лента */}
      <div
        ref={scroller}
        onScroll={e => {
          const el = e.currentTarget
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-white px-3 py-3 dark:bg-surface-900 sm:px-5"
      >
        {feed.hasNextPage && (
          <div className="flex justify-center pb-1">
            <button type="button" onClick={loadOlder} disabled={feed.isFetchingNextPage} className="btn-ghost !py-1 text-xs">
              {feed.isFetchingNextPage ? 'Загружаю…' : 'Показать раньше'}
            </button>
          </div>
        )}
        {feed.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {!feed.isLoading && !feedItems.length && <p className="py-10 text-center text-sm text-surface-400">Сообщений пока нет</p>}
        {feedItems.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || dayKey(feedItems[i - 1].sentAt) !== dayKey(m.sentAt)) && (
              <div className="flex justify-center py-1">
                <span className="rounded-full bg-surface-100 px-3 py-0.5 text-[11px] font-medium text-surface-500 dark:bg-surface-800">{dayLabel(m.sentAt)}</span>
              </div>
            )}
            <MessageItem
              m={m}
              meId={user?.id}
              canDeleteNote={m.direction === 'note' && !m.id.startsWith('pending:') && (m.author?.id === user?.id || isTop)}
              onRetry={mid => (mid.startsWith('pending:') ? retryPending(mid.slice(8)) : retry.mutate(mid))}
              onDismiss={m.id.startsWith('pending:') ? () => dismissPending(m.id.slice(8)) : undefined}
              onDeleteNote={nid => removeNote.mutate(nid)}
              retrying={retry.isPending}
            />
          </Fragment>
        ))}
      </div>

      <Composer
        conversationId={id}
        blockedReason={blockedReason}
        igLink={igLink}
        onSendText={text => enqueue({ kind: 'text', text })}
        onSendFile={(file, text) => enqueue({ kind: 'file', text, file, previewUrl: isPdf(file) ? undefined : URL.createObjectURL(file) })}
        onSendVoice={blob => enqueue({ kind: 'voice', text: '', blob, previewUrl: URL.createObjectURL(blob) })}
        onAddNote={text => enqueue({ kind: 'note', text })}
      />

      {showLead && (
        <ClientForm
          prefill={prefill}
          title="Новый лид из Директа"
          onClose={() => setShowLead(false)}
          onSubmit={(data: any) => createLead.mutate(data)}
          loading={createLead.isPending}
        />
      )}
    </div>
  )
}
