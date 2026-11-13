import { memo, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import {
  AlertCircle, Check, CheckCheck, Clock, Copy, CornerUpLeft, ExternalLink, FileText, Heart, RotateCcw, StickyNote, Trash2,
  User as UserIcon, X,
} from 'lucide-react'
import { apiUrl, FAILURE_TEXT, type DirectAttachment, type DirectMessage } from '@/services/direct.api'
import { clockTime } from './directTime'
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

/** Вложение: фото и стикеры — картинкой (клик — на весь экран), видео и
 *  голосовые — плеером, PDF — карточкой файла. Не сохранилось — ссылка на оригинал. */
function Attachment({ a, mine, onOpen }: { a: DirectAttachment; mine: boolean; onOpen?: (id: string) => void }) {
  const src = apiUrl(a.url)
  const isVideo = a.mimeType?.startsWith('video/')
  const isAudio = a.mimeType?.startsWith('audio/') || a.kind === 'audio'

  if (a.kind === 'unsupported') {
    return <p className="text-[13px] italic opacity-80">Этот тип сообщения Instagram показывает только в своём приложении.</p>
  }
  if (src && isPictureAttachment(a)) {
    const img = (
      <img src={src} alt={KIND_TITLE[a.kind] || 'Фото'} loading="lazy"
        className={clsx('rounded-lg object-cover', a.kind === 'sticker' ? 'max-h-32 max-w-[128px]' : 'max-h-72 max-w-full sm:max-w-[280px]')} />
    )
    // Ещё не ушедший на сервер файл (blob:) открывать негде — просто картинка.
    return onOpen && !src.startsWith('blob:')
      ? <button type="button" onClick={e => { e.stopPropagation(); onOpen(a.id) }} className="block cursor-zoom-in" aria-label="Открыть фото на весь экран">{img}</button>
      : <div>{img}</div>
  }
  if (src && isVideo) {
    return <video src={src} controls preload="metadata" className="max-h-80 max-w-full rounded-lg sm:max-w-[300px]" />
  }
  if (src && isAudio) {
    return <audio src={src} controls preload="metadata" className="h-10 w-64 max-w-full" />
  }
  if (src) {
    return (
      <a href={src} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        className={clsx('flex items-center gap-2.5 rounded-lg px-3 py-2', mine ? 'bg-white/10 hover:bg-white/15' : 'bg-surface-50 hover:bg-white dark:bg-surface-800 dark:hover:bg-surface-900')}>
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
      className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium', mine ? 'bg-white/10' : 'bg-surface-50 dark:bg-surface-800')}>
      <ExternalLink size={14} /> {KIND_TITLE[a.kind] || 'Вложение'} — открыть в Instagram
    </a>
  )
}

function StatusIcon({ m }: { m: DirectMessage }) {
  if (m.status === 'sending') return <Clock size={12} aria-label="Отправляется" />
  if (m.status === 'read') return <CheckCheck size={13} aria-label="Прочитано" />
  if (m.status === 'sent') return <Check size={13} aria-label="Отправлено" />
  return null
}

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches

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

function MessageItem({
  m, meId, canDeleteNote, canRetry = true, onRetry, onDismiss, onDeleteNote, retrying,
  canAct = false, onReply, onReact, onJump, onOpenMedia, highlighted, mentionNames,
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
  /** Подсветка: сюда перешли из поиска или по цитате. */
  highlighted?: boolean
  /** Имена коллег — подсветка @упоминаний в заметках. */
  mentionNames?: string[]
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Меню на телефоне открывается касанием и закрывается касанием мимо.
  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const failedRow = (text: string, retryable: boolean) => (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-[12px] text-red-600 dark:text-red-400">
      <AlertCircle size={13} className="shrink-0" />
      <span>{text}</span>
      {retryable && canRetry && (
        <button type="button" onClick={() => onRetry(m.id)} disabled={retrying}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-700">
          <RotateCcw size={12} /> Повторить
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Убрать сообщение" title="Убрать"
          className="inline-flex items-center rounded-md p-0.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">
          <X size={13} />
        </button>
      )}
    </div>
  )

  // Отметка «чат закреплён / передан / освобождён» — серой строкой по центру.
  if (m.direction === 'event') {
    const actor = m.author && !(m.text || '').includes(m.author.name) ? (m.author.id === meId ? 'вы' : m.author.name) : null
    return (
      <div className="flex justify-center py-0.5" data-mid={m.id}>
        <span className="inline-flex max-w-full items-start gap-1.5 rounded-2xl bg-surface-100 px-3 py-1 text-[11.5px] leading-snug text-surface-600 dark:bg-surface-800 dark:text-surface-300">
          <UserIcon size={12} className="mt-px shrink-0" aria-hidden />
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
      <div data-mid={m.id} className={clsx('mx-auto my-1 w-full max-w-[560px] rounded-xl border bg-amber-50 px-3 py-2 text-surface-800 transition-shadow dark:bg-amber-500/10 dark:text-surface-100',
        highlighted ? 'border-primary-500 ring-2 ring-primary-500/40' : 'border-amber-200 dark:border-amber-500/25')}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          <StickyNote size={12} /> Заметка для команды · {m.author?.id === meId ? 'вы' : m.author?.name || 'Сотрудник'} · {clockTime(m.sentAt)}
          <span className="ml-auto flex items-center gap-0.5">
            {m.text && (
              <button type="button" onClick={() => copyText(m.text!)} className="rounded p-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20" aria-label="Скопировать заметку" title="Скопировать">
                <Copy size={12} />
              </button>
            )}
            {canDeleteNote && (
              <button type="button" onClick={() => onDeleteNote(m.id)} className="rounded p-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20" aria-label="Удалить заметку" title="Удалить заметку">
                <Trash2 size={12} />
              </button>
            )}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-snug"><RichText text={m.text || ''} mentions={mentionNames} /></p>
        {m.errorText && failedRow(`Не сохранилось: ${m.errorText}`, true)}
      </div>
    )
  }

  const mine = m.direction === 'out'
  const failed = m.status === 'failed'
  const quote = canQuote(m) && canAct && !!onReply
  const heart = m.direction === 'in' && !m.deleted && canAct && !!onReact && !m.id.startsWith('pending:')
  const copy = !!m.text && !m.deleted
  const hasActions = quote || heart || copy
  const reactions = [m.reaction, m.ourReaction].filter(Boolean) as string[]
  const replyWho = m.replyTo
    ? m.replyTo.direction === 'in' ? 'Клиент' : m.replyTo.direction === 'out' ? (m.replyTo.author || 'Агентство') : 'Сообщение'
    : ''

  const actions = hasActions && (
    <div className={clsx('flex shrink-0 items-center gap-0.5 self-center rounded-full border border-surface-200 bg-white p-0.5 shadow-sm transition-opacity dark:border-surface-600 dark:bg-surface-800',
      open ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100')}>
      {quote && (
        <button type="button" onClick={() => { setOpen(false); onReply!(m) }} className="rounded-full p-1.5 text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-700 dark:hover:text-surface-100" aria-label="Ответить на сообщение" title="Ответить">
          <CornerUpLeft size={15} />
        </button>
      )}
      {heart && (
        <button type="button" onClick={() => { setOpen(false); onReact!(m, !m.ourReaction) }}
          className={clsx('rounded-full p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700', m.ourReaction ? 'text-pink-600' : 'text-surface-500 hover:text-pink-600')}
          aria-label={m.ourReaction ? 'Убрать ❤️' : 'Поставить ❤️'} title={m.ourReaction ? 'Убрать ❤️' : '❤️ (или двойной щелчок)'}>
          <Heart size={15} fill={m.ourReaction ? 'currentColor' : 'none'} />
        </button>
      )}
      {copy && (
        <button type="button" onClick={() => { setOpen(false); void copyText(m.text!) }} className="rounded-full p-1.5 text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-700 dark:hover:text-surface-100" aria-label="Скопировать текст" title="Скопировать">
          <Copy size={15} />
        </button>
      )}
    </div>
  )

  return (
    <div ref={box} data-mid={m.id} className={clsx('group flex items-center gap-1.5', mine ? 'justify-end' : 'justify-start', reactions.length > 0 && 'mb-2')}>
      {mine && actions}
      <div className={clsx('relative max-w-[85%] sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        <div
          onClick={() => { if (hasActions && isTouch()) setOpen(v => !v) }}
          onDoubleClick={() => { if (heart) onReact!(m, !m.ourReaction) }}
          className={clsx(
            'rounded-2xl px-3 py-2 text-[14px] leading-snug shadow-sm transition-shadow',
            mine
              ? failed
                ? 'rounded-br-md border border-red-300 bg-red-50 text-surface-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-surface-100'
                : 'rounded-br-md bg-primary-600 text-white'
              : 'rounded-bl-md bg-surface-100 text-surface-900 dark:bg-surface-700 dark:text-surface-50',
            highlighted && 'ring-2 ring-primary-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-900',
          )}
        >
          {m.replyTo && !m.deleted && (
            <button type="button" disabled={!m.replyTo.id || !onJump}
              onClick={e => { e.stopPropagation(); if (m.replyTo?.id) onJump?.(m.replyTo.id) }}
              className={clsx('mb-1.5 block w-full min-w-[120px] rounded-lg border-l-[3px] px-2 py-1 text-left text-[12px] leading-snug disabled:cursor-default',
                mine && !failed ? 'border-white/70 bg-white/15 hover:bg-white/20' : 'border-primary-500 bg-white/70 hover:bg-white dark:bg-surface-800/70 dark:hover:bg-surface-800')}
              title={m.replyTo.id ? 'Перейти к сообщению' : undefined}>
              <span className="block font-semibold opacity-90">{replyWho}</span>
              <span className="line-clamp-2 opacity-80">{m.replyTo.preview}</span>
            </button>
          )}
          {m.deleted ? (
            <p className="italic opacity-70">Клиент удалил сообщение</p>
          ) : (
            <div className="space-y-1.5">
              {m.attachments.map(a => <Attachment key={a.id} a={a} mine={mine && !failed} onOpen={onOpenMedia} />)}
              {m.text && <p className="whitespace-pre-wrap break-words"><RichText text={m.text} onLight={mine && !failed} /></p>}
            </div>
          )}
          <div className={clsx('mt-1 flex items-center justify-end gap-1 text-[10.5px]', mine && !failed ? 'text-white/70' : 'text-surface-400')}>
            {mine && <span className="mr-1 truncate">{m.fromApp ? 'из приложения' : m.author?.id === meId ? 'вы' : m.author?.name}</span>}
            <span className="tabular-nums">{clockTime(m.sentAt)}</span>
            {mine && !failed && <StatusIcon m={m} />}
          </div>
        </div>
        {reactions.length > 0 && (
          <span className={clsx('absolute -bottom-2.5 rounded-full border border-surface-200 bg-white px-1 text-[13px] leading-5 shadow-sm dark:border-surface-600 dark:bg-surface-800', mine ? 'left-2' : 'right-2')}
            title={m.ourReaction && m.direction === 'in' ? 'Реакция агентства' : 'Реакция клиента'}>
            {reactions.join('')}
          </span>
        )}
        {failed && failedRow(
          `Не доставлено: ${m.errorText || FAILURE_TEXT[m.error || ''] || FAILURE_TEXT.REJECTED}`,
          m.error !== 'WINDOW_CLOSED' && m.error !== 'UNAVAILABLE',
        )}
      </div>
      {!mine && actions}
    </div>
  )
}

export default memo(MessageItem)
