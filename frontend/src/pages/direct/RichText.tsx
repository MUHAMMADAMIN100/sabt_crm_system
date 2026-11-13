import { Fragment, useMemo, type ReactNode } from 'react'
import clsx from 'clsx'

/** Ссылка в тексте: http(s)://… или www.… Точка или скобка в конце — не часть ссылки. */
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"'«»]*[^\s<>"'«».,:;!?)\]}])/gi

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Текст сообщения: ссылки кликабельны (открываются в новой вкладке),
 * @Имя коллеги в заметке подсвечено. Переносы строк сохраняет родитель
 * (whitespace-pre-wrap).
 */
export default function RichText({ text, mentions, onLight }: {
  text: string
  /** Имена тех, кого можно упомянуть: «@Имя Фамилия» подсвечивается. */
  mentions?: string[]
  /** Текст на тёмном пузыре (наше сообщение) — ссылки светлые. */
  onLight?: boolean
}) {
  const mentionRe = useMemo(() => {
    const names = (mentions ?? []).filter(Boolean).sort((a, b) => b.length - a.length)
    return names.length ? new RegExp(`@(${names.map(escapeRe).join('|')})`, 'g') : null
  }, [mentions])

  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const at = match.index ?? 0
    if (at > last) parts.push(<Fragment key={`t${last}`}>{withMentions(text.slice(last, at), mentionRe, `m${last}`)}</Fragment>)
    const url = match[0]
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    parts.push(
      <a key={`u${at}`} href={href} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className={clsx('break-all underline underline-offset-2', onLight ? 'text-white decoration-white/60 hover:decoration-white' : 'text-primary-700 decoration-primary-400/60 hover:decoration-primary-600 dark:text-primary-300')}>
        {url}
      </a>,
    )
    last = at + url.length
  }
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{withMentions(text.slice(last), mentionRe, `m${last}`)}</Fragment>)
  return <>{parts}</>
}

function withMentions(chunk: string, re: RegExp | null, key: string): ReactNode {
  if (!re) return chunk
  const out: ReactNode[] = []
  let last = 0
  for (const match of chunk.matchAll(re)) {
    const at = match.index ?? 0
    if (at > last) out.push(chunk.slice(last, at))
    out.push(<span key={`${key}-${at}`} className="rounded bg-primary-100 px-0.5 font-medium text-primary-800 dark:bg-primary-500/20 dark:text-primary-200">{match[0]}</span>)
    last = at + match[0].length
  }
  if (last < chunk.length) out.push(chunk.slice(last))
  return out
}
