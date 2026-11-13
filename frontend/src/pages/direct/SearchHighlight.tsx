/** Найденное слово в выдаче поиска — подсвечено. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: (string | JSX.Element)[] = []
  let from = 0
  let at = lower.indexOf(needle)
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={at} className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-500/40">{text.slice(at, at + q.length)}</mark>)
    from = at + q.length
    at = lower.indexOf(needle, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}
