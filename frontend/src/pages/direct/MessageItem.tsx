import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import {
  AlertCircle, Clock, Copy, CornerUpLeft, ExternalLink, FileText, Heart, MoreHorizontal, Pause, Play, RotateCcw, StickyNote, Trash2,
  User as UserIcon, X,
} from 'lucide-react'
import { apiUrl, FAILURE_TEXT, type DirectAttachment, type DirectMessage } from '@/services/direct.api'
import { clockTime, dayLabel } from './directTime'
import RichText from './RichText'

const formatSize = (bytes: number | null) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

const KIND_TITLE: Record<string, string> = {
  share: 'Публикация', reel: 'Reels', story: 'Сторис', sticker: 'Стикер', video: 'Видео', image: 'Фото', audio: 'Голосовое', file: 'Файл',
}

/** Можно ли показать вложение картинкой (и открыть на весь экран). */
export const isPictureAttachment = (a: DirectAttachment) =>
  !!a.url && (a.mimeType?.startsWith('image/') || (!a.mimeType && (a.kind === 'image' || a.kind === 'sticker')))

const isVideoAttachment = (a: DirectAttachment) => !!a.url && !!a.mimeType?.startsWith('video/')
const isAudioAttachment = (a: DirectAttachment) => !!a.url && (!!a.mimeType?.startsWith('audio/') || a.kind === 'audio')

/** Одни эмодзи (до трёх) — как в Instagram, крупно и без пузыря. */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|⃣|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*){1,3}$/u
export const isEmojiOnly = (text: string | null | undefined) => {
  const t = (text || '').replace(/\s+/g, '')
  return !!t && t.length <= 24 && EMOJI_ONLY.test(t)
}

const fmtSec = (s: number) => {
  const v = Number.isFinite(s) && s > 0 ? Math.round(s) : 0
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

/** Голосовое как в Instagram: кнопка, «волна» с прогрессом, время. */
function VoicePlayer({ src, mine }: { src: string; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const fixing = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [dur, setDur] = useState(0)
  const [pos, setPos] = useState(0)
  // «Волна» постоянная для файла — из его адреса, без разбора звука.
  const bars = useMemo(() => {
    let h = 0
    for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0
    return Array.from({ length: 26 }, () => {
      h = (h * 1103515245 + 12345) >>> 0
      return 0.28 + ((h >>> 8) % 1000) / 1000 * 0.72
    })
  }, [src])
  const progress = dur > 0 ? Math.min(1, pos / dur) : 0

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) {
      // Играет одно голосовое за раз.
      document.querySelectorAll('audio').forEach(x => { if (x !== a) x.pause() })
      void a.play().catch(() => toast.error('Не получилось воспроизвести'))
    } else a.pause()
  }
  const seek = (clientX: number, el: HTMLElement) => {
    const a = audio.current
    if (!a || !dur) return
    const r = el.getBoundingClientRect()
    a.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur
    setPos(a.currentTime)
  }

  return (
    <div className="flex w-[228px] max-w-full items-center gap-2.5 py-0.5">
      <button type="button" onClick={e => { e.stopPropagation(); toggle() }}
        className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          mine ? 'bg-white/20 text-white' : 'bg-surface-900/10 text-surface-900 dark:bg-white/15 dark:text-white')}
        aria-label={playing ? 'Пауза' : 'Слушать голосовое'}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
      </button>
      <div role="slider" aria-label="Перемотка голосового" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)} tabIndex={-1}
        className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
        onClick={e => { e.stopPropagation(); seek(e.clientX, e.currentTarget) }}>
        {bars.map((b, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-current transition-opacity"
            style={{ height: `${Math.round(b * 100)}%`, opacity: (i + 0.5) / bars.length <= progress ? 1 : 0.4 }} />
        ))}
      </div>
      <span className={clsx('shrink-0 text-[12px] tabular-nums', mine ? 'text-white/85' : 'text-surface-500 dark:text-surface-300')}>
        {fmtSec(playing || pos > 0 ? pos : dur)}
      </span>
      <audio ref={audio} src={src} preload="metadata" className="hidden"
        onLoadedMetadata={e => {
          const a = e.currentTarget
          // Запись из браузера (webm) не знает длину, пока её не «промотать».
          if (a.duration === Infinity) { fixing.current = true; a.currentTime = 1e101 } else setDur(a.duration)
        }}
        onDurationChange={e => {
          const a = e.currentTarget
          if (Number.isFinite(a.duration)) {
            setDur(a.duration)
            if (fixing.current) { fixing.current = false; a.currentTime = 0 }
          }
        }}
        onTimeUpdate={e => { if (!fixing.current) setPos(e.currentTarget.currentTime) }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={e => { setPlaying(false); setPos(0); e.currentTarget.currentTime = 0 }} />
    </div>
  )
}

/** Вложение: фото и стикеры — картинкой (клик — на весь экран), видео —
 *  плеером, голосовое — как в Instagram, PDF — карточкой файла. Не
 *  сохранилось — ссылка на оригинал. */
function Attachment({ a, mine, onOpen }: { a: DirectAttachment; mine: boolean; onOpen?: (id: string) => void }) {
  const src = apiUrl(a.url)

  if (a.kind === 'unsupported') {
    return <p className="text-[13px] italic opacity-80">Этот тип сообщения Instagram показывает только в своём приложении.</p>
  }
  if (src && isPictureAttachment(a)) {
    const img = (
      <img src={src} alt={KIND_TITLE[a.kind] || 'Фото'} loading="lazy" draggable={false}
        className={clsx('block object-cover', a.kind === 'sticker' ? 'max-h-32 max-w-[128px]' : 'max-h-80 max-w-full sm:max-w-[300px]')} />
    )
    // Ещё не ушедший на сервер файл (blob:) открывать негде — просто картинка.
    return onOpen && !src.startsWith('blob:')
      ? <button type="button" onClick={e => { e.stopPropagation(); onOpen(a.id) }} className="block cursor-zoom-in" aria-label="Открыть фото на весь экран">{img}</button>
      : <div>{img}</div>
  }
  if (src && isVideoAttachment(a)) {
    return <video src={src} controls playsInline preload="metadata" className="block max-h-80 max-w-full bg-black sm:max-w-[300px]" />
  }
  if (src && isAudioAttachment(a)) return <VoicePlayer src={src} mine={mine} />
  if (src) {
    return (
      <a href={src} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        className={clsx('flex items-center gap-2.5 rounded-xl px-3 py-2', mine ? 'bg-white/15 hover:bg-white/20' : 'bg-white/70 hover:bg-white dark:bg-surface-900/50 dark:hover:bg-surface-900')}>
        <FileText size={20} className="shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{a.name || 'Документ'}</span>
          <span className="block text-[11px] opacity-70">{formatSize(a.size) || 'PDF'}</span>
        </span>
      </a>
    )
  }
  // Файл не сохранился (или это публикация по ссылке) — ведём в Instagram.
  return (
    <a href={a.link || 'https://www.instagram.com/direct/inbox/'} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      className={clsx('inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium', mine ? 'bg-white/15' : 'bg-white/70 dark:bg-surface-900/50')}>
      <ExternalLink size={14} /> {KIND_TITLE[a.kind] || 'Вложение'} — открыть в Instagram
    </a>
  )
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Текст скопирован')
  } catch {
    toast.error('Браузер не дал скопировать — выделите текст вручную')
  }
}

/** Можно ли ответить на сообщение цитатой: Instagram должен знать его (mid). */
export const canQuote = (m: DirectMessage) =>
  !m.deleted && !m.id.startsWith('pending:') && (m.direction === 'in' || (m.direction === 'out' && (m.status === 'sent' || m.status === 'read')))

/**
 * Сообщение в ленте — как в Instagram на любом экране (16.11.2026):
 * подряд идущие слиты в группу (у стыков углы острее), аватар клиента у
 * последнего, наши — градиентом, цитата — над пузырём, одни эмодзи — крупно.
 * Телефон: жесты (ответ свайпом, меню долгим нажатием, ❤️ двойным тапом,
 * время — свайпом ленты влево) — в useFeedGestures по data-mid / data-swipe /
 * data-bubble. Компьютер: при наведении — время, ❤️, «Ответить», «Ещё»;
 * правый щелчок — меню, двойной щелчок — ❤️.
 */
function MessageItem({
  m, meId, canDeleteNote, canRetry = true, onRetry, onDismiss, onDeleteNote, retrying,
  canAct = false, onReply, onReact, onJump, onOpenMedia, onMenu, highlighted, mentionNames,
  touch = false, group, avatar, caption,
}: {
  m: DirectMessage
  meId?: string
  canDeleteNote: boolean
  /** Писать клиенту можно (свой или свободный чат) — тогда и «Повторить». */
  canRetry?: boolean
  onRetry: (id: string) => void
  /** Только у временного пузыря, который не дошёл до сервера: убрать его. */
  onDismiss?: () => void
  onDeleteNote: (id: string) => void
  retrying: boolean
  /** Можно отвечать и ставить ❤️: свой или свободный чат, окно 24 часов открыто. */
  canAct?: boolean
  onReply?: (m: DirectMessage) => void
  onReact?: (m: DirectMessage, on: boolean) => void
  /** Клик по цитате — к сообщению, на которое ответили. */
  onJump?: (messageId: string) => void
  onOpenMedia?: (attachmentId: string) => void
  /** Меню сообщения (правый щелчок, «Ещё»): где пузырь на экране. */
  onMenu?: (m: DirectMessage, rect: DOMRect) => void
  /** Подсветка: сюда перешли из поиска или по цитате. */
  highlighted?: boolean
  /** Имена коллег — подсветка @упоминаний в заметках. */
  mentionNames?: string[]
  /** Сенсорный экран: жесты вместо панели при наведении. */
  touch?: boolean
  /** Место в группе подряд идущих сообщений одной стороны. */
  group?: { first: boolean; last: boolean }
  /** Аватар клиента — у последнего сообщения его группы. */
  avatar?: ReactNode
  /** Подпись под сообщением: «Просмотрено», кто написал. */
  caption?: string | null
}) {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const pending = m.id.startsWith('pending:')

  const failedRow = (text: string, retryable: boolean, mine: boolean) => (
    <div className={clsx('mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-snug text-red-600 dark:text-red-400', mine ? 'justify-end pr-1 text-right' : 'pl-9')}>
      <span className="min-w-0">
        <AlertCircle size={13} className="-mt-0.5 mr-1 inline-block align-middle" aria-hidden />
        {text}
      </span>
      {retryable && canRetry && (
        <button type="button" onClick={() => onRetry(m.id)} disabled={retrying}
          className="inline-flex min-h-[28px] items-center gap-1 rounded-full px-2 py-0.5 font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-700">
          <RotateCcw size={12} /> Повторить
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Убрать сообщение" title="Убрать"
          className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-full text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">
          <X size={13} />
        </button>
      )}
    </div>
  )

  // Отметка «чат закреплён / передан / освобождён» — серой строкой по центру.
  if (m.direction === 'event') {
    const actor = m.author && !(m.text || '').includes(m.author.name) ? (m.author.id === meId ? 'вы' : m.author.name) : null
    return (
      <div className="flex justify-center py-2" data-mid={m.id}>
        <span className="inline-flex max-w-full items-start gap-1.5 px-3 text-center text-[12px] leading-snug text-surface-500 dark:text-surface-400">
          <UserIcon size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {m.text}
            <span className="text-surface-400">{actor ? ` · ${actor}` : ''} · {clockTime(m.sentAt)}</span>
          </span>
        </span>
      </div>
    )
  }

  if (m.direction === 'note') {
    return (
      <div data-mid={m.id} className={clsx('mx-auto my-2.5 w-full max-w-[560px] rounded-2xl border bg-amber-50 px-3.5 py-2.5 text-surface-800 transition-shadow dark:bg-amber-500/10 dark:text-surface-100',
        highlighted ? 'border-primary-500 ring-2 ring-primary-500/40' : 'border-amber-200 dark:border-amber-500/25')}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-800 dark:text-amber-300">
          <StickyNote size={12} className="shrink-0" />
          <span className="min-w-0 truncate">Заметка для команды · {m.author?.id === meId ? 'вы' : m.author?.name || 'Сотрудник'} · {clockTime(m.sentAt)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {m.text && (
              <button type="button" onClick={() => copyText(m.text!)} className="flex h-7 w-7 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20" aria-label="Скопировать заметку" title="Скопировать">
                <Copy size={13} />
              </button>
            )}
            {canDeleteNote && (
              <button type="button" onClick={() => onDeleteNote(m.id)} className="flex h-7 w-7 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20" aria-label="Удалить заметку" title="Удалить заметку">
                <Trash2 size={13} />
              </button>
            )}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug"><RichText text={m.text || ''} mentions={mentionNames} /></p>
        {m.errorText && failedRow(`Не сохранилось: ${m.errorText}`, true, false)}
      </div>
    )
  }

  const mine = m.direction === 'out'
  const failed = m.status === 'failed'
  const g = group ?? { first: true, last: true }
  const reactions = [m.reaction, m.ourReaction].filter(Boolean) as string[]
  const media = !m.deleted && !m.text && m.attachments.length > 0 && m.attachments.every(a => isPictureAttachment(a) || isVideoAttachment(a))
  const bigEmoji = !m.deleted && !m.attachments.length && isEmojiOnly(m.text)
  const plain = media || bigEmoji
  const gradient = mine && !failed && !plain
  // Подпись автора — только если писал не я (коллега или из приложения).
  const who = mine ? (m.fromApp ? 'из приложения' : m.author && m.author.id !== meId ? m.author.name.split(' ')[0] : null) : null
  const quote = canQuote(m) && canAct && !!onReply
  const heart = m.direction === 'in' && !m.deleted && canAct && !!onReact && !pending
  const menu = !m.deleted && !pending && !!onMenu
  const corners = mine
    ? clsx(!g.first && 'rounded-tr-[5px]', !g.last && 'rounded-br-[5px]')
    : clsx(!g.first && 'rounded-tl-[5px]', !g.last && 'rounded-bl-[5px]')

  const replyCaption = m.replyTo
    ? mine
      ? m.replyTo.direction === 'in' ? 'Ответ на сообщение клиента' : `Ответ на сообщение${m.replyTo.author ? ` · ${m.replyTo.author.split(' ')[0]}` : ' агентства'}`
      : m.replyTo.direction === 'out' ? 'Клиент ответил на ваше сообщение' : 'Клиент ответил на своё сообщение'
    : ''

  // Компьютер: при наведении — время и действия рядом с пузырём.
  const hoverBar = !touch && (
    <div className={clsx('pointer-events-none absolute top-1/2 z-[1] flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap opacity-0 transition-opacity',
      'group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100',
      mine ? 'right-full mr-1.5 flex-row-reverse' : 'left-full ml-1.5')}>
      <span className="px-1 text-[11px] tabular-nums text-surface-400" title={`${dayLabel(m.sentAt)}, ${clockTime(m.sentAt)}`}>{clockTime(m.sentAt)}</span>
      {heart && (
        <button type="button" onClick={() => onReact!(m, !m.ourReaction)}
          className={clsx('flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-100 dark:hover:bg-surface-800', m.ourReaction ? 'text-[#ff3040]' : 'text-surface-500 hover:text-[#ff3040]')}
          aria-label={m.ourReaction ? 'Убрать ❤️' : 'Поставить ❤️'} title={m.ourReaction ? 'Убрать ❤️' : '❤️ (или двойной щелчок)'}>
          <Heart size={16} fill={m.ourReaction ? 'currentColor' : 'none'} />
        </button>
      )}
      {quote && (
        <button type="button" onClick={() => onReply!(m)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-800 dark:hover:text-surface-100"
          aria-label="Ответить на сообщение" title="Ответить">
          <CornerUpLeft size={16} />
        </button>
      )}
      {menu && (
        <button type="button" onClick={() => { const r = bubbleRef.current?.getBoundingClientRect(); if (r) onMenu!(m, r) }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-800 dark:hover:text-surface-100"
          aria-label="Ещё" title="Ещё: копировать, ответить">
          <MoreHorizontal size={16} />
        </button>
      )}
    </div>
  )

  return (
    <div data-mid={m.id} className={clsx('group/msg', g.first ? 'mt-3' : 'mt-[3px]', reactions.length > 0 && 'mb-3.5')}>
      {m.replyTo && !m.deleted && (
        <div className={clsx('mb-1 flex flex-col', mine ? 'items-end pr-1' : 'items-start pl-9')}>
          <span className="mb-1 inline-flex items-center gap-1 text-[11.5px] text-surface-400">
            <CornerUpLeft size={11} aria-hidden /> {replyCaption}
          </span>
          <button type="button" disabled={!m.replyTo.id || !onJump}
            onClick={e => { e.stopPropagation(); if (m.replyTo?.id) onJump?.(m.replyTo.id) }}
            className={clsx('flex max-w-[min(70%,420px)] items-stretch gap-2 text-left disabled:cursor-default', mine && 'flex-row-reverse')}
            title={m.replyTo.id ? 'Перейти к сообщению' : undefined}>
            <span className="w-[3px] shrink-0 rounded-full bg-surface-200 dark:bg-surface-600" aria-hidden />
            <span className="line-clamp-2 rounded-[18px] bg-surface-100/80 px-3 py-1.5 text-[13.5px] leading-snug text-surface-500 dark:bg-surface-800/80 dark:text-surface-300">
              {m.replyTo.preview}
            </span>
          </button>
        </div>
      )}
      <div data-shift className={clsx('relative flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
        {!mine && <div className="w-7 shrink-0">{g.last ? avatar : null}</div>}
        <div data-swipe className={clsx('relative min-w-0 max-w-[78%] sm:max-w-[min(70%,560px)]', m.status === 'sending' && 'opacity-75')}>
          {touch && (
            <CornerUpLeft size={18} aria-hidden style={{ opacity: 'var(--pull, 0)' }}
              className="pointer-events-none absolute -left-8 top-1/2 -translate-y-1/2 text-surface-400" />
          )}
          {hoverBar}
          <div ref={bubbleRef} data-bubble
            onDoubleClick={!touch && heart ? () => onReact!(m, !m.ourReaction) : undefined}
            onContextMenu={!touch && menu ? e => { e.preventDefault(); onMenu!(m, e.currentTarget.getBoundingClientRect()) } : undefined}
            className={clsx('relative w-fit max-w-full transition-shadow', touch && 'direct-phone-bubble', mine && 'ml-auto',
              media ? 'overflow-hidden rounded-[18px] bg-surface-100 dark:bg-surface-800'
                : bigEmoji ? 'px-0.5 py-0.5 text-[44px] leading-[1.1]'
                  : clsx('rounded-[22px] px-3.5 py-[7px] text-[15px] leading-[1.38]', corners,
                    mine
                      ? failed
                        ? 'border border-red-300 bg-red-50 text-surface-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-surface-100'
                        : 'direct-out'
                      : 'bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-surface-50'),
              highlighted && 'ring-2 ring-primary-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-900')}>
            {m.deleted ? (
              <p className="italic opacity-70">Клиент удалил сообщение</p>
            ) : (
              <div className={clsx(!plain && m.attachments.length > 0 && 'space-y-1.5 py-1 [&_img]:rounded-xl [&_video]:rounded-xl')}>
                {m.attachments.map(a => <Attachment key={a.id} a={a} mine={gradient} onOpen={onOpenMedia} />)}
                {m.text && (
                  <p className="whitespace-pre-wrap break-words">
                    {bigEmoji ? m.text.trim() : <RichText text={m.text} onLight={gradient} />}
                  </p>
                )}
              </div>
            )}
          </div>
          {reactions.length > 0 && (
            <span className={clsx('direct-pop absolute -bottom-3.5 flex h-6 items-center rounded-full border-2 border-white bg-surface-100 px-1.5 text-[13px] leading-none dark:border-surface-900 dark:bg-surface-800', mine ? 'left-2' : 'right-2')}
              title={m.ourReaction && m.direction === 'in' ? 'Реакция агентства' : 'Реакция клиента'}>
              {reactions.join('')}
            </span>
          )}
        </div>
        {/* Время — за правым краем; свайп ленты влево вытягивает его. */}
        {touch && (
          <span className="pointer-events-none absolute top-1/2 w-14 -translate-y-1/2 text-left text-[11px] tabular-nums text-surface-400" style={{ right: -72 }}>
            {clockTime(m.sentAt)}
          </span>
        )}
      </div>
      {mine && m.status === 'sending' && !caption && (
        <p className="mt-0.5 flex items-center justify-end gap-1 pr-1 text-[11px] text-surface-400"><Clock size={11} /> отправляется</p>
      )}
      {caption && <p className={clsx('mt-1 text-[11.5px] text-surface-400', mine ? 'pr-1 text-right' : 'pl-9')}>{caption}</p>}
      {mine && who && !caption && g.last && !failed && m.status !== 'sending' && (
        <p className="mt-0.5 pr-1 text-right text-[11.5px] text-surface-400">{who}</p>
      )}
      {failed && failedRow(`Не доставлено: ${m.errorText || FAILURE_TEXT[m.error || ''] || FAILURE_TEXT.REJECTED}`, m.error !== 'WINDOW_CLOSED' && m.error !== 'UNAVAILABLE', mine)}
    </div>
  )
}

export default memo(MessageItem)
