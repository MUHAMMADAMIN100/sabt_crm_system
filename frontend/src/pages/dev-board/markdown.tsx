import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { devTrackerApi } from '@/services/api.service'
import type { DevTrackerPreview } from '@/services/api.service'
import { DEV_STATUS_COLORS, fmtDeadline } from './devBoardTypes'
import { taskUrl } from '@/pages/dev/devLinks'

/**
 * Markdown-lite для доски разработки: безопасный рендер без новых
 * зависимостей. Только RegExp + React, никакого dangerouslySetInnerHTML —
 * HTML из ввода экранируется самим React (строки рендерятся как текст).
 *
 * Поддержано: ```блоки кода```, `инлайн-код`, **жирный**, *курсив*,
 * [текст](https://url) (только http/https, остальное — plain-текст),
 * `- ` списки, `> ` цитаты, переносы строк.
 *
 * Плюс unfurl задач: ссылка вида /dev-board/task/<uuid> (markdown-ссылка
 * или голый URL в тексте) рендерится превью-карточкой через
 * GET /dev-tracker/preview/:id. Общий module-level кэш Map<id, preview>
 * дедуплицирует запросы между описанием и лентой комментариев (и между
 * повторными монтированиями): пока грузится или ошибка — обычная ссылка.
 */

// ── Unfurl задач /dev-board/task/<uuid> ─────────────────────────────

const TASK_UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const TASK_ID_RE = new RegExp(`/dev-board/task/(${TASK_UUID})`)
const BARE_TASK_RE = new RegExp(
  `(https?://[^\\s)]*?/dev-board/task/${TASK_UUID}[^\\s)]*|/dev-board/task/${TASK_UUID}[^\\s)]*)`,
  'g',
)

/** TTL модульного кэша: совпадает со staleTime query — старше кэш не берём,
 *  иначе queryFn всегда возвращала бы старое значение и превью не обновлялось
 *  бы в рамках сессии (staleTime становился бы бессмысленным). */
const PREVIEW_STALE_MS = 5 * 60 * 1000
/** Потолок кэша: module-level Map не должен расти бесконечно (длинные ленты
 *  комментариев × многие задачи). LRU-поведение: перезапись и вставка — в конец. */
const PREVIEW_CACHE_MAX = 200

/** Общий кэш превью для всех Markdown-инстансов (описание + комментарии). */
const previewCache = new Map<string, { data: DevTrackerPreview; at: number }>()

function cachePreview(id: string, data: DevTrackerPreview): void {
  previewCache.delete(id)
  previewCache.set(id, { data, at: Date.now() })
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value
    if (oldest === undefined) break
    previewCache.delete(oldest)
  }
}

function extractTaskId(url: string): string | null {
  if (!url) return null
  TASK_ID_RE.lastIndex = 0
  const m = TASK_ID_RE.exec(url)
  return m ? m[1] : null
}

// Формат дедлайна и цвет точки статуса — общие из ./devBoardTypes
// (fmtDeadline без Date — таймзона день не сдвигает; DEV_STATUS_COLORS).

const TASK_LINK_CLS = 'text-primary-600 dark:text-primary-400 hover:underline break-words [overflow-wrap:anywhere]'

/**
 * Ссылка на задачу → превью-карточка (точка статуса, title, assignee, дедлайн,
 * клик ведёт на /dev-board/task/:id). Пока грузится или ошибка бэка
 * (retry:false, бэк может быть ещё не готов) — обычная ссылка.
 */
function TaskUnfurl({ id, href, label }: { id: string; href: string; label: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dev-tracker', 'preview', id],
    queryFn: async (): Promise<DevTrackerPreview> => {
      const hit = previewCache.get(id)
      // Свежая запись — дедуплицикация; устаревшая — уходим в API (см. TTL выше).
      if (hit && Date.now() - hit.at < PREVIEW_STALE_MS) return hit.data
      const p = await devTrackerApi.getPreview(id)
      if (p && (p as DevTrackerPreview).id) cachePreview(id, p as DevTrackerPreview)
      return p as DevTrackerPreview
    },
    retry: false,
    staleTime: PREVIEW_STALE_MS,
  })

  const to = taskUrl(id)

  if (isLoading || isError || !data || !data.id) {    // Обычная ссылка: внутренняя — SPA-Link, внешняя — <a target=_blank>.
    if (href.startsWith('/')) {
      return (
        <Link to={href.startsWith('/dev-board/task/') ? href : to} className={TASK_LINK_CLS}>
          {label}
        </Link>
      )
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={TASK_LINK_CLS}>
        {label}
      </a>
    )
  }

  const dot = DEV_STATUS_COLORS[data.status as keyof typeof DEV_STATUS_COLORS] ?? 'bg-surface-400'
  const deadline = data.deadline ? fmtDeadline(data.deadline) : null
  // Имя исполнителя может прийти не строкой (частичный контракт бэка) —
  // .trim() на числе ронял ленту комментариев (TypeError).
  const assigneeName = String(data.assignee?.name ?? '').trim() || null

  return (
    <Link
      to={to}
      title={data.title}
      className="my-1 flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 px-2.5 py-1.5 no-underline transition-colors hover:border-primary-300 dark:hover:border-primary-600"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-surface-800 dark:text-surface-100">
        {data.title}
      </span>
      {assigneeName && (
        <span className="shrink-0 truncate max-w-[120px] text-xs text-surface-500 dark:text-surface-400">
          {assigneeName}
        </span>
      )}
      {deadline && (
        <span className="shrink-0 text-xs tabular-nums text-surface-500 dark:text-surface-400">
          {deadline}
        </span>
      )}
    </Link>
  )
}

/** Голый URL задачи внутри plain-текста → TaskUnfurl, остальное — plain <span>. */
function renderPlainWithTaskUnfurl(text: string, keyOf: () => string): ReactNode[] {
  BARE_TASK_RE.lastIndex = 0
  const parts = text.split(BARE_TASK_RE)
  // Длинные слова/URL рвём anywhere: иначе голый URL без пробелов
  // растягивает 360px-контейнер (родительский break-words не всегда хватает).
  if (parts.length <= 1) return [<span key={keyOf()} className="break-words [overflow-wrap:anywhere]">{text}</span>]
  const nodes: ReactNode[] = []
  for (const part of parts) {
    if (!part) continue
    const tid = extractTaskId(part)
    // Совпавшая часть — голый URL задачи (начинается с / или http).
    if (tid && (part.startsWith('/') || /^https?:\/\//i.test(part))) {
      nodes.push(<TaskUnfurl key={keyOf()} id={tid} href={taskUrl(tid)} label={part} />)
    } else {
      nodes.push(<span key={keyOf()} className="break-words [overflow-wrap:anywhere]">{part}</span>)
    }
  }
  return nodes
}

function renderInline(src: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (depth > 4 || !src) return src ? [src] : []
  const out: ReactNode[] = []
  let n = 0
  const key = () => `${keyPrefix}-i${n++}`

  // 1) Инлайн-код — внутри ничего не парсим.
  const codeParts = src.split(/(`[^`\n]*`)/g)
  for (const part of codeParts) {
    if (!part) continue
    if (/^`[^`\n]*`$/.test(part)) {
      out.push(
        <code
          key={key()}
          className="px-1 py-0.5 rounded bg-surface-100 dark:bg-surface-800 text-[13px] font-mono text-surface-800 dark:text-surface-200 break-words [overflow-wrap:anywhere]"
        >
          {part.slice(1, -1)}
        </code>,
      )
      continue
    }
    // 2) Ссылки [t](http...) и [t](/dev-board/task/<uuid>) — task-ссылки
    //    анфёрлим в превью-карточку, http — обычная <a>, остальное plain.
    const linkParts = part.split(/(\[[^\]\n]+\]\((?:https?:\/\/[^\s)]+|\/dev-board\/task\/[^\s)]+)\))/g)
    for (const lp of linkParts) {
      if (!lp) continue
      const lm = lp.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/dev-board\/task\/[^\s)]+)\)$/)
      if (lm) {
        const label = lm[1]
        const url = lm[2]
        const taskId = extractTaskId(url)
        if (taskId) {
          out.push(
            <TaskUnfurl key={key()} id={taskId} href={taskUrl(taskId)} label={label} />,
          )
          continue
        }
        if (/^https?:\/\//i.test(url)) {
          out.push(
            <a
              key={key()}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary-600 dark:text-primary-400 hover:underline break-words [overflow-wrap:anywhere]"
            >
              {label}
            </a>,
          )
          continue
        }
        out.push(<span key={key()}>{lp}</span>)
        continue
      }
      // 3) Жирный **...** (внутри рекурсивно парсим курсив/ссылки).
      const boldParts = lp.split(/(\*\*[^*\n]+?\*\*)/g)
      for (const bp of boldParts) {
        if (!bp) continue
        const bm = bp.match(/^\*\*([^*][^*\n]*?)\*\*$/)
        if (bm) {
          out.push(
            <strong key={key()} className="font-semibold">
              {renderInline(bm[1], `${keyPrefix}-b${n}`, depth + 1)}
            </strong>,
          )
          continue
        }
        // 4) Курсив *...*.
        const emParts = bp.split(/(\*[^*\n]+?\*)/g)
        for (const ep of emParts) {
          if (!ep) continue
          const em = ep.match(/^\*([^*\n]+?)\*$/)
          if (em) {
            out.push(<em key={key()}>{em[1]}</em>)
          } else if (ep) {
            // Plain-текст: голые /dev-board/task/<uuid> → превью-карточки.
            renderPlainWithTaskUnfurl(ep, key).forEach(nd => out.push(nd))
          }
        }
      }
    }
  }
  return out
}

function renderBlocks(textPart: string, keyPrefix: string): ReactNode[] {
  const lines = textPart.split('\n')
  const out: ReactNode[] = []
  let para: string[] = []
  let n = 0

  const flushPara = () => {
    if (!para.length) return
    const k = `${keyPrefix}-p${n++}`
    const nodes: ReactNode[] = []
    para.forEach((ln, li) => {
      if (li > 0) nodes.push(<br key={`${k}-br${li}`} />)
      const inline = renderInline(ln, `${k}-l${li}`)
      inline.forEach(nd => nodes.push(nd))
    })
    out.push(
      <p key={k} className="whitespace-pre-wrap break-words">
        {nodes}
      </p>,
    )
    para = []
  }

  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    if (!ln.trim()) {
      flushPara()
      i++
      continue
    }
    if (/^\s*-\s+/.test(ln)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, ''))
        i++
      }
      out.push(
        <ul key={`${keyPrefix}-ul${n++}`} className="list-disc pl-5 space-y-0.5 my-1">
          {items.map((it, ii) => (
            <li key={ii} className="break-words">
              {renderInline(it, `${keyPrefix}-li${n}-${ii}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }
    if (/^\s*>\s?/.test(ln)) {
      flushPara()
      const quotes: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quotes.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      const qk = `${keyPrefix}-q${n++}`
      out.push(
        <blockquote
          key={qk}
          className="border-l-2 border-surface-300 dark:border-surface-600 pl-3 py-0.5 my-1 text-surface-600 dark:text-surface-400"
        >
          {quotes.map((q, qi) => (
            <span key={qi}>
              {renderInline(q, `${qk}-l${qi}`)}
              {qi < quotes.length - 1 && <br />}
            </span>
          ))}
        </blockquote>,
      )
      continue
    }
    para.push(ln)
    i++
  }
  flushPara()
  return out
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  // Бэк может прислать не строку (null/объект вместо описания) — .trim()
  // на объекте ронял страницу, поэтому строгий typeof-guard.
  if (typeof text !== 'string' || !text.trim()) return null
  const normalized = text.replace(/\r\n?/g, '\n')
  const nodes: ReactNode[] = []

  // Fenced-блоки ```...``` вырезаем первыми — внутри них markdown не парсится.
  const fenceRe = /```(?:[\w-]*\n)?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let seg = 0
  const pushText = (slice: string) => {
    if (!slice || !slice.trim()) return
    renderBlocks(slice, `s${seg++}`).forEach(nd => nodes.push(nd))
  }
  while ((m = fenceRe.exec(normalized)) !== null) {
    pushText(normalized.slice(last, m.index))
    const code = (m[1] || '').replace(/^\n+|\n+$/g, '')
    nodes.push(
      <pre
        key={`cb${seg++}`}
        className="my-1.5 p-2.5 rounded-lg bg-surface-100 dark:bg-surface-800 overflow-x-auto text-[13px] leading-relaxed"
      >
        <code className="font-mono text-surface-800 dark:text-surface-200 whitespace-pre">{code}</code>
      </pre>,
    )
    last = m.index + m[0].length
  }
  pushText(normalized.slice(last))

  if (!nodes.length) return null
  return <div className={className}>{nodes}</div>
}

export default Markdown
