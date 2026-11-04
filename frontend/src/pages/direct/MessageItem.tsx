import clsx from 'clsx'
import { AlertCircle, Check, CheckCheck, Clock, ExternalLink, FileText, RotateCcw, StickyNote, Trash2, X } from 'lucide-react'
import { apiUrl, FAILURE_TEXT, type DirectAttachment, type DirectMessage } from '@/services/direct.api'
import { clockTime } from './directTime'

const formatSize = (bytes: number | null) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

const KIND_TITLE: Record<string, string> = {
  share: 'Публикация', reel: 'Reels', story: 'Сторис', sticker: 'Стикер', video: 'Видео', image: 'Фото', audio: 'Голосовое', file: 'Файл',
}

/** Вложение: фото и стикеры — картинкой, видео и голосовые — плеером,
 *  PDF — карточкой файла. Не сохранилось — ссылка на оригинал. */
function Attachment({ a, mine }: { a: DirectAttachment; mine: boolean }) {
  const src = apiUrl(a.url)
  const isImage = a.mimeType?.startsWith('image/') || (!a.mimeType && (a.kind === 'image' || a.kind === 'sticker'))
  const isVideo = a.mimeType?.startsWith('video/')
  const isAudio = a.mimeType?.startsWith('audio/') || a.kind === 'audio'

  if (a.kind === 'unsupported') {
    return <p className="text-[13px] italic opacity-80">Этот тип сообщения Instagram показывает только в своём приложении.</p>
  }
  if (src && isImage) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        <img src={src} alt={KIND_TITLE[a.kind] || 'Фото'} loading="lazy"
          className={clsx('rounded-lg object-cover', a.kind === 'sticker' ? 'max-h-32 max-w-[128px]' : 'max-h-72 max-w-full sm:max-w-[280px]')} />
      </a>
    )
  }
  if (src && isVideo) {
    return <video src={src} controls preload="metadata" className="max-h-80 max-w-full rounded-lg sm:max-w-[300px]" />
  }
  if (src && isAudio) {
    return <audio src={src} controls preload="metadata" className="h-10 w-64 max-w-full" />
  }
  if (src) {
    return (
      <a href={src} target="_blank" rel="noreferrer"
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
    <a href={a.link || 'https://www.instagram.com/direct/inbox/'} target="_blank" rel="noreferrer"
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

export default function MessageItem({ m, meId, canDeleteNote, onRetry, onDismiss, onDeleteNote, retrying }: {
  m: DirectMessage
  meId?: string
  canDeleteNote: boolean
  onRetry: (id: string) => void
  /** Только у временного пузыря, который не дошёл до сервера: убрать его. */
  onDismiss?: () => void
  onDeleteNote: (id: string) => void
  retrying: boolean
}) {
  const failedRow = (text: string, canRetry: boolean) => (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-[12px] text-red-600 dark:text-red-400">
      <AlertCircle size={13} className="shrink-0" />
      <span>{text}</span>
      {canRetry && (
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

  if (m.direction === 'note') {
    return (
      <div className="mx-auto my-1 w-full max-w-[560px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-surface-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-surface-100">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          <StickyNote size={12} /> Заметка для команды · {m.author?.id === meId ? 'вы' : m.author?.name || 'Сотрудник'} · {clockTime(m.sentAt)}
          {canDeleteNote && (
            <button type="button" onClick={() => onDeleteNote(m.id)} className="ml-auto rounded p-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20" aria-label="Удалить заметку" title="Удалить заметку">
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-snug">{m.text}</p>
        {m.errorText && failedRow(`Не сохранилось: ${m.errorText}`, true)}
      </div>
    )
  }

  const mine = m.direction === 'out'
  const failed = m.status === 'failed'
  return (
    <div className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={clsx('relative max-w-[85%] sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        <div
          className={clsx(
            'rounded-2xl px-3 py-2 text-[14px] leading-snug shadow-sm',
            mine
              ? failed
                ? 'rounded-br-md border border-red-300 bg-red-50 text-surface-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-surface-100'
                : 'rounded-br-md bg-primary-600 text-white'
              : 'rounded-bl-md bg-surface-100 text-surface-900 dark:bg-surface-700 dark:text-surface-50',
          )}
        >
          {m.deleted ? (
            <p className="italic opacity-70">Клиент удалил сообщение</p>
          ) : (
            <div className="space-y-1.5">
              {m.attachments.map(a => <Attachment key={a.id} a={a} mine={mine && !failed} />)}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
            </div>
          )}
          <div className={clsx('mt-1 flex items-center justify-end gap-1 text-[10.5px]', mine && !failed ? 'text-white/70' : 'text-surface-400')}>
            {mine && <span className="mr-1 truncate">{m.fromApp ? 'из приложения' : m.author?.id === meId ? 'вы' : m.author?.name}</span>}
            <span className="tabular-nums">{clockTime(m.sentAt)}</span>
            {mine && !failed && <StatusIcon m={m} />}
          </div>
        </div>
        {m.reaction && (
          <span className={clsx('absolute -bottom-2 rounded-full border border-surface-200 bg-white px-1 text-[13px] leading-5 shadow-sm dark:border-surface-600 dark:bg-surface-800', mine ? 'left-2' : 'right-2')}>
            {m.reaction}
          </span>
        )}
        {failed && failedRow(
          `Не доставлено: ${m.errorText || FAILURE_TEXT[m.error || ''] || FAILURE_TEXT.REJECTED}`,
          m.error !== 'WINDOW_CLOSED' && m.error !== 'UNAVAILABLE',
        )}
      </div>
    </div>
  )
}
