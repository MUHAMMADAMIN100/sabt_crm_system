import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Modal, Skeleton } from '@/components/ui'
import { leadsApi } from '@/services/sales.api'
import { salesKeys } from '@/lib/salesQueries'
import type { LeadListParams, SalesLead } from '@/types/sales'
import StageBadge from './StageBadge'
import { nextActionOf, ACTION_TEXT_CLASS } from './leadUtils'

/**
 * Выбор своего лида (15.11.2026) — для «+ Звонок / Встреча» с нижней
 * панели и Панели: сначала «с кем», потом шторка действия. Ищем на
 * сервере по своим лидам, ближайшие по сроку — сверху.
 */
export default function LeadPickerModal({ open, title, onClose, onPick }: {
  open: boolean
  title: string
  onClose: () => void
  onPick: (lead: SalesLead) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <PickerBody onPick={onPick} />
    </Modal>
  )
}

function PickerBody({ onPick }: { onPick: (lead: SalesLead) => void }) {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  // Пауза перед запросом — не дёргать сервер на каждую букву.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const params: LeadListParams = { search: search || undefined, owner: 'me', pageSize: 20, sort: 'next' }
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: salesKeys.list({ ...params, picker: true }),
    queryFn: () => leadsApi.page(params),
    placeholderData: keepPreviousData,
  })
  const items = data?.items ?? []

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <label htmlFor="lead-picker-q" className="sr-only">Поиск лида</label>
        <input id="lead-picker-q" autoFocus className="input pl-9" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Название, телефон, Instagram" />
      </div>
      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : isError ? (
        <div className="py-6 text-center">
          <p className="text-sm text-surface-600 dark:text-surface-300">Не удалось загрузить лиды</p>
          <button type="button" onClick={() => refetch()} className="btn-secondary mt-3 min-h-[44px]">Повторить</button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-surface-500 dark:text-surface-400">
          {search ? 'Ничего не найдено' : 'У вас пока нет лидов'}
        </p>
      ) : (
        <ul className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
          {items.map(l => {
            const a = nextActionOf(l)
            return (
              <li key={l.id}>
                <button type="button" onClick={() => onPick(l)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-100 dark:hover:bg-surface-700/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-surface-900 dark:text-surface-50">{l.name}</span>
                    <span className={`block truncate text-xs ${ACTION_TEXT_CLASS[a.tone]}`}>{a.label}</span>
                  </span>
                  <StageBadge status={l.status} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
