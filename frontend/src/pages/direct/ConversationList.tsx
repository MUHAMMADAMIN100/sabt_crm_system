import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertCircle, Archive, BellRing, Check, Eye, Inbox, MoreHorizontal, Pin, Search, SlidersHorizontal, User as UserIcon, X,
} from 'lucide-react'
import { directApi, type DirectConversation, type DirectFilters, type DirectView } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import ContactAvatar from './ContactAvatar'
import { duration, listTime, clockTime, dayLabel, shortAgo } from './directTime'
import { useAuthStore } from '@/store/auth.store'
import { useSocketConnected } from '@/lib/socketState'
import { isSalesUser, isTopUser, shortName } from './directAccess'
import { useDraft } from './drafts'
import { remindLabel, useLabels, useMyReminders } from './chatActions'
import ChatMenu, { anchorOf, FloatingMenu, type MenuAnchor } from './ChatMenu'
import { labelColor } from './labelColors'
import { Highlight } from './SearchHighlight'

const VIEWS: { key: DirectView; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'mine', label: 'Мои' },
  { key: 'free', label: 'Свободные' },
  { key: 'unread', label: 'Непрочитанные' },
  { key: 'waiting', label: 'Ждут ответа' },
  { key: 'archived', label: 'Архив' },
]

const EMPTY: Record<DirectView, string> = {
  all: 'Пока ни одного чата. Как только клиент напишет в Instagram, чат появится здесь.',
  mine: 'За вами пока нет клиентов. Ответьте клиенту из «Свободных» — чат закрепится за вами.',
  free: 'Свободных чатов нет — все клиенты закреплены за менеджерами.',
  unread: 'Всё прочитано',
  waiting: 'Никто не ждёт ответа',
  archived: 'В архиве пусто. Уберите сюда спам и закрытые чаты — клиент напишет, и чат вернётся сам.',
}

const PAGE = 50

/** Ключ фильтров для кэша: пустая строка — фильтров нет. */
const filtersKey = (f: DirectFilters) => [f.labelId || '', f.lead || '', f.reminder ? '1' : '', f.account || ''].join('|').replace(/^\|\|\|$/, '')

/** Список чатов «Директа»: поиск по именам и по переписке, вкладки с числами,
 *  фильтры (метка, лид, напоминание), закреплённые сверху, меню у строки.
 *  assigneeId — чаты одного менеджера (выбор руководства или переход из
 *  «Аналитики»), адрес /direct?m=<id>. */
export default function ConversationList({ header, selectedId, onSelect, onOpenMessage, assigneeId, onAssigneeChange, searchRef, onOrder }: {
  /** Шапка над поиском — как имя аккаунта в Instagram: «Директ» и кнопки. */
  header?: ReactNode
  selectedId: string | null
  onSelect: (id: string) => void
  /** Найденное сообщение — открыть чат на нём. */
  onOpenMessage: (conversationId: string, messageId: string) => void
  assigneeId: string | null
  onAssigneeChange: (id: string | null) => void
  /** Ctrl+K ставит курсор в поиск. */
  searchRef?: MutableRefObject<HTMLInputElement | null>
  /** Порядок чатов на экране — для Alt+↑/↓. */
  onOrder?: (ids: string[]) => void
}) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const top = isTopUser(user)
  const sales = isSalesUser(user)
  const [view, setView] = useState<DirectView>('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filters, setFilters] = useState<DirectFilters>({})
  // Аккаунт Instagram — свой переключатель над вкладками (13.11.2026).
  const [account, setAccount] = useState<string | null>(null)
  const { data: status } = useQuery({ queryKey: ['direct', 'status'], queryFn: directApi.status, staleTime: 60_000 })
  const accounts = useMemo(() => (status?.accounts ?? []).filter(a => a.accountId), [status])
  const multi = accounts.length > 1
  const accountName = useMemo(() => new Map(accounts.map(a => [a.accountId!, a.username || 'Instagram'])), [accounts])
  // Аккаунт отключили — переключатель возвращается на «Все».
  useEffect(() => { if (account && status && !accounts.some(a => a.accountId === account)) setAccount(null) }, [account, status, accounts])
  const query = useMemo<DirectFilters>(() => ({ ...filters, account: account || undefined }), [filters, account])
  const [filtersMenu, setFiltersMenu] = useState<MenuAnchor | null>(null)
  const [rowMenu, setRowMenu] = useState<{ c: DirectConversation; anchor: MenuAnchor } | null>(null)
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
  const { data: labels } = useLabels()
  const { data: reminders } = useMyReminders()
  const reminderOf = useMemo(() => new Map((reminders ?? []).map(r => [r.conversationId, r])), [reminders])
  const filterName = assigneeId ? managers?.find(m => m.id === assigneeId)?.name : undefined
  const fKey = filtersKey(query)
  const activeFilters = (filters.labelId ? 1 : 0) + (filters.lead ? 1 : 0) + (filters.reminder ? 1 : 0)
  const filterLabel = filters.labelId ? labels?.find(l => l.id === filters.labelId) : undefined

  const { data: counts } = useQuery({
    queryKey: ['direct', 'counts', debounced, assigneeId || '', fKey],
    queryFn: () => directApi.counts({ search: debounced || undefined, assigneeId: assigneeId || undefined, ...query }),
    placeholderData: keepPreviousData,
  })

  const list = useInfiniteQuery({
    // Порядок важен: directCache разбирает ключ так же.
    queryKey: ['direct', 'list', view, debounced, assigneeId || '', fKey],
    queryFn: ({ pageParam }) => directApi.list({
      view, search: debounced || undefined, assigneeId: assigneeId || undefined, limit: PAGE, offset: pageParam, ...query,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
    // Пока вебсокет на связи, список обновляется событиями; без него — опрос.
    refetchInterval: live ? 60_000 : 10_000,
  })
  const items = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data])
  useEffect(() => { onOrder?.(items.map(c => c.id)) }, [items, onOrder])

  // Поиск по тексту переписки — отдельным блоком под чатами.
  const hits = useQuery({
    queryKey: ['direct', 'search', debounced, ''],
    queryFn: () => directApi.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  })

  const select = (c: DirectConversation) => {
    // Шапка открытого чата рисуется сразу, пока сервер отвечает.
    if (!qc.getQueryData(['direct', 'conversation', c.id])) qc.setQueryData(['direct', 'conversation', c.id], c)
    onSelect(c.id)
  }

  const searchHits = debounced.length >= 2 ? hits.data?.items ?? [] : []

  // Долистали до конца списка — следующие чаты подгружаются сами (как в
  // Instagram); кнопка «Показать ещё» остаётся на случай, если не сработало.
  const moreRef = useRef<HTMLDivElement>(null)
  const fetchMore = useRef(() => {})
  fetchMore.current = () => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage() }
  const hasMore = !!list.hasNextPage
  useEffect(() => {
    const el = moreRef.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) fetchMore.current() }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="space-y-2.5 px-4 pb-2.5 pt-1">
        <div className="flex gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface-100 px-3 dark:bg-surface-800">
            <Search size={16} className="shrink-0 text-surface-500" />
            <input
              ref={el => { if (searchRef) searchRef.current = el }}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape' && search) { e.preventDefault(); e.stopPropagation(); setSearch('') } }}
              placeholder="Поиск"
              title={top ? 'Имя или текст переписки' : 'Имя, @ник или текст переписки'}
              className="w-full min-w-0 bg-transparent text-[15px] text-surface-900 outline-none placeholder:text-surface-500 dark:text-white"
              aria-label="Поиск по чатам и сообщениям"
              enterKeyHint="search"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-400 text-white hover:bg-surface-500 dark:bg-surface-500" aria-label="Очистить поиск">
                <X size={13} strokeWidth={3} />
              </button>
            )}
          </label>
          <button type="button" onClick={e => setFiltersMenu(anchorOf(e.currentTarget))}
            className={clsx('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              activeFilters ? 'bg-[#0095f6]/10 text-[#0095f6]' : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700')}
            aria-label={activeFilters ? `Фильтры: ${activeFilters}` : 'Фильтры'} title="Фильтры: метка, лид, напоминания" aria-haspopup="menu">
            <SlidersHorizontal size={17} />
            {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#0095f6] px-1 text-[10px] font-bold text-white">{activeFilters}</span>}
          </button>
          {/* Руководство смотрит чаты любого менеджера продаж */}
          {top && (
            <select
              value={assigneeId || ''}
              onChange={e => onAssigneeChange(e.target.value || null)}
              className={clsx('h-10 w-[38%] max-w-[170px] shrink-0 cursor-pointer truncate rounded-xl border-0 px-2.5 text-[13px] outline-none',
                assigneeId
                  ? 'bg-[#0095f6]/10 font-semibold text-[#0095f6]'
                  : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-200')}
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
          <div className="flex items-center gap-1.5 text-[12.5px] text-surface-600 dark:text-surface-300">
            <UserIcon size={13} className="shrink-0 text-surface-400" />
            <span className="min-w-0 truncate">Чаты: <b className="font-semibold">{assigneeId === user?.id ? 'ваши' : filterName || 'сотрудника'}</b></span>
            <button type="button" onClick={() => onAssigneeChange(null)} className="ml-auto inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full px-2 text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800">
              <X size={13} /> Все чаты
            </button>
          </div>
        )}
        {/* Несколько аккаунтов Instagram — чьи чаты показывать. */}
        {multi && (
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-100 p-0.5 dark:bg-surface-800" role="radiogroup" aria-label="Аккаунт Instagram">
            {[{ id: null as string | null, label: 'Все аккаунты' }, ...accounts.map(a => ({ id: a.accountId as string | null, label: `@${a.username || 'Instagram'}` }))].map(o => (
              <button key={o.id || 'all'} type="button" role="radio" aria-checked={account === o.id} onClick={() => setAccount(o.id)}
                className={clsx('min-h-[32px] shrink-0 truncate rounded-[10px] px-3 text-[13px] font-semibold transition-colors',
                  account === o.id ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-600 dark:text-white' : 'text-surface-500 hover:text-surface-800 dark:hover:text-surface-200')}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {/* Вкладки — чипсами в одну строку, как фильтры в Instagram; лишнее листается вбок. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Какие чаты показать">
          {views.map(v => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={clsx(
                'inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold transition-colors',
                view === v.key
                  ? 'bg-surface-900 text-white dark:bg-white dark:text-surface-900'
                  : 'bg-surface-100 text-surface-800 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-100 dark:hover:bg-surface-700',
              )}
            >
              {v.key === 'archived' && <Archive size={13} />}
              {v.label}
              {counts && counts[v.key] > 0 && <span className={clsx('tabular-nums font-normal', view === v.key ? 'opacity-75' : 'text-surface-500 dark:text-surface-400')}>{counts[v.key]}</span>}
            </button>
          ))}
        </div>
        {activeFilters > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {filterLabel && (
              <FilterChip onClear={() => setFilters(f => ({ ...f, labelId: undefined }))}>
                <span className={clsx('h-2 w-2 rounded-full', labelColor(filterLabel.color).dot)} /> {filterLabel.name}
              </FilterChip>
            )}
            {filters.lead && <FilterChip onClear={() => setFilters(f => ({ ...f, lead: undefined }))}>{filters.lead === 'with' ? 'С лидом' : 'Без лида'}</FilterChip>}
            {filters.reminder && <FilterChip onClear={() => setFilters(f => ({ ...f, reminder: undefined }))}><BellRing size={11} /> С напоминанием</FilterChip>}
            <button type="button" onClick={() => setFilters({})} className="px-1 text-surface-500 hover:text-surface-800 hover:underline dark:hover:text-surface-200">Сбросить</button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {debounced && searchHits.length > 0 && items.length > 0 && <SectionTitle>Чаты</SectionTitle>}
        {list.isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : items.length === 0 ? (
          (!debounced || !searchHits.length) && (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-surface-500">
              <Inbox size={28} className="text-surface-300" />
              {debounced ? 'Никого не нашли' : activeFilters ? 'Под эти фильтры чатов нет' : assigneeId && view === 'all' ? 'За этим менеджером пока нет чатов' : EMPTY[view]}
            </div>
          )
        ) : (
          <ul aria-label="Чаты">
            {/* Во «Моих», «Свободных» и при фильтре по менеджеру у всех строк один ведущий — не повторяем. */}
            {items.map(c => (
              <Row key={c.id} c={c} active={c.id === selectedId} onSelect={select}
                showAssignee={view !== 'mine' && view !== 'free' && !assigneeId}
                reminder={reminderOf.get(c.id) ?? null}
                via={multi && !account ? (accountName.get(c.accountId) ?? 'отключён') : null}
                onMenu={anchor => setRowMenu({ c, anchor })} />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div ref={moreRef} className="p-3">
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="btn-secondary w-full justify-center">
              {list.isFetchingNextPage ? 'Загружаю…' : 'Показать ещё'}
            </button>
          </div>
        )}
        {debounced.length >= 2 && (
          hits.isLoading ? <div className="flex justify-center py-4"><Spinner /></div> : searchHits.length > 0 && (
            <>
              <SectionTitle>Сообщения · {searchHits.length}{searchHits.length >= 40 ? '+' : ''}</SectionTitle>
              <ul aria-label="Найденные сообщения">
                {searchHits.map(hit => (
                  <li key={hit.messageId}>
                    <button type="button" onClick={() => onOpenMessage(hit.conversationId, hit.messageId)}
                      className="flex w-full items-start gap-3 border-b border-surface-100 px-3 py-2.5 text-left hover:bg-surface-100/60 dark:border-surface-700/60 dark:hover:bg-surface-700/30">
                      <ContactAvatar label={hit.contact.label} picture={hit.contact.picture} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-[13px] font-medium text-surface-800 dark:text-surface-100">{hit.contact.label}</span>
                          {hit.archived && <span className="shrink-0 text-[10px] uppercase tracking-wide text-surface-400">архив</span>}
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-surface-400">{dayLabel(hit.sentAt)} {clockTime(hit.sentAt)}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-[12.5px] text-surface-600 dark:text-surface-300">
                          {hit.direction === 'note' ? <span className="font-medium text-amber-700 dark:text-amber-300">Заметка: </span>
                            : hit.direction === 'out' ? <span className="text-surface-400">{hit.author?.id === user?.id ? 'Вы' : hit.author?.name?.split(' ')[0] || 'Агентство'}: </span> : null}
                          <Highlight text={hit.snippet} query={debounced} />
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>

      {filtersMenu && (
        <FloatingMenu anchor={filtersMenu} onClose={() => setFiltersMenu(null)} label="Фильтры чатов" width={280}>
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Лид</div>
          <div className="flex gap-1 px-3 pb-2">
            {([[undefined, 'Все'], ['with', 'С лидом'], ['without', 'Без лида']] as [DirectFilters['lead'], string][]).map(([v, label]) => (
              <button key={label} type="button" onClick={() => setFilters(f => ({ ...f, lead: v }))} aria-pressed={filters.lead === v}
                className={clsx('flex-1 rounded-lg border px-2 py-1.5 text-[12.5px] font-medium',
                  filters.lead === v ? 'border-primary-600 bg-primary-600 text-white' : 'border-surface-200 text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700')}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" role="menuitemcheckbox" aria-checked={!!filters.reminder}
            onClick={() => setFilters(f => ({ ...f, reminder: f.reminder ? undefined : true }))}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-surface-100 dark:hover:bg-surface-700">
            <BellRing size={14} className="text-surface-500" />
            <span className="flex-1 text-surface-800 dark:text-surface-100">Только с моими напоминаниями</span>
            {filters.reminder && <Check size={15} className="text-primary-600 dark:text-primary-300" />}
          </button>
          <div className="border-t border-surface-100 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:border-surface-700">Метка</div>
          {!labels?.length ? (
            <p className="px-3 pb-2 text-[12.5px] text-surface-500">Меток пока нет{top ? ' — создайте их в меню чата «Метки…»' : ''}</p>
          ) : (
            <>
              {[{ id: '', name: 'Любая', color: '' }, ...labels].map(l => (
                <button key={l.id || 'any'} type="button" role="menuitemradio" aria-checked={(filters.labelId || '') === l.id}
                  onClick={() => setFilters(f => ({ ...f, labelId: l.id || undefined }))}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-surface-100 dark:hover:bg-surface-700">
                  <span className={clsx('h-2.5 w-2.5 rounded-full', l.color ? labelColor(l.color).dot : 'border border-surface-300 dark:border-surface-500')} />
                  <span className="flex-1 truncate text-surface-800 dark:text-surface-100">{l.name}</span>
                  {(filters.labelId || '') === l.id && <Check size={15} className="text-primary-600 dark:text-primary-300" />}
                </button>
              ))}
            </>
          )}
          {activeFilters > 0 && (
            <button type="button" onClick={() => { setFilters({}); setFiltersMenu(null) }}
              className="mt-1 w-full border-t border-surface-100 px-3 py-2 text-left text-[13px] font-medium text-surface-600 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-700">
              Сбросить фильтры
            </button>
          )}
        </FloatingMenu>
      )}
      {rowMenu && (
        <ChatMenu c={items.find(x => x.id === rowMenu.c.id) ?? rowMenu.c} anchor={rowMenu.anchor} onClose={() => setRowMenu(null)}
          onMarkedUnread={() => { if (rowMenu.c.id === selectedId) onSelect('') }} />
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-[1] bg-surface-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-500 dark:bg-surface-800">{children}</div>
}

function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-0.5 pl-2 pr-1 font-medium text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">
      {children}
      <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-primary-100 dark:hover:bg-primary-500/20" aria-label="Убрать фильтр"><X size={12} /></button>
    </span>
  )
}

/**
 * Строка чата — как в Instagram на любом экране (16.11.2026): крупный аватар,
 * имя, «текст · 5 мин», синяя точка непрочитанного; служебное CRM (ждёт, кто
 * ведёт, напоминание, метки, кто сейчас в чате) — мелко одной строкой ниже.
 * Меню: долгое нажатие (телефон), правый щелчок или «⋯» при наведении.
 */
function Row({ c, active, onSelect, showAssignee, reminder, via, onMenu }: {
  c: DirectConversation
  active: boolean
  onSelect: (c: DirectConversation) => void
  showAssignee: boolean
  reminder: { remindAt: string; note: string | null } | null
  /** Через какой аккаунт Instagram написал клиент — когда их несколько. */
  via: string | null
  onMenu: (anchor: MenuAnchor) => void
}) {
  const me = useAuthStore(s => s.user?.id)
  const draft = useDraft(me, c.id)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)
  const last = c.lastMessage
  const unread = c.unreadCount > 0
  const bold = unread || c.markedUnread
  const who = !last || last.direction === 'in'
    ? ''
    : last.author
      ? (last.author.id === me ? 'Вы: ' : `${last.author.name.split(' ')[0]}: `)
      : 'Instagram: '
  const waitingMs = c.waitingSince ? Date.now() - new Date(c.waitingSince).getTime() : 0
  const viewers = c.viewers.filter(v => v.id !== me)
  const due = reminder ? new Date(reminder.remindAt).getTime() <= Date.now() : false
  // Черновик в открытом чате не показываем: он и так перед глазами.
  const showDraft = !!draft && !active

  const cancelPress = () => { if (press.current) clearTimeout(press.current.timer) }

  const meta: { key: string; node: ReactNode }[] = []
  if (c.waitingSince) meta.push({ key: 'wait', node: <span className="font-medium text-amber-700 dark:text-amber-300">ждёт {duration(waitingMs)}</span> })
  if (reminder) meta.push({ key: 'rem', node: <span className={clsx('inline-flex items-center gap-0.5', due ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-surface-500')} title={reminder.note || 'Напоминание'}><BellRing size={11} />{due ? 'пора' : remindLabel(reminder.remindAt)}</span> })
  if (showAssignee) meta.push({ key: 'who', node: <span className={clsx(c.assignee?.id === me ? 'font-medium text-surface-700 dark:text-surface-200' : 'text-surface-500')} title={c.assignee ? `Ведёт: ${c.assignee.name}` : undefined}>{c.assignee ? (c.assignee.id === me ? 'ведёте вы' : shortName(c.assignee.name)) : 'свободный'}</span> })
  if (via) meta.push({ key: 'via', node: <span className="text-surface-400" title={`Клиент написал в @${via}`}>@{via}</span> })
  for (const l of c.labels.slice(0, 2)) meta.push({ key: l.id, node: <span className="inline-flex items-center gap-1 text-surface-500"><span className={clsx('h-1.5 w-1.5 rounded-full', labelColor(l.color).dot)} />{l.name}</span> })
  if (c.labels.length > 2) meta.push({ key: 'more-labels', node: <span className="text-surface-400">+{c.labels.length - 2}</span> })
  if (viewers.length) meta.push({ key: 'view', node: <span className="inline-flex items-center gap-0.5 text-surface-500"><Eye size={11} />{viewers.map(v => v.name.split(' ')[0]).join(', ')}</span> })

  return (
    <li className="group/row relative">
      <button type="button"
        onClick={() => {
          if (press.current?.fired) { press.current = null; return }
          onSelect(c)
        }}
        onContextMenu={e => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY, above: e.clientY }) }}
        onTouchStart={e => {
          const t = e.touches[0]
          const point = { x: t.clientX, y: t.clientY }
          press.current = { fired: false, timer: setTimeout(() => {
            if (press.current) press.current.fired = true
            navigator.vibrate?.(15)
            onMenu({ ...point, above: point.y })
          }, 500) }
        }}
        onTouchMove={cancelPress}
        onTouchEnd={cancelPress}
        aria-current={active ? 'true' : undefined}
        className={clsx('flex w-full items-center gap-3 py-2 pl-4 pr-4 text-left transition-colors select-none [-webkit-touch-callout:none] [@media(hover:hover)]:pr-12',
          active ? 'bg-surface-100 dark:bg-surface-800' : 'hover:bg-surface-50 active:bg-surface-100 dark:hover:bg-surface-800/50 dark:active:bg-surface-800')}>
        <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={56} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className={clsx('truncate text-[15px] leading-tight', bold ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-900 dark:text-surface-100')}>{c.contact.label}</span>
            {c.pinned && <Pin size={12} className="shrink-0 text-surface-400" aria-label="Закреплён" />}
            {c.lead && <span className="shrink-0 rounded bg-surface-200 px-1 text-[9.5px] font-semibold uppercase text-surface-600 dark:bg-surface-700 dark:text-surface-300">лид</span>}
            {c.archived && <Archive size={12} className="shrink-0 text-surface-400" aria-label="В архиве" />}
          </span>
          <span className={clsx('mt-0.5 flex min-w-0 items-center text-[14px] leading-tight', bold ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-500 dark:text-surface-400')}>
            {last?.status === 'failed' && !showDraft && <AlertCircle size={13} className="mr-1 shrink-0 text-red-500" aria-label="Не доставлено" />}
            <span className="min-w-0 truncate">
              {showDraft
                ? <><span className="text-[#0095f6]">{draft!.mode === 'note' ? 'Черновик заметки: ' : 'Черновик: '}</span>{draft!.text.replace(/\s+/g, ' ')}</>
                : last ? `${who}${last.preview}` : 'Нет сообщений'}
            </span>
            <span className="shrink-0 font-normal text-surface-400" title={listTime(c.lastMessageAt)}>&nbsp;· {shortAgo(c.lastMessageAt)}</span>
          </span>
          {meta.length > 0 && (
            <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px] leading-tight">
              {meta.map((x, i) => <span key={x.key} className="inline-flex shrink-0 items-center gap-1.5">{i > 0 && <span className="text-surface-300 dark:text-surface-600">·</span>}{x.node}</span>)}
            </span>
          )}
        </span>
        {bold && (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0095f6] transition-opacity [@media(hover:hover)]:absolute [@media(hover:hover)]:right-[19px] [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:group-hover/row:opacity-0"
            aria-label={unread ? `Непрочитанных: ${c.unreadCount}` : 'Помечен непрочитанным'} title={unread ? `Непрочитанных: ${c.unreadCount}` : 'Помечен непрочитанным'} />
        )}
      </button>
      <button type="button" onClick={e => onMenu(anchorOf(e.currentTarget))}
        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-surface-600 opacity-0 shadow-sm hover:text-surface-900 focus:opacity-100 group-hover/row:opacity-100 dark:bg-surface-700 dark:text-surface-200 [@media(hover:none)]:hidden"
        aria-label={`Действия с чатом ${c.contact.label}`} aria-haspopup="menu">
        <MoreHorizontal size={16} />
      </button>
    </li>
  )
}
