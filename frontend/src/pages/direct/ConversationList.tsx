import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import { Search, Eye, Inbox, AlertCircle, User as UserIcon, X } from 'lucide-react'
import { directApi, type DirectConversation, type DirectView } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import ContactAvatar from './ContactAvatar'
import { duration, listTime } from './directTime'
import { useAuthStore } from '@/store/auth.store'
import { useSocketConnected } from '@/lib/socketState'
import { isSalesUser, isTopUser, shortName } from './directAccess'

const VIEWS: { key: DirectView; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'mine', label: 'Мои' },
  { key: 'free', label: 'Свободные' },
  { key: 'unread', label: 'Непрочитанные' },
  { key: 'waiting', label: 'Ждут ответа' },
]

const EMPTY: Record<DirectView, string> = {
  all: 'Пока ни одного чата. Как только клиент напишет в Instagram, чат появится здесь.',
  mine: 'За вами пока нет клиентов. Ответьте клиенту из «Свободных» — чат закрепится за вами.',
  free: 'Свободных чатов нет — все клиенты закреплены за менеджерами.',
  unread: 'Всё прочитано',
  waiting: 'Никто не ждёт ответа',
}

const PAGE = 50

/** Список чатов «Директа»: поиск, вкладки с числами, «ждёт ответа N мин»,
 *  кто ведёт клиента. assigneeId — чаты одного менеджера (выбор руководства
 *  или переход из «Аналитики»), адрес /direct?m=<id>. */
export default function ConversationList({ selectedId, onSelect, assigneeId, onAssigneeChange }: {
  selectedId: string | null
  onSelect: (id: string) => void
  assigneeId: string | null
  onAssigneeChange: (id: string | null) => void
}) {
  const user = useAuthStore(s => s.user)
  const top = isTopUser(user)
  const sales = isSalesUser(user)
  const [view, setView] = useState<DirectView>('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Минутные «ждёт 12 мин» должны идти сами, без новых сообщений.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const live = useSocketConnected()

  // «Мои» — только у менеджеров продаж; при фильтре по менеджеру «Мои» и
  // «Свободные» не имеют смысла — прячем их.
  const views = VIEWS.filter(v => (v.key !== 'mine' || sales) && (!assigneeId || (v.key !== 'mine' && v.key !== 'free')))
  const viewShown = views.some(v => v.key === view)
  useEffect(() => {
    if (!viewShown) setView('all')
  }, [viewShown])

  const { data: managers } = useQuery({
    queryKey: ['direct', 'managers'],
    queryFn: directApi.managers,
    staleTime: 5 * 60_000,
  })
  const filterName = assigneeId ? managers?.find(m => m.id === assigneeId)?.name : undefined

  const { data: counts } = useQuery({
    queryKey: ['direct', 'counts', debounced, assigneeId || ''],
    queryFn: () => directApi.counts(debounced, assigneeId || undefined),
    placeholderData: keepPreviousData,
  })

  const list = useInfiniteQuery({
    // Порядок важен: directCache разбирает ключ так же.
    queryKey: ['direct', 'list', view, debounced, assigneeId || ''],
    queryFn: ({ pageParam }) => directApi.list({ view, search: debounced || undefined, assigneeId: assigneeId || undefined, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
    // Пока вебсокет на связи, список обновляется событиями; без него — опрос.
    refetchInterval: live ? 60_000 : 10_000,
  })
  const items = list.data?.pages.flatMap(p => p.items) ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-surface-200 p-3 dark:border-surface-700">
        <div className="flex gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-2.5 dark:border-surface-700 dark:bg-surface-900">
            <Search size={15} className="shrink-0 text-surface-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Имя или @ник"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-surface-400"
              aria-label="Поиск по чатам"
            />
          </label>
          {/* Руководство смотрит чаты любого менеджера продаж */}
          {top && (
            <select
              value={assigneeId || ''}
              onChange={e => onAssigneeChange(e.target.value || null)}
              className={clsx('h-9 w-[42%] max-w-[180px] shrink-0 cursor-pointer truncate rounded-lg border px-2 text-[13px] outline-none dark:bg-surface-900',
                assigneeId
                  ? 'border-primary-300 bg-primary-50 font-medium text-primary-700 dark:border-primary-500/40 dark:text-primary-300'
                  : 'border-surface-200 bg-surface-50 text-surface-600 dark:border-surface-700 dark:text-surface-300')}
              aria-label="Чаты менеджера"
            >
              <option value="">Все менеджеры</option>
              {(managers ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              {/* Менеджера уже нет в списке (уволен) — его чаты всё равно видно. */}
              {assigneeId && managers && !filterName && <option value={assigneeId}>Другой сотрудник</option>}
            </select>
          )}
        </div>
        {/* Менеджер пришёл из «Аналитики» на чаты коллеги — фильтр видно и можно снять */}
        {!top && assigneeId && (
          <div className="flex items-center gap-1.5 text-[12px] text-surface-600 dark:text-surface-300">
            <UserIcon size={13} className="shrink-0 text-surface-400" />
            <span className="min-w-0 truncate">Чаты: <b className="font-medium">{assigneeId === user?.id ? 'ваши' : filterName || 'сотрудника'}</b></span>
            <button type="button" onClick={() => onAssigneeChange(null)} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">
              <X size={13} /> Все чаты
            </button>
          </div>
        )}
        {/* Пять вкладок не влезают в колонку — переносятся строкой ниже, а не
            уезжают за край: «Ждут ответа» должна быть видна сразу. */}
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {views.map(v => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={clsx(
                'inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-0',
                view === v.key
                  ? 'bg-primary-600 text-white'
                  : 'border border-surface-200 bg-surface-50 text-surface-600 hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300',
              )}
            >
              {v.label}
              {counts && <span className={clsx('tabular-nums', view === v.key ? 'opacity-80' : 'text-surface-400')}>{counts[v.key]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-surface-500">
            <Inbox size={28} className="text-surface-300" />
            {debounced ? 'Никого не нашли' : assigneeId && view === 'all' ? 'За этим менеджером пока нет чатов' : EMPTY[view]}
          </div>
        ) : (
          <ul>
            {/* Во «Моих», «Свободных» и при фильтре по менеджеру у всех строк один ведущий — не повторяем. */}
            {items.map(c => <Row key={c.id} c={c} active={c.id === selectedId} onSelect={onSelect} showAssignee={view !== 'mine' && view !== 'free' && !assigneeId} />)}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="p-3">
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="btn-secondary w-full justify-center">
              {list.isFetchingNextPage ? 'Загружаю…' : 'Показать ещё'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Кто ведёт клиента: «ведёте вы», «Мадина С.» или «свободный». */
function AssigneeChip({ c, me }: { c: DirectConversation; me: string | undefined }) {
  if (!c.assignee) {
    return (
      <span className="rounded-full border border-dashed border-surface-300 px-2 py-px text-[11px] text-surface-500 dark:border-surface-600 dark:text-surface-400">
        свободный
      </span>
    )
  }
  const mine = c.assignee.id === me
  return (
    <span title={`Ведёт: ${c.assignee.name}`} className={clsx('inline-flex max-w-[150px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      mine ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300')}>
      <UserIcon size={11} className="shrink-0" />
      <span className="truncate">{mine ? 'ведёте вы' : shortName(c.assignee.name)}</span>
    </span>
  )
}

function Row({ c, active, onSelect, showAssignee }: { c: DirectConversation; active: boolean; onSelect: (id: string) => void; showAssignee: boolean }) {
  const me = useAuthStore(s => s.user?.id)
  const last = c.lastMessage
  const unread = c.unreadCount > 0
  const who = !last || last.direction === 'in'
    ? ''
    : last.author
      ? (last.author.id === me ? 'Вы: ' : `${last.author.name.split(' ')[0]}: `)
      : 'Instagram: '
  const waitingMs = c.waitingSince ? Date.now() - new Date(c.waitingSince).getTime() : 0
  const viewers = c.viewers.filter(v => v.id !== me)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(c.id)}
        className={clsx(
          'flex w-full items-start gap-3 border-b border-surface-100 px-3 py-2.5 text-left transition-colors dark:border-surface-700/60',
          active ? 'bg-surface-100 dark:bg-surface-700/60' : 'hover:bg-surface-100/60 dark:hover:bg-surface-700/30',
        )}
      >
        <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={clsx('truncate text-sm', unread ? 'font-semibold text-surface-900 dark:text-white' : 'font-medium text-surface-800 dark:text-surface-100')}>
              {c.contact.label}
            </span>
            {c.lead && <span className="shrink-0 rounded bg-surface-200 px-1 text-[10px] font-semibold uppercase tracking-wide text-surface-600 dark:bg-surface-700 dark:text-surface-300">лид</span>}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-surface-400">{listTime(c.lastMessageAt)}</span>
          </span>
          {c.contact.name && c.contact.username && (
            <span className="block truncate text-[11px] text-surface-400">@{c.contact.username}</span>
          )}
          <span className="mt-0.5 flex items-center gap-2">
            {last?.status === 'failed' && (
              <AlertCircle size={13} className="shrink-0 text-red-500" aria-label="Не доставлено" />
            )}
            <span className={clsx('min-w-0 flex-1 truncate text-[13px]', unread ? 'text-surface-800 dark:text-surface-100' : 'text-surface-500 dark:text-surface-400')}>
              {last ? `${who}${last.preview}` : 'Нет сообщений'}
            </span>
            {unread && (
              <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[11px] font-bold text-white">
                {c.unreadCount > 99 ? '99+' : c.unreadCount}
              </span>
            )}
          </span>
          {(showAssignee || c.waitingSince || viewers.length > 0) && (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {showAssignee && <AssigneeChip c={c} me={me} />}
              {c.waitingSince && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  ждёт ответа {duration(waitingMs)}
                </span>
              )}
              {viewers.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-surface-500">
                  <Eye size={12} /> {viewers.map(v => v.name.split(' ')[0]).join(', ')}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
