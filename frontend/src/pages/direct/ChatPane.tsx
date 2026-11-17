import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import {
  Archive, ArrowDown, BellRing, ChevronLeft, Eye, Info, MoreHorizontal, Pin, Search, Upload,
} from 'lucide-react'
import { directApi, type DirectAttachment, type DirectMessage } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { isSocketConnected, useSocketConnected } from '@/lib/socketState'
import { ClientForm } from '@/components/sales/ClientForm'
import { duplicatesOf } from '@/services/sales.api'
import { invalidateSales } from '@/lib/salesQueries'
import ContactAvatar from './ContactAvatar'
import MessageItem, { isPictureAttachment } from './MessageItem'
import Composer, { quoteOf, type ComposerHandle } from './Composer'
import { dayKey, dayLabel, duration, clockTime } from './directTime'
import { upsertDirectMessage } from './directCache'
import { canReplyIn, shortName } from './directAccess'
import ChatMenu, { anchorOf, type MenuAnchor } from './ChatMenu'
import ChatSidePanel, { LEAD_STATUS } from './ChatSidePanel'
import ChatSearch from './ChatSearch'
import Lightbox, { type LightboxItem } from './Lightbox'
import { remindLabel, useMyReminders } from './chatActions'
import { useMedia } from './useMedia'
import { useFeedGestures } from './useFeedGestures'
import { useBubbleGradient } from './useBubbleGradient'
import MessageSheet from './MessageSheet'
import { canQuote } from './MessageItem'

/** Сообщение, которое уже видно в ленте, но сервер его ещё не подтвердил. */
type Pending = {
  clientId: string
  kind: 'text' | 'file' | 'voice' | 'note'
  text: string
  file?: File
  blob?: Blob
  /** Локальная ссылка на фото или запись — показываем, пока файл летит на сервер. */
  previewUrl?: string
  /** Ответ на сообщение (цитата). */
  replyTo?: DirectMessage | null
  mentions?: string[]
  status: 'sending' | 'failed'
  errorText?: string
  sentAt: string
}

const newClientId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const fileKind = (f: File): 'image' | 'video' | 'file' => {
  const name = f.name.toLowerCase()
  if (f.type.startsWith('video/') || /\.(mp4|mov)$/.test(name)) return 'video'
  if (f.type === 'application/pdf' || name.endsWith('.pdf')) return 'file'
  return 'image'
}

/** Карточка клиента справа (широкий экран): как «Информация» в Instagram —
 *  по умолчанию закрыта, открывается ⓘ и помнит выбор (16.11.2026). */
const PANEL_KEY = 'direct-panel-v2'

/** Как в Instagram: перерыв в переписке дольше часа (или новый день) — по
 *  центру строка «Сегодня 14:32». */
const TIME_GAP = 60 * 60_000
function timeBreak(prev: DirectMessage | undefined, m: DirectMessage): boolean {
  if (!prev) return true
  if (dayKey(prev.sentAt) !== dayKey(m.sentAt)) return true
  return new Date(m.sentAt).getTime() - new Date(prev.sentAt).getTime() >= TIME_GAP
}

/** Подряд идущие сообщения одной стороны (до 5 минут между ними) — одна группа. */
function sameGroup(a: DirectMessage | undefined, b: DirectMessage | undefined, dividerId: string | null): boolean {
  if (!a || !b || a.direction !== b.direction || (a.direction !== 'in' && a.direction !== 'out')) return false
  if (b.id === dividerId) return false
  if (a.direction === 'out' && (a.fromApp !== b.fromApp || a.author?.id !== b.author?.id)) return false
  if (dayKey(a.sentAt) !== dayKey(b.sentAt)) return false
  // Реакция под пузырём — как в Instagram, следующий пузырь не прилипает.
  if (a.reaction || a.ourReaction) return false
  return Math.abs(new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()) < 5 * 60_000
}

function groupOf(items: DirectMessage[], i: number, dividerId: string | null) {
  return { first: !sameGroup(items[i - 1], items[i], dividerId), last: !sameGroup(items[i], items[i + 1], dividerId) }
}

/** «Просмотрено», «Отправлено · Мадина» — под последним нашим сообщением. */
function statusCaption(m: DirectMessage, meId: string | undefined): string | null {
  if (m.status === 'failed') return null
  const state = m.status === 'read' ? 'Просмотрено' : m.status === 'sent' ? 'Отправлено' : m.status === 'sending' ? 'Отправляется…' : null
  if (!state) return null
  const who = m.fromApp ? 'из приложения' : m.author && m.author.id !== meId ? m.author.name.split(' ')[0] : null
  return who ? `${state} · ${who}` : state
}

/** Первое непрочитанное: столько-то последних сообщений клиента. */
function firstUnreadOf(messages: DirectMessage[], unread: number): string | null {
  if (unread <= 0) return null
  let left = unread
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction !== 'in') continue
    left -= 1
    if (left === 0) return messages[i].id
  }
  // Непрочитанных больше, чем загружено, — полоса над всем загруженным.
  return messages[0]?.id ?? null
}

/** Открытая переписка: шапка, лента, поле ответа, карточка клиента справа. */
export default function ChatPane({ id, connected, onBack, focusMessageId, onFocusDone }: {
  id: string
  connected: boolean
  onBack: () => void
  /** Перейти к сообщению (поиск в списке, ссылка). */
  focusMessageId?: string | null
  onFocusDone?: () => void
}) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const live = useSocketConnected()
  const wide = useMedia('(min-width: 1280px)')
  // Чат как в Instagram на любом экране (16.11.2026). Узкий экран — шапка
  // компактнее; сенсорный — жесты (ответ свайпом, меню долгим нажатием, ❤️
  // двойным тапом), с мышью — действия при наведении и правый щелчок.
  const phone = useMedia('(max-width: 639px)')
  const touch = useMedia('(hover: none) and (pointer: coarse)')
  const [sheet, setSheet] = useState<{ m: DirectMessage; rect: DOMRect } | null>(null)
  /** Можно ли сейчас отвечать и ставить ❤️ — для жестов (они живут вне перерисовок). */
  const actRef = useRef(false)
  const isTop = user?.role === 'admin' || user?.role === 'founder'
  // Кто заводит лиды — как на сервере (clients.create): руководство и
  // менеджеры продаж по роли, остальные — по личному доступу; запрет сильнее.
  const LEAD_ROLES = ['admin', 'founder', 'sales_manager_smm', 'sales_manager_dev']
  const canCreateLead = !!user && !(user.deniedPermissions || []).includes('clients.create') && (
    LEAD_ROLES.includes(user.role || '') || LEAD_ROLES.includes(user.secondaryRole || '')
    || (user.extraPermissions || []).includes('clients.create'))
  const [showLead, setShowLead] = useState(false)
  const [pending, setPending] = useState<Pending[]>([])
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null)
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [searching, setSearching] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === '1' } catch { return false } })
  const [drawer, setDrawer] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const dragDepth = useRef(0)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])

  // Пока вебсокет на связи, всё приходит событиями; без него — опрос раз в 10 секунд.
  const conversation = useQuery({
    queryKey: ['direct', 'conversation', id],
    queryFn: () => directApi.get(id),
    refetchInterval: live ? false : 10_000,
  })
  const { data: team } = useQuery({ queryKey: ['direct', 'team'], queryFn: directApi.team, staleTime: 10 * 60_000 })
  const { data: myReminders } = useMyReminders()
  const { data: status } = useQuery({ queryKey: ['direct', 'status'], queryFn: directApi.status, staleTime: 60_000 })

  // Переход к сообщению: первая страница ленты — от него до свежего.
  const anchor = useRef<string | null>(focusMessageId ?? null)
  const pendingJump = useRef<string | null>(focusMessageId ?? null)
  const feed = useInfiniteQuery({
    queryKey: ['direct', 'messages', id],
    queryFn: ({ pageParam }) => (pageParam === undefined && anchor.current
      ? directApi.messages(id, undefined, anchor.current)
      : directApi.messages(id, pageParam)),
    initialPageParam: undefined as string | undefined,
    // «Следующая» страница — более ранние сообщения.
    getNextPageParam: last => (last.hasMore && last.items.length ? last.items[0].id : undefined),
    refetchInterval: live ? false : 10_000,
  })
  const messages: DirectMessage[] = useMemo(
    () => (feed.data ? feed.data.pages.slice().reverse().flatMap(p => p.items) : []),
    [feed.data],
  )
  const messagesRef = useRef(messages)
  messagesRef.current = messages

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

  // «Новые сообщения»: сколько было непрочитанных, когда чат открыли, —
  // полоса встаёт перед первым из них и остаётся, пока чат открыт.
  // Считаем сразу при отрисовке: первая прокрутка должна уже знать, где полоса.
  const unreadAtOpen = useRef<number | null>(null)
  if (unreadAtOpen.current === null && conversation.data) unreadAtOpen.current = conversation.data.unreadCount
  const divider = useRef<string | null | undefined>(undefined)
  if (divider.current === undefined && messages.length && unreadAtOpen.current !== null) {
    divider.current = firstUnreadOf(messages, unreadAtOpen.current)
  }
  const dividerId = divider.current ?? null

  // Прокрутка: вниз при открытии (или к «Новым сообщениям»), после своей
  // отправки и когда сотрудник уже внизу; ранние сообщения подгружаются без
  // прыжка ленты; переход к сообщению — по центру с подсветкой.
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const opened = useRef<string | null>(null)
  const lastId = messages[messages.length - 1]?.id
  const firstId = messages[0]?.id
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>()

  const showMessage = useCallback((mid: string): boolean => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(mid)}"]`)
    if (!el) return false
    nearBottom.current = false
    el.scrollIntoView({ block: 'center' })
    setHighlight(mid)
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlight(null), 2600)
    return true
  }, [])
  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  // Клавиатура открылась (лента стала ниже) — последнее сообщение остаётся на виду.
  const loaded = !!conversation.data
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientHeight
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight
      if (h < last && nearBottom.current) el.scrollTop = el.scrollHeight
      last = h
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [loaded])

  const findMessage = (id: string) => messagesRef.current.find(x => x.id === id)
  useBubbleGradient(scroller, loaded)
  useFeedGestures(scroller, touch && loaded, {
    canReply: id => { const m = findMessage(id); return !!m && actRef.current && canQuote(m) },
    onReply: id => { const m = findMessage(id); if (m) setReplyTo(m) },
    onLongPress: (id, rect) => { const m = findMessage(id); if (m && !m.deleted) setSheet({ m, rect }) },
    onDoubleTap: id => {
      const m = findMessage(id)
      if (m && actRef.current && m.direction === 'in' && !m.deleted) react.mutate({ m, on: !m.ourReaction })
    },
  })

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || (!messages.length && !pending.length)) return
    if (pendingJump.current) {
      if (showMessage(pendingJump.current)) {
        pendingJump.current = null
        opened.current = id
      } else if (!feed.isFetching) {
        pendingJump.current = null
        toast('Это сообщение больше не найти — возможно, его удалили')
        el.scrollTop = el.scrollHeight
      }
      return
    }
    if (opened.current !== id) {
      opened.current = id
      const divider = el.querySelector<HTMLElement>('[data-divider]')
      if (divider && divider.offsetTop > el.clientHeight / 2) {
        el.scrollTop = Math.max(0, divider.offsetTop - 12)
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        setAtBottom(nearBottom.current)
      } else {
        el.scrollTop = el.scrollHeight
      }
    } else if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop
      prevHeight.current = null
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, lastId, firstId, pending.length, id, feed.isFetching, dividerId, showMessage])

  // Новое от клиента, пока сотрудник листает выше, — счётчик на кнопке «вниз».
  const seenLast = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!lastId) return
    if (seenLast.current && seenLast.current !== lastId && !nearBottom.current) {
      const last = messages[messages.length - 1]
      if (last?.direction === 'in') setUnseen(n => n + 1)
    }
    seenLast.current = lastId
  }, [lastId, messages])

  const loadOlder = useCallback(() => {
    if (!feed.hasNextPage || feed.isFetchingNextPage) return
    if (scroller.current) prevHeight.current = scroller.current.scrollHeight
    void feed.fetchNextPage()
  }, [feed])

  const toBottom = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    nearBottom.current = true
    setUnseen(0)
  }

  /** К сообщению: уже в ленте — прокрутка, иначе лента грузится от него. */
  const jumpTo = useCallback((mid: string) => {
    if (messagesRef.current.some(m => m.id === mid)) { showMessage(mid); return }
    anchor.current = mid
    pendingJump.current = mid
    void qc.resetQueries({ queryKey: ['direct', 'messages', id], exact: true })
  }, [id, qc, showMessage])

  // Пришли из поиска в списке — к найденному сообщению.
  useEffect(() => {
    if (!focusMessageId) return
    if (pendingJump.current !== focusMessageId) jumpTo(focusMessageId)
    onFocusDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['direct', 'messages', id] })
    qc.invalidateQueries({ queryKey: ['direct', 'conversation', id] })
    qc.invalidateQueries({ queryKey: ['direct', 'details', id] })
    qc.invalidateQueries({ queryKey: ['direct', 'list'] })
    qc.invalidateQueries({ queryKey: ['direct', 'counts'] })
  }

  // Отправки идут строго по очереди: иначе два быстрых сообщения могли бы
  // прийти клиенту в обратном порядке. На экране каждое — сразу.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const runPending = (p: Pending) => {
    queue.current = queue.current.then(async () => {
      try {
        const replyId = p.replyTo?.id
        const sent = p.kind === 'note'
          ? await directApi.addNote(id, p.text, p.clientId, p.mentions)
          : p.kind === 'file'
            ? await directApi.sendFile(id, p.file!, p.text, p.clientId, replyId)
            : p.kind === 'voice'
              ? await directApi.sendVoice(id, p.blob!, p.clientId)
              : await directApi.send(id, p.text, p.clientId, replyId)
        const list = Array.isArray(sent) ? sent : [sent]
        for (const m of list) upsertDirectMessage(qc, id, { ...m, clientId: p.clientId })
        setPending(items => items.filter(x => x.clientId !== p.clientId))
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
        if (list.some(m => m.status === 'failed' && m.error === 'TOKEN_INVALID')) {
          toast.error('Ключ Instagram больше не действует — сообщите администратору')
        }
        if (p.kind === 'note' || p.kind === 'file') qc.invalidateQueries({ queryKey: ['direct', 'details', id] })
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
    setUnseen(0)
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
  const removeNote = useMutation({
    mutationFn: directApi.deleteNote,
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось'),
  })
  // ❤️: сразу на экране, сервер подтверждает; не вышло — возвращаем как было.
  const react = useMutation({
    mutationFn: ({ m, on }: { m: DirectMessage; on: boolean }) => directApi.react(m.id, on),
    onMutate: ({ m, on }) => { upsertDirectMessage(qc, id, { ...m, ourReaction: on ? '❤️' : null }) },
    onSuccess: fresh => upsertDirectMessage(qc, id, fresh),
    onError: (e: any, { m }) => {
      upsertDirectMessage(qc, id, m)
      toast.error(e?.response?.data?.message || 'Реакция не поставлена')
    },
  })
  const onReact = useCallback((m: DirectMessage, on: boolean) => react.mutate({ m, on }), [react])
  const onReply = useCallback((m: DirectMessage) => setReplyTo(m), [])
  const onMessageMenu = useCallback((m: DirectMessage, rect: DOMRect) => setSheet({ m, rect }), [])
  // «Создать лид» (15.11.2026): сервер проверяет дубли (телефон, Instagram,
  // название) и отвечает 409 — форма показывает найденных и даёт создать
  // всё равно (force). Тост — только для прочих ошибок.
  const createLead = useMutation({
    mutationFn: ({ data, force }: { data: any; force?: boolean }) =>
      directApi.createLead(id, force ? { ...data, force: true } : data),
    onSuccess: () => {
      setShowLead(false)
      toast.success('Лид создан в «Клиентах»')
      refresh()
      invalidateSales(qc)
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
    },
    onError: (e: any) => {
      if (duplicatesOf(e)) return
      const m = e?.response?.data?.message
      toast.error(Array.isArray(m) ? m.join('. ') : (typeof m === 'string' && m) || 'Лид не создан')
    },
  })

  // Фото ленты — для просмотра на весь экран с листанием.
  const gallery = useMemo(() => {
    const items: LightboxItem[] = []
    for (const m of messages) {
      if (m.deleted) continue
      for (const a of m.attachments) {
        if (!isPictureAttachment(a) || !a.url || a.url.startsWith('blob:')) continue
        const who = m.direction === 'in' ? 'Клиент' : m.fromApp ? 'Из приложения' : m.author?.id === user?.id ? 'Вы' : m.author?.name || 'Агентство'
        items.push({ id: a.id, url: a.url, video: false, caption: `${who} · ${dayLabel(m.sentAt)} ${clockTime(m.sentAt)}` })
      }
    }
    return items
  }, [messages, user?.id])
  const openMedia = useCallback((attachmentId: string) => {
    const index = gallery.findIndex(g => g.id === attachmentId)
    if (index >= 0) setLightbox({ items: gallery, index })
  }, [gallery])

  const mentionNames = useMemo(() => (team ?? []).map(p => p.name), [team])

  const togglePanel = () => {
    if (wide) {
      setPanelOpen(v => {
        try { localStorage.setItem(PANEL_KEY, v ? '0' : '1') } catch { /* не страшно */ }
        return !v
      })
    } else setDrawer(v => !v)
  }
  const openPanel = () => {
    if (wide) { setPanelOpen(true); try { localStorage.setItem(PANEL_KEY, '1') } catch { /* не страшно */ } } else setDrawer(true)
  }

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
  // Чат ведёт другой менеджер — клиенту не пишем и лид не заводим, только
  // заметки для команды. Руководство пишет всегда (как и сервер).
  const canReplyHere = canReplyIn(user, c.assignee?.id)
  const readOnlyReason = canReplyHere
    ? null
    : `Чат ведёт ${c.assignee?.name || 'другой менеджер'} — клиенту отвечает закреплённый менеджер или руководство. Вы можете оставить заметку для команды.`
  const igLink = c.contact.username ? `https://ig.me/m/${c.contact.username}` : 'https://www.instagram.com/direct/inbox/'
  const left = c.replyUntil ? new Date(c.replyUntil).getTime() - Date.now() : null
  // Несколько аккаунтов: ответ уходит с того, куда написал клиент.
  const linked = (status?.accounts ?? []).filter(a => a.accountId)
  const chatAccount = linked.find(a => a.accountId === c.accountId) ?? null
  const viaName = linked.length > 1 ? (chatAccount?.username ?? null) : null
  const accountGone = !!status && linked.length > 0 && !chatAccount
  const blockedReason = !connected
    ? 'Instagram ещё не подключён к CRM — отвечайте из приложения Instagram.'
    : accountGone
      ? 'Аккаунт Instagram этого чата отключён от CRM — ответьте из приложения Instagram.'
    : left === null
      ? 'Клиент ещё не писал — Instagram не даёт написать первым.'
      : left <= 0
        ? 'Прошло больше 24 часов после последнего сообщения клиента. Ответьте из приложения Instagram — ответ всё равно появится здесь.'
        : null
  const canAct = canReplyHere && !blockedReason
  actRef.current = canAct
  const myReminder = myReminders?.find(r => r.conversationId === c.id) ?? null

  // Строка под именем — самое важное для работы, коротко, через «·».
  const subtitle: { key: string; node: ReactNode }[] = []
  if (c.waitingSince) {
    subtitle.push({ key: 'wait', node: <span className="font-medium text-amber-700 dark:text-amber-300">ждёт {duration(Date.now() - new Date(c.waitingSince).getTime())}</span> })
  }
  subtitle.push({ key: 'who', node: c.assignee ? (c.assignee.id === user?.id ? 'ведёте вы' : `ведёт ${shortName(c.assignee.name)}`) : 'свободный' })
  if (left !== null && left > 0 && left < 4 * 60 * 60 * 1000) {
    subtitle.push({
      key: 'left',
      node: <span className={clsx(left < 60 * 60 * 1000 && 'font-medium text-amber-700 dark:text-amber-300')} title="Instagram даёт ответить из CRM 24 часа после последнего сообщения клиента">ответ ещё {duration(left)}</span>,
    })
  }
  if (myReminder) {
    const due = new Date(myReminder.remindAt).getTime() <= Date.now()
    subtitle.push({ key: 'rem', node: <span className={clsx('inline-flex items-center gap-0.5', due && 'font-medium text-amber-700 dark:text-amber-300')}><BellRing size={11} className="shrink-0" />{due ? 'пора вернуться' : remindLabel(myReminder.remindAt)}</span> })
  }
  if (c.lead) subtitle.push({ key: 'lead', node: `лид: ${LEAD_STATUS[c.lead.status] || c.lead.status}` })
  if (viewers.length) subtitle.push({ key: 'view', node: <span className="inline-flex items-center gap-0.5"><Eye size={12} className="shrink-0" />{viewers.map(v => v.name.split(' ')[0]).join(', ')}</span> })
  if (viaName) subtitle.push({ key: 'via', node: `через @${viaName}` })
  if (!phone && c.contact.name && c.contact.username) subtitle.push({ key: 'nick', node: `@${c.contact.username}` })
  const avatar = <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={28} />

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
    const kind = p.file ? fileKind(p.file) : null
    const attachments: DirectAttachment[] = p.kind === 'file' && p.file
      ? [{
        id: `pf-${p.clientId}`, kind: kind === 'file' ? 'file' : kind === 'video' ? 'video' : 'image', name: p.file.name,
        mimeType: p.file.type || (kind === 'file' ? 'application/pdf' : kind === 'video' ? 'video/mp4' : 'image/jpeg'),
        size: p.file.size, url: p.previewUrl ?? null, link: null,
      }]
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
      replyTo: p.replyTo ? { id: p.replyTo.id, direction: p.replyTo.direction, preview: quoteOf(p.replyTo), author: p.replyTo.author?.name ?? null } : null,
      attachments,
    }
  })
  const feedItems = [...messages, ...pendingMessages]
  // Под последним нашим сообщением на телефоне — «Просмотрено» / «Отправлено».
  let lastOutId: string | null = null
  for (let k = feedItems.length - 1; k >= 0; k--) {
    if (feedItems[k].direction === 'in') break
    if (feedItems[k].direction === 'out') { lastOutId = feedItems[k].id; break }
  }

  const sendFiles = (files: File[], text: string) => {
    const reply = replyTo
    setReplyTo(null)
    files.forEach((file, i) => {
      const kind = fileKind(file)
      enqueue({
        kind: 'file', file,
        // Одна картинка — подпись уходит вместе с ней; несколько — текст отдельным сообщением в конце.
        text: files.length === 1 ? text : '',
        replyTo: i === 0 ? reply : null,
        previewUrl: kind === 'file' ? undefined : URL.createObjectURL(file),
      })
    })
    if (files.length > 1 && text) enqueue({ kind: 'text', text })
  }

  const panel = (
    <ChatSidePanel c={c} onClose={() => (wide ? togglePanel() : setDrawer(false))}
      onJump={mid => { setDrawer(false); jumpTo(mid) }}
      onOpenGallery={(items, index) => setLightbox({ items, index })}
      onCreateLead={() => { setDrawer(false); setShowLead(true) }}
      canCreateLead={canCreateLead}
      onRefresh={refresh} />
  )

  const dropAllowed = canReplyHere && !blockedReason

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={e => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={e => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={e => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          const files = Array.from(e.dataTransfer.files)
          if (!files.length) return
          if (!dropAllowed) { toast.error(readOnlyReason || blockedReason || 'Сейчас клиенту написать нельзя'); return }
          composer.current?.addFiles(files)
        }}>
        {/* Шапка — как в Instagram: аватар, имя, под ним одна строка о главном.
            Лид, метки, напоминание, кто ведёт — в карточке ⓘ и меню «⋯». */}
        <div className="flex items-center gap-1 border-b border-surface-200 py-1.5 pl-1 pr-1.5 dark:border-surface-800 sm:gap-1.5 sm:py-2.5 sm:pl-4 sm:pr-3">
          <button type="button" onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-surface-900 hover:bg-surface-100 active:bg-surface-200 lg:hidden dark:text-white dark:hover:bg-surface-800"
            aria-label="К списку чатов">
            <ChevronLeft size={28} strokeWidth={2.2} />
          </button>
          <button type="button" onClick={openPanel} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-0.5 pr-1 text-left" title="Карточка клиента">
            <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={phone ? 36 : 44} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-[16px] font-semibold leading-tight text-surface-900 dark:text-white">{c.contact.label}</span>
                {c.pinned && <Pin size={13} className="shrink-0 text-surface-400" aria-label="Закреплён" />}
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-surface-500 dark:text-surface-400">
                {subtitle.map((part, k) => <Fragment key={part.key}>{k > 0 && ' · '}{part.node}</Fragment>)}
              </span>
            </span>
          </button>
          {!phone && (
            <button type="button" onClick={() => setSearching(v => !v)} aria-pressed={searching}
              className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-100 dark:hover:bg-surface-800', searching ? 'text-[#0095f6]' : 'text-surface-800 dark:text-surface-100')}
              aria-label="Найти в переписке" title="Найти в переписке">
              <Search size={21} />
            </button>
          )}
          {!phone && (
            <button type="button" onClick={togglePanel} aria-pressed={wide ? panelOpen : drawer}
              className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-100 dark:hover:bg-surface-800',
                (wide ? panelOpen : drawer) ? 'text-[#0095f6]' : 'text-surface-800 dark:text-surface-100')}
              aria-label="Информация о клиенте" title="Карточка клиента: лид, метки, напоминания, файлы">
              <Info size={22} fill={(wide ? panelOpen : drawer) ? 'currentColor' : 'none'} className={(wide ? panelOpen : drawer) ? '[&>path]:stroke-white dark:[&>path]:stroke-surface-900' : undefined} />
            </button>
          )}
          <button type="button" onClick={e => setMenu(anchorOf(e.currentTarget))}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-surface-800 hover:bg-surface-100 active:bg-surface-200 dark:text-surface-100 dark:hover:bg-surface-800"
            aria-label="Действия с чатом" title="Закрепить, метки, напоминание, архив" aria-haspopup="menu" aria-expanded={!!menu}>
            <MoreHorizontal size={22} />
          </button>
        </div>

        {c.archived && (
          <div className="flex items-center gap-2 border-b border-surface-100 bg-surface-50 px-4 py-1.5 text-[12px] text-surface-600 dark:border-surface-800 dark:bg-surface-800/60 dark:text-surface-300">
            <Archive size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">Чат в архиве{c.archived.by ? ` — убрал(а) ${c.archived.by}` : ''}. Вернётся сам, когда клиент напишет.</span>
          </div>
        )}

        {searching && <ChatSearch conversationId={id} onClose={() => setSearching(false)} onPick={mid => { setSearching(false); jumpTo(mid) }} />}

        {/* Лента */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scroller}
            onScroll={e => {
              const el = e.currentTarget
              const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
              nearBottom.current = near
              if (near !== atBottom) setAtBottom(near)
              if (near && unseen) setUnseen(0)
              // Долистали до верха — подгружаем раньше сами.
              if (el.scrollTop < 60 && feed.hasNextPage && !feed.isFetchingNextPage) loadOlder()
            }}
            className={clsx('h-full overflow-y-auto overscroll-contain bg-white px-3 pb-3 pt-1 dark:bg-surface-900 sm:px-5 lg:px-6', touch && 'direct-feed-phone')}
          >
            {feed.hasNextPage ? (
              <div className="flex justify-center py-2">
                <button type="button" onClick={loadOlder} disabled={feed.isFetchingNextPage} className="btn-ghost !py-1 text-xs">
                  {feed.isFetchingNextPage ? 'Загружаю…' : 'Показать раньше'}
                </button>
              </div>
            ) : !feed.isLoading && !feed.isError && (
              // Начало переписки — как в Instagram: кто это и ссылка на профиль.
              <div className="flex flex-col items-center px-4 pb-6 pt-8 text-center">
                <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={phone ? 88 : 96} />
                <div className="mt-3 max-w-full truncate text-[19px] font-semibold text-surface-900 dark:text-white">{c.contact.label}</div>
                <div className="mt-0.5 text-[14px] text-surface-500">{c.contact.username ? `@${c.contact.username} · Instagram` : 'Instagram'}</div>
                {c.contact.username && (
                  <a href={`https://www.instagram.com/${c.contact.username}/`} target="_blank" rel="noreferrer"
                    className="mt-4 inline-flex min-h-[34px] items-center rounded-lg bg-surface-100 px-4 text-[14px] font-semibold text-surface-900 hover:bg-surface-200 dark:bg-surface-800 dark:text-white dark:hover:bg-surface-700">
                    Открыть профиль
                  </a>
                )}
              </div>
            )}
            {feed.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
            {!feed.isLoading && !feedItems.length && <p className="pb-6 text-center text-sm text-surface-400">Сообщений пока нет</p>}
            {feedItems.map((m, i) => (
              <Fragment key={m.id}>
                {timeBreak(feedItems[i - 1], m) && (
                  <div className="pb-1 pt-4 text-center text-[12px] font-medium text-surface-400">{dayLabel(m.sentAt)} {clockTime(m.sentAt)}</div>
                )}
                {m.id === dividerId && (
                  <div data-divider className="flex items-center gap-3 pb-1 pt-3" role="separator" aria-label="Новые сообщения">
                    <span className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
                    <span className="text-[12px] font-semibold text-[#0095f6]">Новые сообщения</span>
                    <span className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
                  </div>
                )}
                <MessageItem
                  m={m}
                  meId={user?.id}
                  canDeleteNote={m.direction === 'note' && !m.id.startsWith('pending:') && (m.author?.id === user?.id || isTop)}
                  canRetry={canReplyHere || m.direction === 'note'}
                  onRetry={mid => (mid.startsWith('pending:') ? retryPending(mid.slice(8)) : retry.mutate(mid))}
                  onDismiss={m.id.startsWith('pending:') ? () => dismissPending(m.id.slice(8)) : undefined}
                  onDeleteNote={nid => removeNote.mutate(nid)}
                  retrying={retry.isPending}
                  canAct={canAct}
                  onReply={onReply}
                  onReact={onReact}
                  onJump={jumpTo}
                  onOpenMedia={openMedia}
                  onMenu={onMessageMenu}
                  highlighted={highlight === m.id}
                  mentionNames={mentionNames}
                  touch={touch}
                  group={groupOf(feedItems, i, dividerId)}
                  avatar={avatar}
                  caption={m.id === lastOutId ? statusCaption(m, user?.id) : null}
                />
              </Fragment>
            ))}
          </div>
          {!atBottom && (
            <button type="button" onClick={toBottom}
              className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-surface-800 shadow-[0_2px_12px_rgba(0,0,0,0.18)] hover:text-surface-950 dark:bg-surface-800 dark:text-surface-100 sm:right-5"
              aria-label={unseen ? `Вниз, новых сообщений: ${unseen}` : 'Вниз, к последним сообщениям'} title="К последним сообщениям">
              <ArrowDown size={20} />
              {unseen > 0 && (
                <span className="absolute -right-1 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#0095f6] px-1 text-[11px] font-bold text-white">{unseen > 99 ? '99+' : unseen}</span>
              )}
            </button>
          )}
        </div>

        <Composer
          ref={composer}
          conversationId={id}
          blockedReason={blockedReason}
          readOnlyReason={readOnlyReason}
          igLink={igLink}
          contactName={c.contact.name}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSendText={text => { const reply = replyTo; setReplyTo(null); enqueue({ kind: 'text', text, replyTo: reply }) }}
          onSendFiles={sendFiles}
          onSendVoice={blob => enqueue({ kind: 'voice', text: '', blob, previewUrl: URL.createObjectURL(blob) })}
          onAddNote={(text, mentions) => enqueue({ kind: 'note', text, mentions })}
          team={team ?? []}
        />

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary-400 bg-white/90 text-center dark:bg-surface-900/90">
            <Upload size={28} className="text-primary-600 dark:text-primary-300" />
            <p className="text-sm font-medium text-surface-800 dark:text-surface-100">
              {dropAllowed ? 'Отпустите — файлы прикрепятся к ответу' : 'Сейчас клиенту написать нельзя'}
            </p>
            {dropAllowed && <p className="text-xs text-surface-500">Фото JPG/PNG, видео MP4/MOV, PDF — до 10 за раз</p>}
          </div>
        )}
      </div>

      {wide && panelOpen && (
        <aside className="w-[320px] shrink-0 border-l border-surface-200 dark:border-surface-700" aria-label="Карточка клиента">{panel}</aside>
      )}
      {!wide && drawer && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onMouseDown={e => { if (e.target === e.currentTarget) setDrawer(false) }}>
          <div className="h-full w-[min(380px,100%)] shadow-modal">{panel}</div>
        </div>
      )}

      {menu && (
        <ChatMenu c={c} anchor={menu} onClose={() => setMenu(null)} onMarkedUnread={onBack}
          onOpenCard={wide ? undefined : () => setDrawer(true)}
          onSearch={phone ? () => setSearching(true) : undefined}
          onCreateLead={!c.lead && canCreateLead && canReplyHere ? () => setShowLead(true) : undefined} />
      )}
      {sheet && (
        <MessageSheet m={sheet.m} rect={sheet.rect}
          canHeart={canAct && sheet.m.direction === 'in' && !sheet.m.id.startsWith('pending:')}
          canQuote={canAct && canQuote(sheet.m)}
          canDelete={false}
          onHeart={() => react.mutate({ m: sheet.m, on: !sheet.m.ourReaction })}
          onReply={() => setReplyTo(sheet.m)}
          onCopy={() => {
            navigator.clipboard?.writeText(sheet.m.text || '').then(() => toast.success('Текст скопирован'), () => toast.error('Не удалось скопировать'))
          }}
          onDelete={() => undefined}
          onClose={() => setSheet(null)} />
      )}
      {lightbox && <Lightbox items={lightbox.items} index={lightbox.index} onIndex={i => setLightbox(l => (l ? { ...l, index: i } : l))} onClose={() => setLightbox(null)} />}

      {showLead && (
        <ClientForm
          prefill={prefill}
          title="Новый лид из Директа"
          onClose={() => setShowLead(false)}
          onSubmit={(data, opts) => createLead.mutateAsync({ data, force: opts?.force })}
          loading={createLead.isPending}
        />
      )}
    </div>
  )
}
