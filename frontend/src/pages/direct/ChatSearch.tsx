import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { directApi } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { clockTime, dayLabel } from './directTime'
import { Highlight } from './SearchHighlight'

/** Поиск по переписке одного чата: клик по найденному — переход к сообщению. */
export default function ChatSearch({ conversationId, onPick, onClose }: {
  conversationId: string
  onPick: (messageId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data, isFetching } = useQuery({
    queryKey: ['direct', 'search', debounced, conversationId],
    queryFn: () => directApi.search(debounced, conversationId),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  })
  const items = data?.items ?? []

  return (
    <div className="relative border-b border-surface-200 bg-white px-3 py-2 dark:border-surface-700 dark:bg-surface-900">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-2.5 dark:border-surface-700 dark:bg-surface-800">
        <Search size={15} className="shrink-0 text-surface-400" />
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Найти в переписке" aria-label="Найти в переписке"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
            if (e.key === 'Enter' && items[0]) { e.preventDefault(); onPick(items[0].messageId) }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-surface-400" />
        {isFetching && <Spinner />}
        <button type="button" onClick={onClose} className="rounded p-0.5 text-surface-400 hover:text-surface-700" aria-label="Закрыть поиск"><X size={15} /></button>
      </label>
      {debounced.length >= 2 && !isFetching && (
        <div className="absolute inset-x-3 top-full z-20 mt-1 max-h-[50vh] overflow-y-auto rounded-xl border border-surface-200 bg-white py-1 shadow-modal dark:border-surface-600 dark:bg-surface-800">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-center text-[13px] text-surface-500">Ничего не нашлось</p>
          ) : items.map(hit => (
            <button key={hit.messageId} type="button" onClick={() => onPick(hit.messageId)}
              className="block w-full px-3 py-2 text-left hover:bg-surface-100 dark:hover:bg-surface-700">
              <span className="flex items-center gap-2 text-[11px] text-surface-400">
                <span>{hit.direction === 'in' ? 'Клиент' : hit.direction === 'note' ? `Заметка · ${hit.author?.name || 'Сотрудник'}` : hit.author?.name || 'Агентство'}</span>
                <span className="ml-auto tabular-nums">{dayLabel(hit.sentAt)} {clockTime(hit.sentAt)}</span>
              </span>
              <span className="mt-0.5 block text-[13px] text-surface-800 dark:text-surface-100"><Highlight text={hit.snippet} query={debounced} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
