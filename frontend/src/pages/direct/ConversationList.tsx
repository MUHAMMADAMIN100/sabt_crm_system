import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertCircle, Archive, AtSign, BellRing, Check, Eye, Inbox, MoreHorizontal, Pin, Search, SlidersHorizontal, User as UserIcon, X,
} from 'lucide-react'
import { directApi, type DirectConversation, type DirectFilters, type DirectView } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import ContactAvatar from './ContactAvatar'
import { duration, listTime, clockTime, dayLabel, shortAgo } from './directTime'
import { useMedia } from './useMedia'
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
export default function ConversationList({ selectedId, onSelect, onOpenMessage, assigneeId, onAssigneeChange, searchRef, onOrder }: {
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
  // Телефон — список как в Instagram (13.11.2026).
  const phone = useMedia('(max-width: 639px)')
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-surface-200 p-3 dark:border-surface-700">
        <div className="flex gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-2.5 dark:border-surface-700 dark:bg-surface-900">
            <Search size={15} className="shrink-0 text-surface-400" />
            <input
              ref={el => { if (searchRef) searchRef.current = el }}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape' && search) { e.preventDefault(); e.stopPropagation(); setSearch('') } }}
              placeholder={top ? 'Имя или текст' : 'Имя, @ник или текст'}
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-surface-400"
              aria-label="Поиск по чатам и сообщениям"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="shrink-0 rounded p-0.5 text-surface-400 hover:text-surface-700" aria-label="Очистить поиск">
                <X size={14} />
              </button>
            )}
          </label>
          <button type="button" onClick={e => setFiltersMenu(anchorOf(e.currentTarget))}
            className={clsx('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
              activeFilters ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300'
                : 'border-surface-200 bg-surface-50 text-surface-500 hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-900')}
            aria-label={activeFilters ? `Фильтры: ${activeFilters}` : 'Фильтры'} title="Фильтры: метка, лид, напоминания" aria-haspopup="menu">
            <SlidersHorizontal size={16} />
            {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">{activeFilters}</span>}
          </button>
          {/* Руководство смотрит чаты любого менеджера продаж */}
          {top && (
            <select
              value={assigneeId || ''}
              onChange={e => onAssigneeChange(e.target.value || null)}
              className={clsx('h-9 w-[38%] max-w-[170px] shrink-0 cursor-pointer truncate rounded-lg border px-2 text-[13px] outline-none dark:bg-surface-900',
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
        {/* Несколько аккаунтов Instagram — чьи чаты показывать. */}
        {multi && (
          <div className="flex gap-1 overflow-x-auto rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800" role="radiogroup" aria-label="Аккаунт Instagram">
            {[{ id: null as string | null, label: 'Все аккаунты' }, ...accounts.map(a => ({ id: a.accountId as string | null, label: `@${a.username || 'Instagram'}` }))].map(o => (
              <button key={o.id || 'all'} type="button" role="radio" aria-checked={account === o.id} onClick={() => setAccount(o.id)}
                className={clsx('min-h-[30px] shrink-0 truncate rounded-md px-2.5 text-xs font-medium transition-colors',
                  account === o.id ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-600 dark:text-white' : 'text-surface-500 hover:text-surface-800 dark:hover:text-surface-200')}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {/* Вкладки переносятся строкой ниже, а не уезжают за край. */}
        <div className={clsx('flex gap-1.5', phone ? '-mx-3 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap')} role="tablist">
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
              {v.key === 'archived' && <Archive size={12} />}
              {v.label}
              {counts && <span className={clsx('tabular-nums', view === v.key ? 'opacity-80' : 'text-surface-400')}>{counts[v.key]}</span>}
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
                phone={phone}
                onMenu={anchor => setRowMenu({ c, anchor })} />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="p-3">
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

function Row({ c, active, onSelect, showAssignee, reminder, via, onMenu, phone = false }: {
  c: DirectConversation
  active: boolean
  onSelect: (c: DirectConversation) => void
  showAssignee: boolean
  reminder: { remindAt: string; note: string | null } | null
  /** Через какой аккаунт Instagram написал клиент — когда их несколько. */
  via: string | null
  /** Телефон: строка как в Instagram. */
  phone?: boolean
  onMenu: (anchor: MenuAnchor) => void
}) {
  const me = useAuthStore(s => s.user?.id)
  const draft = useDraft(me, c.id)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)
  const last = c.lastMessage
  const unread = c.unreadCount > 0
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
  const pressHandlers = {
    onClick: () => {
      if (press.current?.fired) { press.current = null; return }
      onSelect(c)
    },
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY, above: e.clientY }) },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      const point = { x: t.clientX, y: t.clientY }
      press.current = { fired: false, timer: setTimeout(() => {
        if (press.current) press.current.fired = true
        navigator.vibrate?.(15)
        onMenu({ ...point, above: point.y })
      }, 500) }
    },
    onTouchMove: cancelPress,
    onTouchEnd: cancelPress,
  }

  // Телефон: как в Instagram — крупный аватар, имя, «текст · 5 мин», точка
  // непрочитанного; служебное (ждёт, кто ведёт, метки) — мелко одной строкой.
  if (phone) {
    const bold = unread || c.markedUnread
    const meta: { key: string; node: ReactNode }[] = []
    if (via) meta.push({ key: 'via', node: <span className="text-surface-400">@{via}</span> })
    if (c.waitingSince) meta.push({ key: 'wait', node: <span className="font-medium text-amber-700 dark:text-amber-300">ждёт {duration(waitingMs)}</span> })
    if (reminder) meta.push({ key: 'rem', node: <span className={clsx('inline-flex items-center gap-0.5', due ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-surface-500')}><BellRing size={11} />{due ? 'пора' : remindLabel(reminder.remindAt)}</span> })
    if (showAssignee) meta.push({ key: 'who', node: <span className="text-surface-500">{c.assignee ? (c.assignee.id === me ? 'ведёте вы' : shortName(c.assignee.name)) : 'свободный'}</span> })
    for (const l of c.labels.slice(0, 2)) meta.push({ key: l.id, node: <span className="inline-flex items-center gap-1 text-surface-500"><span className={clsx('h-1.5 w-1.5 rounded-full', labelColor(l.color).dot)} />{l.name}</span> })
    return (
      <li className="relative">
        <button type="button" {...pressHandlers}
          className={clsx('direct-phone-bubble flex w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-100 dark:active:bg-surface-800',
            active && 'bg-surface-100 dark:bg-surface-800')}>
          <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={56} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className={clsx('truncate text-[15px]', bold ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-900 dark:text-surface-100')}>{c.contact.label}</span>
              {c.pinned && <Pin size={12} className="shrink-0 text-surface-400" aria-label="Закреплён" />}
              {c.lead && <span className="shrink-0 rounded bg-surface-200 px-1 text-[9.5px] font-semibold uppercase text-surface-600 dark:bg-surface-700 dark:text-surface-300">лид</span>}
            </span>
            <span className={clsx('flex min-w-0 items-center text-[14px]', bold ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-500 dark:text-surface-400')}>
              {last?.status === 'failed' && !showDraft && <AlertCircle size={13} className="mr-1 shrink-0 text-red-500" aria-label="Не доставлено" />}
              <span className="min-w-0 truncate">
                {showDraft
                  ? <><span className="text-primary-700 dark:text-primary-300">{draft!.mode === 'note' ? 'Черновик заметки: ' : 'Черновик: '}</span>{draft!.text.replace(/\s+/g, ' ')}</>
                  : last ? `${who}${last.preview}` : 'Нет сообщений'}
              </span>
              <span className="shrink-0 font-normal text-surface-400">&nbsp;· {shortAgo(c.lastMessageAt)}</span>
            </span>
            {meta.length > 0 && (
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px]">
                {meta.map((x, i) => <span key={x.key} className="inline-flex shrink-0 items-center gap-1.5">{i > 0 && <span className="text-surface-300 dark:text-surface-600">·</span>}{x.node}</span>)}
              </span>
            )}
          </span>
          {(unread || c.markedUnread) && <span className="h-3 w-3 shrink-0 rounded-full bg-primary-500" aria-label={unread ? `Непрочитанных: ${c.unreadCount}` : 'Помечен непрочитанным'} />}
        </button>
      </li>
    )
  }

  return (
    <li className="group relative">
      <button
        type="button"
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
        className={clsx(
          'flex w-full items-start gap-3 border-b border-surface-100 px-3 py-2.5 pr-9 text-left transition-colors dark:border-surface-700/60',
          active ? 'bg-surface-100 dark:bg-surface-700/60' : 'hover:bg-surface-100/60 dark:hover:bg-surface-700/30',
          c.pinned && !active && 'bg-surface-50/70 dark:bg-surface-800/40',
        )}
      >
        <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className={clsx('truncate text-sm', unread || c.markedUnread ? 'font-semibold text-surface-900 dark:text-white' : 'font-medium text-surface-800 dark:text-surface-100')}>
              {c.contact.label}
            </span>
            {c.lead && <span className="shrink-0 rounded bg-surface-200 px-1 text-[10px] font-semibold uppercase tracking-wide text-surface-600 dark:bg-surface-700 dark:text-surface-300">лид</span>}
            {c.archived && <Archive size={12} className="shrink-0 self-center text-surface-400" aria-label="В архиве" />}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-surface-400">
              {c.pinned && <Pin size={11} className="text-surface-400" aria-label="Закреплён" />}
              {listTime(c.lastMessageAt)}
            </span>
          </span>
          {c.contact.name && c.contact.username && (
            <span className="block truncate text-[11px] text-surface-400">@{c.contact.username}</span>
          )}
          <span className="mt-0.5 flex items-center gap-2">
            {last?.status === 'failed' && !showDraft && (
              <AlertCircle size={13} className="shrink-0 text-red-500" aria-label="Не доставлено" />
            )}
            <span className={clsx('min-w-0 flex-1 truncate text-[13px]', unread ? 'text-surface-800 dark:text-surface-100' : 'text-surface-500 dark:text-surface-400')}>
              {showDraft
                ? <><span className="font-medium text-primary-700 dark:text-primary-300">{draft!.mode === 'note' ? 'Черновик заметки: ' : 'Черновик: '}</span>{draft!.text.replace(/\s+/g, ' ')}</>
                : last ? `${who}${last.preview}` : 'Нет сообщений'}
            </span>
            {unread ? (
              <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[11px] font-bold text-white">
                {c.unreadCount > 99 ? '99+' : c.unreadCount}
              </span>
            ) : c.markedUnread ? (
              <span className="h-3 w-3 shrink-0 rounded-full bg-primary-600" aria-label="Помечен непрочитанным" title="Помечен непрочитанным" />
            ) : null}
          </span>
          {(via || showAssignee || c.waitingSince || viewers.length > 0 || reminder || c.labels.length > 0) && (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {via && (
                <span className="inline-flex max-w-[140px] items-center gap-0.5 rounded-full border border-surface-200 px-1.5 py-px text-[11px] text-surface-500 dark:border-surface-600 dark:text-surface-400" title={`Клиент написал в @${via}`}>
                  <AtSign size={10} className="shrink-0" /><span className="truncate">{via}</span>
                </span>
              )}
              {showAssignee && <AssigneeChip c={c} me={me} />}
              {c.waitingSince && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  ждёт ответа {duration(waitingMs)}
                </span>
              )}
              {reminder && (
                <span title={reminder.note || 'Напоминание'} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  due ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300')}>
                  <BellRing size={11} /> {due ? 'пора вернуться' : remindLabel(reminder.remindAt)}
                </span>
              )}
              {c.labels.slice(0, 2).map(l => (
                <span key={l.id} className={clsx('inline-flex max-w-[110px] items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium', labelColor(l.color).chip)}>
                  <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', labelColor(l.color).dot)} />
                  <span className="truncate">{l.name}</span>
                </span>
              ))}
              {c.labels.length > 2 && <span className="text-[11px] text-surface-400">+{c.labels.length - 2}</span>}
              {viewers.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-surface-500">
                  <Eye size={12} /> {viewers.map(v => v.name.split(' ')[0]).join(', ')}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      <button type="button" onClick={e => onMenu(anchorOf(e.currentTarget))}
        className="absolute right-1.5 top-9 flex h-7 w-7 items-center justify-center rounded-md text-surface-400 opacity-0 hover:bg-surface-200 hover:text-surface-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-surface-600 dark:hover:text-surface-100 [@media(hover:none)]:hidden"
        aria-label={`Действия с чатом ${c.contact.label}`} aria-haspopup="menu">
        <MoreHorizontal size={16} />
      </button>
    </li>
  )
}
