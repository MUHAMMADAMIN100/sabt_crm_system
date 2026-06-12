import React from 'react'
import clsx from 'clsx'

/**
 * Минимальный markdown-рендерер для описаний задач и комментариев.
 * Поддерживает:
 *  - **жирный** и *курсив*
 *  - `инлайн-код`
 *  - ```code blocks``` с моноширинным фоном (опционально с языком: ```ts)
 *  - [текст](url) ссылки (только http(s):)
 *  - списки `- ` и `1. `
 *  - заголовки `#`, `##`, `###`
 *  - переводы строк сохраняются
 *
 * Не поддерживает: таблицы, картинки, blockquote — для них есть полноценные
 * markdown-библиотеки. Здесь сознательно простая реализация без зависимостей
 * чтобы не раздувать bundle на 80kb.
 */

const URL_REGEX = /^https?:\/\//

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
    }
    return ch
  })
}

/** Inline-разметка: жирный, курсив, код, ссылки. */
function renderInline(text: string, keyPrefix = ''): React.ReactNode[] {
  // Идём слева направо, на каждом шаге ищем самое раннее совпадение.
  const out: React.ReactNode[] = []
  let i = 0
  let lastIdx = 0
  const rest = text
  // Используем единый regex с альтернативами и группами
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rest))) {
    if (m.index > lastIdx) {
      out.push(escapeHtml(rest.slice(lastIdx, m.index)))
    }
    if (m[1]) {
      out.push(<strong key={`${keyPrefix}b${i++}`}>{m[2]}</strong>)
    } else if (m[3]) {
      out.push(<em key={`${keyPrefix}i${i++}`}>{m[4]}</em>)
    } else if (m[5]) {
      out.push(
        <code
          key={`${keyPrefix}c${i++}`}
          className="px-1 py-0.5 rounded bg-surface-100 dark:bg-surface-800 text-[0.9em] font-mono text-surface-600 dark:text-surface-400"
        >
          {m[6]}
        </code>,
      )
    } else if (m[7]) {
      const href = m[9]
      if (URL_REGEX.test(href)) {
        out.push(
          <a
            key={`${keyPrefix}l${i++}`}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary-600 dark:text-primary-400 hover:underline"
          >
            {m[8]}
          </a>,
        )
      } else {
        out.push(escapeHtml(m[0]))
      }
    }
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < rest.length) out.push(escapeHtml(rest.slice(lastIdx)))
  return out
}

export default function MiniMarkdown({ text, className }: { text?: string | null; className?: string }) {
  if (!text) return null
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const start = i + 1
      let end = start
      while (end < lines.length && !lines[end].startsWith('```')) end++
      const codeText = lines.slice(start, end).join('\n')
      out.push(
        <pre
          key={`code-${i}`}
          className="my-2 p-3 rounded-lg bg-surface-900 dark:bg-black/40 text-surface-100 dark:text-surface-200 text-xs font-mono overflow-x-auto"
        >
          {lang && (
            <div className="text-[10px] text-surface-400 mb-1 uppercase tracking-wide">{lang}</div>
          )}
          <code>{codeText}</code>
        </pre>,
      )
      i = end + 1
      continue
    }
    // Headers
    if (line.startsWith('### ')) {
      out.push(<h3 key={`h-${i}`} className="text-sm font-semibold mt-3 mb-1">{renderInline(line.slice(4), `h${i}`)}</h3>)
      i++; continue
    }
    if (line.startsWith('## ')) {
      out.push(<h2 key={`h-${i}`} className="text-base font-semibold mt-3 mb-1">{renderInline(line.slice(3), `h${i}`)}</h2>)
      i++; continue
    }
    if (line.startsWith('# ')) {
      out.push(<h1 key={`h-${i}`} className="text-lg font-bold mt-3 mb-1">{renderInline(line.slice(2), `h${i}`)}</h1>)
      i++; continue
    }
    // Bullet list
    if (/^[-*] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2))
        i++
      }
      out.push(
        <ul key={`ul-${i}`} className="my-1 list-disc list-inside space-y-0.5">
          {items.map((it, j) => <li key={j}>{renderInline(it, `ul${i}_${j}`)}</li>)}
        </ul>,
      )
      continue
    }
    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      out.push(
        <ol key={`ol-${i}`} className="my-1 list-decimal list-inside space-y-0.5">
          {items.map((it, j) => <li key={j}>{renderInline(it, `ol${i}_${j}`)}</li>)}
        </ol>,
      )
      continue
    }
    // Empty line
    if (line.trim() === '') {
      out.push(<div key={`br-${i}`} className="h-2" />)
      i++; continue
    }
    // Paragraph
    out.push(<p key={`p-${i}`} className="whitespace-pre-wrap break-words">{renderInline(line, `p${i}`)}</p>)
    i++
  }
  return <div className={clsx('text-sm leading-relaxed', className)}>{out}</div>
}
