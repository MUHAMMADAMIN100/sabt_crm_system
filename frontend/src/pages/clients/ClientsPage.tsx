import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { ConfirmDialog, EmptyState } from '@/components/ui'
import { clientsApi } from '@/services/api.service'
import { leadsApi } from '@/services/sales.api'
import { salesKeys } from '@/lib/salesQueries'
import { ACTIVE_STATUSES, ALL_STAGES, nextStage, normalizeStatus } from '@/lib/salesStages'
import { useHistoryOverlay } from '@/lib/navMemory'
import { usePatchUrl, useUrlFlag, useUrlNumber, useUrlState } from '@/lib/urlState'
import { useAuthStore } from '@/store/auth.store'
import type { LeadListParams, LeadStats, LeadStatus, SalesLead } from '@/types/sales'
import LeadDrawer from '@/components/sales/LeadDrawer'
import LeadCreateModal from '@/components/sales/LeadCreateModal'
import CallSheet from '@/components/sales/CallSheet'
import HandoffModal from '@/components/sales/HandoffModal'
import LostReasonModal from '@/components/sales/LostReasonModal'
import { useIsDesktop } from '@/components/sales/salesHooks'
import { SOURCE_OPTIONS, canWorkLead, formatMoney, isTopRole, salesDirectionOf } from '@/components/sales/leadUtils'
import ClientsFilters from './ClientsFilters'
import ClientsBoard, { BoardSkeleton } from './ClientsBoard'
import ClientsList, { ListSkeleton } from './ClientsList'
import { chipCounts, hasFilters, matchBoard, summaryOf, type DueFilter, type Summary } from './boardFilters'
import { useClientsActions } from './useClientsActions'

// Полная форма лида живёт в components/sales; экспорт отсюда оставлен для
// старых импортов (Директ импортировал ClientForm со страницы).
export { ClientForm } from '@/components/sales/ClientForm'

const PAGE_SIZE = 20
const VIEWS = ['board', 'list'] as const
const OWNERS = ['me', 'all'] as const
const DUES: readonly DueFilter[] = ['', 'overdue', 'today', 'none']
const STAGE_FILTERS: readonly string[] = ['', 'all', ...ALL_STAGES.map(s => s.value)]
const LEGACY_ACTIVE = ['negotiating', 'on_hold', 'unknown']

/**
 * «Клиенты» (15.11.2026, макеты «Единая воронка» и «Клиенты» на телефоне).
 * Одна воронка вместо двух (база + онбординг): вид «Воронка» — доска по
 * этапам, вид «Список» — серверная пагинация с сортировкой по ближайшему
 * действию. Лид открывается в карточке справа (на телефоне — шторкой);
 * ?lead=<id> (и старое ?id=<id>) открывает её сразу — так ведут
 * уведомления, Календарь, Директ и окно дублей.
 * Фильтры, вид и страница — в адресе: «Назад» возвращает список как был.
 */
export default function ClientsPage() {
  const user = useAuthStore(s => s.user)
  const top = isTopRole(user)
  const isSales = !!salesDirectionOf(user)
  // «Все» — руководству (и тем, кому раздел открыт доступом без роли
  // продаж: своих лидов у них нет). МП видит только свои.
  const canSeeAll = top || !isSales
  const desktop = useIsDesktop()
  const patchUrl = usePatchUrl()
  const patchRef = useRef(patchUrl)
  patchRef.current = patchUrl

  const [view, setView] = useUrlState<'board' | 'list'>('view', desktop ? 'board' : 'list', VIEWS)
  const [ownerRaw] = useUrlState<'me' | 'all'>('owner', canSeeAll ? 'all' : 'me', OWNERS)
  const owner: 'me' | 'all' = canSeeAll ? ownerRaw : 'me'
  const [due] = useUrlState<DueFilter>('due', '', DUES)
  const [source] = useUrlState<string>('source', '')
  const [hold] = useUrlFlag('hold')
  const [callFlag] = useUrlFlag('callRequested')
  const [stage] = useUrlState<string>('stage', '', STAGE_FILTERS)
  const [pageRaw, setPage] = useUrlNumber('page', 1)
  const page = Math.max(1, pageRaw)

  // Поиск печатает своим состоянием, в адрес (?q=) уходит после паузы —
  // иначе каждая буква перерисовывала бы список и дёргала сервер.
  const [qUrl] = useUrlState<string>('q', '')
  const [search, setSearch] = useState(qUrl)
  const lastQ = useRef(qUrl)
  useEffect(() => {
    if (qUrl !== lastQ.current) { lastQ.current = qUrl; setSearch(qUrl) }
  }, [qUrl])
  useEffect(() => {
    const next = search.trim()
    if (next === lastQ.current) return
    const t = setTimeout(() => { lastQ.current = next; patchRef.current({ q: next || null, page: null }) }, 250)
    return () => clearTimeout(t)
  }, [search])

  // ── Карточка лида ──────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null)
  // «Назад» на телефоне закрывает карточку, а не уходит со страницы.
  useHistoryOverlay('lead', openId, v => setOpenId(v))
  // ?lead= / ?id= из уведомлений: сначала убираем параметр из адреса
  // (F5 не откроет снова), а карточку открываем следующим шагом — чтобы
  // открытие легло отдельным шагом истории и «Назад» закрывал её с первого раза.
  const [params] = useSearchParams()
  const deepId = params.get('lead') || params.get('id')
  const pendingDeep = useRef<string | null>(null)
  useEffect(() => {
    if (deepId) {
      pendingDeep.current = deepId
      patchRef.current({ lead: null, id: null })
    } else if (pendingDeep.current) {
      const id = pendingDeep.current
      pendingDeep.current = null
      setOpenId(id)
    }
  }, [deepId])

  // ── Данные ─────────────────────────────────────────────────────────
  // Доска грузится всегда: из неё же — счётчики чипов и сводка шапки
  // (в своей области «Мои/Все», а не по всему направлению).
  const boardQ = useQuery({
    queryKey: salesKeys.board({ owner }),
    queryFn: () => leadsApi.board({ owner }),
    staleTime: 30_000,
  })
  const statsQ = useQuery<LeadStats>({ queryKey: ['clients-stats'], queryFn: clientsApi.stats, staleTime: 60_000 })

  const listParams: LeadListParams = {
    owner,
    search: qUrl || undefined,
    due: due || undefined,
    source: source || undefined,
    hold: hold ? '1' : undefined,
    status: stage === '' ? ACTIVE_STATUSES.join(',') : stage === 'all' ? undefined : stage,
    page,
    pageSize: PAGE_SIZE,
    sort: 'next',
  }
  // «К звонку» сервер списком не фильтрует — берём отмеченных из доски.
  const listOn = view === 'list' && !callFlag
  const listQ = useQuery({
    queryKey: salesKeys.list(listParams),
    queryFn: () => leadsApi.page(listParams),
    placeholderData: keepPreviousData,
    enabled: listOn,
  })
  useEffect(() => {
    const d = listQ.data
    if (listOn && d && d.items.length === 0 && d.total > 0 && page > 1) setPage(1)
  }, [listOn, listQ.data, page, setPage])

  const boardItems = boardQ.data ?? []
  const filters = { q: qUrl, due, source, hold, callRequested: callFlag }
  const filtersActive = hasFilters(filters) || (view === 'list' && !!stage)
  const visible = useMemo(() => boardItems.filter(l => matchBoard(l, filters)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardItems, qUrl, due, source, hold, callFlag])
  const counts = boardQ.data ? chipCounts(boardQ.data) : null
  const sources = useMemo(() => {
    const set = new Set(SOURCE_OPTIONS)
    for (const l of boardItems) if (l.leadSource) set.add(l.leadSource)
    if (source) set.add(source)
    return Array.from(set)
  }, [boardItems, source])

  const summary: Summary | null = boardQ.data
    ? summaryOf(boardQ.data)
    : statsQ.data
      ? {
          inWork: [...ACTIVE_STATUSES, ...LEGACY_ACTIVE].reduce((a, s) => a + (statsQ.data!.byStatus?.[s] || 0), 0),
          potential: Number(statsQ.data.totalPotential ?? statsQ.data.openPotential ?? 0),
          forecast: Number(statsQ.data.forecast ?? NaN),
        }
      : null

  // ── Действия ───────────────────────────────────────────────────────
  const { move, hold: holdMut, remove, callRequest } = useClientsActions()
  const [showCreate, setShowCreate] = useState(false)
  const [callLead, setCallLead] = useState<SalesLead | null>(null)
  const [handoffLead, setHandoffLead] = useState<SalesLead | null>(null)
  const [lostLead, setLostLead] = useState<SalesLead | null>(null)
  const [deleteLead, setDeleteLead] = useState<SalesLead | null>(null)

  // «→» и перетаскивание — по своим лидам и лидам без владельца; чужие в
  // «Все» — вид для просмотра (руководство действует из карточки).
  const canMove = (l: SalesLead) => canWorkLead(user, l) && (!l.ownerId || l.ownerId === user?.id)
  const advance = (l: SalesLead) => {
    const next = nextStage(l.status)
    if (next) move.mutate({ id: l.id, status: next.value })
    else if (normalizeStatus(l.status) === 'contract') setHandoffLead(l)
  }
  const dropTo = (l: SalesLead, to: LeadStatus) => {
    if (to === 'won') setHandoffLead(l)
    else if (to === 'lost') setLostLead(l)
    else move.mutate({ id: l.id, status: to })
  }
  const resetFilters = () => {
    setSearch('')
    lastQ.current = ''
    patchUrl({ q: null, due: null, source: null, hold: null, callRequested: null, stage: null, page: null })
  }
  const open = (l: SalesLead) => setOpenId(l.id)

  const listHandlers = {
    onOpen: open,
    onCall: (l: SalesLead) => setCallLead(l),
    onToggleHold: (l: SalesLead) => holdMut.mutate({ id: l.id, onHold: !l.onHold }),
    onDelete: (l: SalesLead) => setDeleteLead(l),
    onCallRequest: (ids: string[], flag: boolean) => callRequest.mutate({ ids, flag }),
  }

  // ── Отрисовка ──────────────────────────────────────────────────────
  const nothingFound = (
    <EmptyState
      title="Ничего не найдено"
      description="Попробуйте изменить поиск или фильтры."
      action={<button type="button" onClick={resetFilters} className="btn-secondary min-h-[44px]">Сбросить фильтры</button>}
    />
  )
  const noLeads = (
    <EmptyState
      title={owner === 'me' ? 'У вас пока нет лидов' : 'Пока нет лидов'}
      description="Добавьте первого клиента — дальше воронка подскажет следующий шаг."
      action={<button type="button" onClick={() => setShowCreate(true)} className="btn-primary min-h-[44px]"><Plus size={16} aria-hidden="true" /> Новый лид</button>}
    />
  )

  let content: ReactNode
  if (view === 'board' || callFlag) {
    if (boardQ.isPending) content = view === 'board' ? <BoardSkeleton /> : <ListSkeleton />
    else if (boardQ.isError) content = <LoadError onRetry={() => boardQ.refetch()} />
    else if (boardItems.length === 0 && !filtersActive) content = noLeads
    else if (visible.length === 0 && filtersActive) content = nothingFound
    else if (view === 'board') {
      content = <ClientsBoard items={visible} onOpen={open} onAdvance={advance} onDrop={dropTo} canMove={canMove} desktop={desktop} />
    } else {
      const total = visible.length
      const p = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)))
      content = (
        <ClientsList items={visible.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE)} total={total} page={p} pageSize={PAGE_SIZE}
          onPage={setPage} fetching={boardQ.isFetching} showOwner={owner === 'all'} isBoss={top}
          callPending={callRequest.isPending} h={listHandlers} />
      )
    }
  } else {
    const data = listQ.data
    if (listQ.isError) content = <LoadError onRetry={() => listQ.refetch()} />
    else if (!data) content = <ListSkeleton />
    else if (data.items.length === 0) content = filtersActive ? nothingFound : noLeads
    else {
      content = (
        <ClientsList items={data.items} total={data.total} page={data.page || page} pageSize={data.pageSize || PAGE_SIZE}
          onPage={setPage} fetching={listQ.isFetching} showOwner={owner === 'all'} isBoss={top}
          callPending={callRequest.isPending} h={listHandlers} />
      )
    }
  }

  return (
    <>
      {/* Карточка лида на компьютере — панель справа 560 px; страница
          отступает, чтобы список и доска оставались видны рядом. */}
      <div className={clsx('space-y-4 transition-[margin] duration-200', openId && 'lg:mr-[552px]')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title">Клиенты</h1>
            <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
              {summary ? (
                <>
                  <b className="font-semibold text-surface-800 dark:text-surface-100">{summary.inWork}</b> в работе
                  {' · '}в воронке {formatMoney(summary.potential)}
                  {Number.isFinite(summary.forecast) && <> · с учётом вероятности ≈ {formatMoney(summary.forecast)}</>}
                </>
              ) : (
                <span className="skeleton inline-block h-4 w-64 align-middle" aria-hidden="true" />
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Вид" className="inline-flex overflow-hidden rounded-lg border border-surface-300 dark:border-surface-600">
              {VIEWS.map(v => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={clsx(
                    'inline-flex min-h-[36px] items-center gap-1.5 px-3 text-sm font-medium transition-colors max-lg:min-h-[44px]',
                    view === v
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-50 text-surface-700 hover:bg-surface-100 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700',
                  )}
                >
                  {v === 'board' ? <LayoutGrid size={15} aria-hidden="true" /> : <List size={15} aria-hidden="true" />}
                  {v === 'board' ? 'Воронка' : 'Список'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary min-h-[36px] max-lg:min-h-[44px]">
              <Plus size={16} aria-hidden="true" /> Новый лид
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <label htmlFor="clients-search" className="sr-only">Поиск клиентов</label>
            <input
              id="clients-search"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Название, телефон, Instagram, сфера"
              className="input pl-9"
            />
          </div>
          {view === 'list' && !callFlag && (
            <>
              <label htmlFor="clients-stage" className="sr-only">Этап</label>
              <select id="clients-stage" value={stage} onChange={e => patchUrl({ stage: e.target.value || null, page: null })} className="input sm:w-48">
                <option value="">Активные этапы</option>
                <option value="all">Все этапы</option>
                {ALL_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </>
          )}
        </div>

        <ClientsFilters
          canSeeAll={canSeeAll}
          owner={owner}
          onOwner={v => patchUrl({ owner: v === 'all' ? null : v, page: null })}
          due={due}
          onDue={v => patchUrl({ due: v || null, page: null })}
          counts={counts}
          source={source}
          sources={sources}
          onSource={v => patchUrl({ source: v || null, page: null })}
          hold={hold}
          onHold={v => patchUrl({ hold: v ? '1' : null, page: null })}
          callFlag={callFlag}
          onCallFlag={v => patchUrl({ callRequested: v ? '1' : null, page: null })}
        />

        {content}
      </div>

      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} />
      <LeadCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
      <CallSheet lead={callLead} onClose={() => setCallLead(null)} />
      <HandoffModal lead={handoffLead} onClose={() => setHandoffLead(null)} />
      <LostReasonModal lead={lostLead} onClose={() => setLostLead(null)} />
      <ConfirmDialog
        open={!!deleteLead}
        onClose={() => setDeleteLead(null)}
        onConfirm={() => {
          if (!deleteLead) return
          if (openId === deleteLead.id) setOpenId(null)
          remove.mutate(deleteLead.id)
        }}
        title="Удалить лид?"
        message={deleteLead ? `«${deleteLead.name}» и его история будут удалены безвозвратно.` : undefined}
        danger
      />
    </>
  )
}

/** Ошибка загрузки — никогда не «Нет клиентов»: пустой список при сбое
 *  выглядел бы как потерянная база. */
function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 py-10 text-center">
      <p className="font-medium text-surface-800 dark:text-surface-100">Не удалось загрузить клиентов</p>
      <p className="text-sm text-surface-500 dark:text-surface-400">Проверьте связь и попробуйте ещё раз.</p>
      <button type="button" onClick={onRetry} className="btn-secondary min-h-[44px]">Повторить</button>
    </div>
  )
}
