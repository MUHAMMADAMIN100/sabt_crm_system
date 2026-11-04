import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { ArrowLeft, Eye, ExternalLink, UserPlus, Contact } from 'lucide-react'
import { directApi, type DirectMessage } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { ClientForm } from '@/pages/clients/ClientsPage'
import ContactAvatar from './ContactAvatar'
import MessageItem from './MessageItem'
import Composer from './Composer'
import { dayKey, dayLabel, duration } from './directTime'

const LEAD_STATUS: Record<string, string> = {
  new: 'Новый', waiting: 'Ожидание ответа', negotiating: 'В переговорах', proposal: 'КП отправлено',
  won: 'Клиент', lost: 'Отказ', on_hold: 'На паузе', unknown: 'Неизвестно',
}

/** Открытая переписка: шапка с лидом и окном ответа, лента, поле ответа. */
export default function ChatPane({ id, connected, onBack }: { id: string; connected: boolean; onBack: () => void }) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isTop = user?.role === 'admin' || user?.role === 'founder'
  // Кто заводит лиды — как на сервере (clients.create): руководство и
  // менеджеры продаж по роли, остальные — по личному доступу; запрет сильнее.
  const LEAD_ROLES = ['admin', 'founder', 'sales_manager_smm', 'sales_manager_dev']
  const canCreateLead = !!user && !(user.deniedPermissions || []).includes('clients.create') && (
    LEAD_ROLES.includes(user.role || '') || LEAD_ROLES.includes(user.secondaryRole || '')
    || (user.extraPermissions || []).includes('clients.create'))
  const [showLead, setShowLead] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])

  const conversation = useQuery({
    queryKey: ['direct', 'conversation', id],
    queryFn: () => directApi.get(id),
  })

  const feed = useInfiniteQuery({
    queryKey: ['direct', 'messages', id],
    queryFn: ({ pageParam }) => directApi.messages(id, pageParam),
    initialPageParam: undefined as string | undefined,
    // «Следующая» страница — более ранние сообщения.
    getNextPageParam: last => (last.hasMore && last.items.length ? last.items[0].id : undefined),
  })
  const messages: DirectMessage[] = feed.data ? feed.data.pages.slice().reverse().flatMap(p => p.items) : []

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

  // Прокрутка: вниз при открытии и когда сотрудник уже внизу; ранние
  // сообщения подгружаются без прыжка ленты.
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const opened = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !messages.length) return
    if (opened.current !== id) {
      opened.current = id
      el.scrollTop = el.scrollHeight
    } else if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop
      prevHeight.current = null
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, messages[messages.length - 1]?.id, id])

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
  const afterSend = (sent: DirectMessage | DirectMessage[]) => {
    nearBottom.current = true
    refresh()
    const list = Array.isArray(sent) ? sent : [sent]
    const failed = list.find(m => m.status === 'failed')
    if (failed?.error === 'TOKEN_INVALID') toast.error('Ключ Instagram больше не действует — сообщите администратору')
  }

  const retry = useMutation({ mutationFn: directApi.retry, onSuccess: afterSend, onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось') })
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
            {c.viewers.length > 0 && (
              <span className="inline-flex items-center gap-1"><Eye size={12} /> сейчас в чате: {c.viewers.map(v => v.name.split(' ')[0]).join(', ')}</span>
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
        {!feed.isLoading && !messages.length && <p className="py-10 text-center text-sm text-surface-400">Сообщений пока нет</p>}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || dayKey(messages[i - 1].sentAt) !== dayKey(m.sentAt)) && (
              <div className="flex justify-center py-1">
                <span className="rounded-full bg-surface-100 px-3 py-0.5 text-[11px] font-medium text-surface-500 dark:bg-surface-800">{dayLabel(m.sentAt)}</span>
              </div>
            )}
            <MessageItem
              m={m}
              meId={user?.id}
              canDeleteNote={m.direction === 'note' && (m.author?.id === user?.id || isTop)}
              onRetry={mid => retry.mutate(mid)}
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
        onSendText={text => directApi.send(id, text).then(afterSend)}
        onSendFile={(file, text) => directApi.sendFile(id, file, text).then(afterSend)}
        onSendVoice={blob => directApi.sendVoice(id, blob).then(afterSend)}
        onAddNote={text => directApi.addNote(id, text).then(() => { nearBottom.current = true; refresh() })}
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
