// СММ — календарь производства в минималистичном стиле (как Notion). Виды
// Месяц / Неделя / День + таб «Сторисы» (мини-календари по проектам). Публикации
// (зелёные) и съёмки (янтарные, со временем). Статус публикации: опубликовано —
// ярко + галочка, нет — бледно. Drag-перенос на другой день.
import { useMemo, useState, useEffect, useRef, Fragment, type ReactNode, type DragEvent as RDragEvent } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, isSameDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Camera, X, Check, RotateCcw, Search, Film, AlignLeft, Image as ImageIcon, Circle } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi, workflowApi, tasksApi } from '@/services/api.service'

type Ev = {
  id: string; itemId?: string; shootId?: string; kind: 'shoot' | 'publication'; date: string
  projectId: string; projectName: string
  title?: string; time?: string | null; location?: string | null; note?: string | null
  contentType?: string; topic?: string | null; status?: string; assigneeName?: string | null
  taskId?: string | null; taskStatus?: string | null
}

/** «Сделано» для публикации: опубликовано ИЛИ связанная задача выполнена. */
const isDone = (e: Ev) => e.status === 'published' || e.taskStatus === 'done'
type CalData = { from: string; to: string; events: Ev[]; projects: { id: string; name: string }[] }
type View = 'month' | 'week' | 'day' | 'stories'

// ─── мягкая палитра (Notion-стиль), адаптивная к теме ─────────────────
// Иконка по типу контента — тип виден сразу, без чтения текста.
const TYPE_ICON: Record<string, any> = {
  reel: Film, video: Film, design: ImageIcon, story: Circle,
  post: AlignLeft, ad: AlignLeft, carousel: ImageIcon, other: AlignLeft,
}

// Цвет проекта — стабильный по projectId; средние тона читаются в обеих темах.
const PROJ_COLORS = ['#4fb3ac', '#7d8bea', '#d06e90', '#cf9f52', '#5fbd80', '#5aa9d8', '#c07be0', '#e0865a', '#d0b24f', '#8a97a6', '#6ac0a0', '#e07aa8']
function projColor(id: string): string {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PROJ_COLORS[h % PROJ_COLORS.length]
}
// Мягкая заливка пилюли в цвет проекта (тон проступает над фоном страницы).
function projFill(id: string): { background: string; color: string } {
  const c = projColor(id)
  return { background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }
}

const TYPE_LABEL: Record<string, string> = {
  reel: 'Reel', story: 'Сторис', post: 'Пост', design: 'Макет',
  ad: 'Реклама', video: 'Видео', carousel: 'Карусель', other: 'Контент',
}

// ─── категории для точек (таб «Сторисы») ──────────────────────────────
type Cat = 'shoot' | 'reel' | 'design' | 'story' | 'post'
const CAT_ORDER: Cat[] = ['shoot', 'reel', 'design', 'story', 'post']
const CAT_DOT: Record<Cat, string> = {
  shoot: 'bg-amber-500', reel: 'bg-emerald-500', design: 'bg-violet-500', story: 'bg-sky-500', post: 'bg-blue-500',
}
const CAT_LABEL: Record<Cat, string> = { shoot: 'Съёмка', reel: 'Reel', design: 'Макет', story: 'Сторис', post: 'Пост' }
function catOf(e: Ev): Cat {
  if (e.kind === 'shoot') return 'shoot'
  const t = e.contentType
  if (t === 'reel' || t === 'video') return 'reel'
  if (t === 'design') return 'design'
  if (t === 'story') return 'story'
  return 'post'
}

// ─── helpers ──────────────────────────────────────────────────────────
function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const todayIso = () => new Date().toLocaleDateString('en-CA')

function parseTime(t?: string | null): { h: number; m: number } | null {
  if (!t) return null
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(String(t).trim())
  if (!m) return null
  const h = +m[1], mm = m[2] ? +m[2] : 0
  if (h < 0 || h > 23) return null
  return { h, m: mm }
}
function matchSearch(e: Ev, q: string): boolean {
  if (!q) return true
  const hay = [e.projectName, e.topic, e.title, e.location, e.contentType, TYPE_LABEL[e.contentType || ''], e.assigneeName]
    .filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

type Cell = { label: number; inMonth: boolean; iso: string | null }
function buildCells(ym: string): Cell[] {
  const [y, m] = ym.split('-').map(Number)
  const startWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(y, m, 0).getDate()
  const prevDays = new Date(y, m - 1, 0).getDate()
  const total = Math.ceil((startWeekday + daysInMonth) / 7) * 7
  const out: Cell[] = []
  for (let i = 0; i < total; i++) {
    const dn = i - startWeekday + 1
    if (dn < 1) out.push({ label: prevDays + dn, inMonth: false, iso: null })
    else if (dn > daysInMonth) out.push({ label: dn - daysInMonth, inMonth: false, iso: null })
    else out.push({ label: dn, inMonth: true, iso: `${ym}-${String(dn).padStart(2, '0')}` })
  }
  return out
}

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MAX_PER_DAY = 4
const HOUR_PX = 50
const VIEWS: { k: View; label: string }[] = [
  { k: 'month', label: 'Месяц' }, { k: 'week', label: 'Неделя' }, { k: 'day', label: 'День' }, { k: 'stories', label: 'Сторисы' },
]

// ═══════════════════════════════════════════════════════════════════════
export default function SmmPage() {
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(new Date())
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)

  const { from, to } = useMemo(() => {
    if (view === 'week') return { from: iso(startOfWeek(cursor, { weekStartsOn: 1 })), to: iso(endOfWeek(cursor, { weekStartsOn: 1 })) }
    if (view === 'day') return { from: iso(cursor), to: iso(cursor) }
    return { from: iso(startOfMonth(cursor)), to: iso(endOfMonth(cursor)) } // month + stories
  }, [view, cursor])

  const { data, isLoading, isFetching } = useQuery<CalData>({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
    placeholderData: keepPreviousData,
  })

  const allEvents = data?.events ?? []
  const projects = data?.projects ?? []
  const today = todayIso()

  const qc = useQueryClient()
  const [detail, setDetail] = useState<Ev | null>(null)
  const markMut = useMutation({
    mutationFn: ({ ev, done }: { ev: Ev; done: boolean }) =>
      ev.taskId
        ? tasksApi.update(ev.taskId, { status: done ? 'done' : 'in_progress' })
        : contentPlanApi.update(ev.itemId!, { status: done ? 'published' : 'planned' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Обновлено'); setDetail(null) },
    onError: () => toast.error('Не удалось обновить'),
  })

  // Drag-перенос: оптимистичные оверрайды даты (чистятся, когда сервер догонит).
  const [moveOverrides, setMoveOverrides] = useState<Record<string, string>>({})
  useEffect(() => {
    setMoveOverrides(prev => {
      if (!Object.keys(prev).length) return prev
      let changed = false; const next = { ...prev }
      for (const e of allEvents) if (next[e.id] && next[e.id] === e.date) { delete next[e.id]; changed = true }
      return changed ? next : prev
    })
  }, [allEvents])
  const effEvents = useMemo(
    () => allEvents.map(e => (moveOverrides[e.id] ? { ...e, date: moveOverrides[e.id] } : e)),
    [allEvents, moveOverrides],
  )

  const dragRef = useRef<Ev | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const moveMut = useMutation({
    mutationFn: ({ ev, dateStr }: { ev: Ev; dateStr: string }) =>
      ev.kind === 'publication'
        ? contentPlanApi.update(ev.itemId!, { publishDate: `${dateStr}T12:00:00` })
        : workflowApi.updateShootSession(ev.shootId!, { date: dateStr }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smm-calendar'] }),
    onError: (_e, vars) => {
      setMoveOverrides(prev => { const n = { ...prev }; delete n[vars.ev.id]; return n })
      toast.error('Не удалось перенести')
    },
  })
  const onDragStartEv = (e: Ev) => { dragRef.current = e; setDragOverKey(null) }
  const onDropDate = (dateStr: string) => {
    const e = dragRef.current
    dragRef.current = null
    setDragOverKey(null)
    if (!e || e.date === dateStr) return
    const refId = e.kind === 'publication' ? e.itemId : e.shootId
    if (!refId) return
    setMoveOverrides(prev => ({ ...prev, [e.id]: dateStr }))
    moveMut.mutate({ ev: e, dateStr })
  }

  // Основной вид: проект + поиск + без сторис (сторис — в отдельном табе).
  const mainEvents = useMemo(() => effEvents.filter(e =>
    (!projectId || e.projectId === projectId)
    && matchSearch(e, search)
    && !(e.kind === 'publication' && e.contentType === 'story')
  ), [effEvents, projectId, search])

  const mainByDate = useMemo(() => {
    const map = new Map<string, Ev[]>()
    for (const e of mainEvents) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date)!.push(e)
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shoot' ? -1 : 1))
    return map
  }, [mainEvents])

  // Таб «Сторисы»: мини-календари по проекту → дате (все события, в т.ч. сторис).
  const byProject = useMemo(() => {
    const m = new Map<string, Map<string, Ev[]>>()
    for (const e of effEvents) {
      if (!m.has(e.projectId)) m.set(e.projectId, new Map())
      const dm = m.get(e.projectId)!
      if (!dm.has(e.date)) dm.set(e.date, [])
      dm.get(e.date)!.push(e)
    }
    return m
  }, [effEvents])

  const monthStr = format(cursor, 'yyyy-MM')
  const cells = useMemo(() => buildCells(monthStr), [monthStr])

  const title = view === 'day'
    ? cursor.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
    : view === 'week'
      ? `${startOfWeek(cursor, { weekStartsOn: 1 }).toLocaleDateString('ru-RU', { day: 'numeric' })}–${endOfWeek(cursor, { weekStartsOn: 1 }).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
      : monthTitle(monthStr)

  const step = (dir: number) => setCursor(c =>
    view === 'week' ? addDays(c, dir * 7) : view === 'day' ? addDays(c, dir) : addMonths(c, dir))

  const weekDays = useMemo(() => {
    if (view === 'week') { const s = startOfWeek(cursor, { weekStartsOn: 1 }); return Array.from({ length: 7 }, (_, i) => addDays(s, i)) }
    if (view === 'day') return [cursor]
    return []
  }, [view, cursor])

  return (
    <div className="space-y-3">
      {/* ── шапка ── */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">СММ</div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800/70 p-0.5">
            {VIEWS.map(v => (
              <button key={v.k} onClick={() => setView(v.k)}
                className={'px-3 py-1.5 text-[13px] font-semibold rounded-md transition ' + (view === v.k ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
                {v.label}
              </button>
            ))}
          </div>
          <button onClick={() => setCursor(new Date())} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Сегодня</button>
          <div className="flex items-center gap-0.5">
            <button onClick={() => step(-1)} className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft size={17} /></button>
            <button onClick={() => step(1)} className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronRight size={17} /></button>
          </div>
        </div>
      </header>

      {/* ── фильтр по проекту + поиск ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5">
          <Search size={13} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск"
            className="bg-transparent text-[13px] outline-none w-28 placeholder:text-gray-400" />
          {search && <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>}
        </div>
        <div className="relative">
          <button onClick={() => setFilterOpen(o => !o)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300">
            {projectId && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: projColor(projectId) }} />}
            {projects.find(p => p.id === projectId)?.name || 'Все проекты'}
            <ChevronDown size={14} className="text-gray-400" />
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-40 w-56 max-h-72 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1">
                <button onClick={() => { setProjectId(undefined); setFilterOpen(false) }}
                  className={'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left hover:bg-gray-100 dark:hover:bg-gray-800 ' + (!projectId ? 'font-semibold' : '')}>
                  Все проекты {!projectId && <Check size={14} className="ml-auto text-gray-400 shrink-0" />}
                </button>
                {projects.map(p => (
                  <button key={p.id} onClick={() => { setProjectId(p.id); setFilterOpen(false) }}
                    className={'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left hover:bg-gray-100 dark:hover:bg-gray-800 ' + (projectId === p.id ? 'font-semibold' : '')}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: projColor(p.id) }} />
                    <span className="truncate">{p.name}</span>
                    {projectId === p.id && <Check size={14} className="ml-auto text-gray-400 shrink-0" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : view === 'stories' ? (
        <StoriesTab projects={projects} cells={cells} byProject={byProject} today={today} monthLabel={monthTitle(monthStr)}
          activeId={projectId} onPick={id => setProjectId(projectId === id ? undefined : id)} fetching={isFetching} />
      ) : view === 'month' ? (
        <div className={'transition ' + (isFetching ? 'opacity-60' : '')}>
          <MonthView cells={cells} byDate={mainByDate} today={today}
            onOpen={setDetail} onDragStart={onDragStartEv} onDropDate={onDropDate}
            dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          <MiniLegend />
        </div>
      ) : (
        <div className={'transition ' + (isFetching ? 'opacity-60' : '')}>
          <TimeGridView days={weekDays} events={mainEvents} onOpen={setDetail}
            onDragStart={onDragStartEv} onDropDate={onDropDate} dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          <MiniLegend />
        </div>
      )}

      {detail && (
        <EventModal e={detail} marking={markMut.isPending} onClose={() => setDetail(null)}
          onMark={done => markMut.mutate({ ev: detail, done })} />
      )}
    </div>
  )
}

// ─── МЕСЯЦ ─────────────────────────────────────────────────────────────
function MonthView({ cells, byDate, today, onOpen, onDragStart, onDropDate, dragOverKey, setDragOverKey }: {
  cells: Cell[]; byDate: Map<string, Ev[]>; today: string
  onOpen: (e: Ev) => void; onDragStart: (e: Ev) => void; onDropDate: (d: string) => void
  dragOverKey: string | null; setDragOverKey: (k: string | null) => void
}) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-800">
      <div className="grid grid-cols-7">
        {DOW.map((d, i) => (
          <div key={d} className={'px-2 py-2 text-[11px] font-semibold uppercase tracking-wide border-b border-gray-200 dark:border-gray-800 ' + (i >= 5 ? 'text-gray-400/70' : 'text-gray-400')}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          const evs = c.iso ? (byDate.get(c.iso) ?? []) : []
          const isToday = c.iso === today
          return (
            <div key={i}
              onDragOver={c.iso ? (ev => { ev.preventDefault(); if (dragOverKey !== c.iso) setDragOverKey(c.iso) }) : undefined}
              onDragLeave={c.iso ? (() => setDragOverKey(dragOverKey === c.iso ? null : dragOverKey)) : undefined}
              onDrop={c.iso ? (() => onDropDate(c.iso!)) : undefined}
              className={'min-h-[112px] border-b border-r border-gray-100 dark:border-gray-800/80 p-1 flex flex-col gap-0.5 '
                + ((i + 1) % 7 === 0 ? 'border-r-0 ' : '')
                + (c.iso && dragOverKey === c.iso ? 'ring-1 ring-inset ring-gray-400 ' : '')
                + (!c.inMonth ? 'bg-gray-50/40 dark:bg-black/20' : isToday ? 'bg-[#eb5757]/[0.06]' : (i % 7 >= 5 ? 'bg-gray-50/50 dark:bg-white/[0.015]' : ''))}>
              <span className={'text-[12px] font-semibold self-end px-1 ' + (isToday ? 'bg-[#eb5757] text-white rounded-full w-[20px] h-[20px] grid place-items-center' : c.inMonth ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600')}>{c.label}</span>
              {evs.slice(0, MAX_PER_DAY).map(e => <EventChip key={e.id} e={e} onOpen={onOpen} onDragStart={onDragStart} />)}
              {evs.length > MAX_PER_DAY && <span className="text-[11px] text-gray-400 px-1">+{evs.length - MAX_PER_DAY}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── НЕДЕЛЯ / ДЕНЬ ─────────────────────────────────────────────────────
function TimeGridView({ days, events, onOpen, onDragStart, onDropDate, dragOverKey, setDragOverKey }: {
  days: Date[]; events: Ev[]; onOpen: (e: Ev) => void
  onDragStart: (e: Ev) => void; onDropDate: (dateStr: string) => void
  dragOverKey: string | null; setDragOverKey: (k: string | null) => void
}) {
  const now = new Date()
  const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')
  const dropProps = (d: Date) => ({
    onDragOver: (ev: RDragEvent) => { ev.preventDefault(); if (dragOverKey !== dayKey(d)) setDragOverKey(dayKey(d)) },
    onDrop: () => onDropDate(dayKey(d)),
  })

  const timed = events.filter(e => e.kind === 'shoot' && parseTime(e.time))
  const hs = timed.map(e => parseTime(e.time)!.h)
  const startHour = Math.max(6, Math.min(8, ...(hs.length ? hs : [8])))
  const endHour = Math.min(23, Math.max(21, ...(hs.length ? hs.map(h => h + 2) : [21])))
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)

  const nowVisible = days.some(d => isSameDay(d, now)) && now.getHours() >= startHour && now.getHours() <= endHour
  const nowTop = (now.getHours() - startHour + now.getMinutes() / 60) * HOUR_PX

  const allDayFor = (d: Date) => events.filter(e => e.date === dayKey(d) && !(e.kind === 'shoot' && parseTime(e.time)))
  const shootsFor = (d: Date, h: number) => timed.filter(e => e.date === dayKey(d) && parseTime(e.time)!.h === h)
  const cols = `54px repeat(${days.length}, minmax(0,1fr))`

  return (
    <div className="border-t border-gray-200 dark:border-gray-800">
      {/* headers */}
      <div className="grid border-b border-gray-100 dark:border-gray-800/80" style={{ gridTemplateColumns: cols }}>
        <div className="text-[10px] text-gray-400 flex items-center px-2">GMT+5</div>
        {days.map(d => {
          const isToday = isSameDay(d, now)
          return (
            <div key={dayKey(d)} className="px-2 py-2 text-center border-l border-gray-100 dark:border-gray-800/80">
              <span className="text-[11px] text-gray-400 mr-1.5">{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
              <span className={'text-[15px] font-semibold ' + (isToday ? 'text-[#eb5757]' : 'text-gray-500 dark:text-gray-300')}>{d.getDate()}</span>
            </div>
          )
        })}
      </div>

      {/* all-day */}
      <div className="grid border-b border-gray-200 dark:border-gray-800" style={{ gridTemplateColumns: cols }}>
        <div className="text-[10px] text-gray-400 text-right pr-2 pt-1.5">Весь день</div>
        {days.map(d => {
          const items = allDayFor(d)
          const over = dragOverKey === dayKey(d)
          return (
            <div key={dayKey(d)} {...dropProps(d)}
              className={'border-l border-gray-100 dark:border-gray-800/80 p-1 flex flex-col gap-1 min-h-[34px] ' + (over ? 'ring-1 ring-inset ring-gray-400' : '')}>
              {items.slice(0, MAX_PER_DAY).map(e => <EventChip key={e.id} e={e} onOpen={onOpen} onDragStart={onDragStart} />)}
              {items.length > MAX_PER_DAY && <span className="text-[10px] text-gray-400 px-1">+{items.length - MAX_PER_DAY}</span>}
            </div>
          )
        })}
      </div>

      {/* time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 600 }}>
        <div className="relative grid" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${hours.length}, ${HOUR_PX}px)` }}>
          {hours.map((h, hi) => (
            <Fragment key={h}>
              <div className="text-[11px] text-gray-400 text-right pr-2 relative -top-[7px]" style={{ gridColumn: 1, gridRow: hi + 1 }}>{String(h).padStart(2, '0')}:00</div>
              {days.map((d, di) => {
                const over = dragOverKey === dayKey(d)
                return (
                  <div key={`${h}-${dayKey(d)}`} {...dropProps(d)}
                    className={'border-l border-t border-gray-100 dark:border-gray-800/70 relative ' + (over ? 'bg-gray-100/40 dark:bg-gray-800/30' : '')}
                    style={{ gridColumn: di + 2, gridRow: hi + 1 }}>
                    {shootsFor(d, h).map(s => {
                      const mm = parseTime(s.time)!.m
                      return (
                        <div key={s.id} onClick={() => onOpen(s)} draggable={!!s.shootId} onDragStart={() => onDragStart(s)}
                          className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 overflow-hidden cursor-grab active:cursor-grabbing z-[2] transition hover:brightness-110"
                          style={{ top: (mm / 60) * HOUR_PX, height: HOUR_PX * 1.4, ...projFill(s.projectId) }}>
                          <div className="flex items-center gap-1 text-[12px] font-medium leading-tight"><Camera size={11} className="shrink-0" /><span className="truncate">{s.projectName || s.title}</span></div>
                          <div className="text-[11px] opacity-75 truncate mt-0.5">{s.time}{s.location ? ` · ${s.location}` : ''}</div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </Fragment>
          ))}
          {nowVisible && (
            <>
              <div className="absolute z-10 pointer-events-none" style={{ top: nowTop, left: 54, right: 0, height: 1.5, background: '#eb5757' }} />
              <div className="absolute z-20 text-[11px] font-semibold" style={{ top: nowTop, left: 6, transform: 'translateY(-50%)', color: '#eb5757' }}>
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ТАБ «СТОРИСЫ» — мини-календари по проектам ────────────────────────
function StoriesTab({ projects, cells, byProject, today, monthLabel, activeId, onPick, fetching }: {
  projects: { id: string; name: string }[]; cells: Cell[]; byProject: Map<string, Map<string, Ev[]>>
  today: string; monthLabel: string; activeId?: string; onPick: (id: string) => void; fetching?: boolean
}) {
  const EMPTY: Map<string, Ev[]> = new Map()
  return (
    <div className={'transition ' + (fetching ? 'opacity-60' : '')}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-[13px] font-semibold text-gray-500">По проектам · {monthLabel}</h2>
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
          {CAT_ORDER.map(cat => (
            <span key={cat} className="inline-flex items-center gap-1"><span className={'w-2 h-2 rounded-full ' + CAT_DOT[cat]} />{CAT_LABEL[cat]}</span>
          ))}
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}>
        {projects.map(p => (
          <MiniCalendar key={p.id} name={p.name} cells={cells} dayMap={byProject.get(p.id) ?? EMPTY} today={today}
            active={activeId === p.id} onClick={() => onPick(p.id)} />
        ))}
      </div>
    </div>
  )
}

// ─── компоненты ────────────────────────────────────────────────────────
function EventChip({ e, onOpen, onDragStart }: { e: Ev; onOpen?: (e: Ev) => void; onDragStart?: (e: Ev) => void }) {
  const canDrag = e.kind === 'publication' ? !!e.itemId : !!e.shootId
  const grab = canDrag ? ' cursor-grab active:cursor-grabbing' : ' cursor-pointer'
  const type = e.contentType || 'other'
  const Ic = e.kind === 'shoot' ? Camera : (TYPE_ICON[type] || AlignLeft)
  const done = e.kind === 'publication' && isDone(e)
  const label = e.kind === 'shoot' ? (e.projectName || e.title || 'Съёмка') : `${TYPE_LABEL[type] || 'Контент'} · ${e.projectName}`
  return (
    <span onClick={() => onOpen?.(e)} draggable={canDrag} onDragStart={() => onDragStart?.(e)}
          style={projFill(e.projectId)}
          className={'flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11.5px] font-medium truncate transition hover:brightness-110 ' + (done ? 'opacity-45 ' : '') + grab}
          title={e.kind === 'shoot'
            ? `Съёмка · ${e.projectName}${e.time ? ` · ${e.time}` : ''}${e.location ? ` · ${e.location}` : ''}`
            : `${TYPE_LABEL[type] || 'Контент'} · ${e.projectName}${e.topic ? ` · ${e.topic}` : ''}${done ? ' · сделано' : ''}`}>
      <Ic size={11} className="shrink-0" />
      {e.kind === 'shoot' && e.time && <span className="font-semibold shrink-0">{e.time}</span>}
      <span className="truncate">{label}</span>
    </span>
  )
}

function MiniCalendar({ name, cells, dayMap, today, active, onClick }: {
  name: string; cells: Cell[]; dayMap: Map<string, Ev[]>; today: string; active?: boolean; onClick?: () => void
}) {
  const counts: Record<Cat, number> = { shoot: 0, reel: 0, design: 0, story: 0, post: 0 }
  for (const evs of dayMap.values()) for (const e of evs) counts[catOf(e)]++
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      className={'text-left rounded-xl border p-2.5 transition cursor-pointer '
        + (active ? 'border-gray-400 dark:border-gray-500' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300')}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[13px] font-semibold truncate">{name}</span>
        <span className="flex gap-1.5 text-[10px] font-bold tabular-nums shrink-0">
          {CAT_ORDER.filter(cat => counts[cat] > 0).map(cat => (
            <span key={cat} className="inline-flex items-center gap-0.5 text-gray-500 dark:text-gray-400">
              <span className={'w-1.5 h-1.5 rounded-full ' + CAT_DOT[cat]} />{counts[cat]}
            </span>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-px">
        {DOW.map(d => <span key={d} className="text-[8px] text-gray-300 dark:text-gray-600 text-center">{d[0]}</span>)}
        {cells.map((c, i) => {
          const evs = c.iso ? (dayMap.get(c.iso) ?? []) : []
          const cats = new Set<Cat>(evs.map(catOf))
          const isToday = c.iso === today
          return (
            <div key={i} className={'h-[26px] rounded flex flex-col items-center pt-0.5 ' + (c.inMonth ? '' : 'opacity-30 ') + (isToday ? 'bg-gray-200/60 dark:bg-gray-700/40' : '')}>
              <span className={'text-[8px] leading-none ' + (isToday ? 'font-bold text-gray-600 dark:text-gray-200' : 'text-gray-400')}>{c.label}</span>
              <span className="flex gap-px mt-0.5 flex-wrap justify-center max-w-[22px]">
                {CAT_ORDER.filter(cat => cats.has(cat)).map(cat => <span key={cat} className={'w-1 h-1 rounded-full ' + CAT_DOT[cat]} />)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Запланировано', preparing: 'Подготовка', in_production: 'В производстве',
  on_review: 'На проверке', on_approval: 'На согласовании', approved: 'Утверждено',
  published: 'Опубликовано', cancelled: 'Отменено',
}
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
}

function EventModal({ e, onClose, onMark, marking }: { e: Ev; onClose: () => void; onMark: (done: boolean) => void; marking: boolean }) {
  const isShoot = e.kind === 'shoot'
  const type = e.contentType || 'other'
  const done = isDone(e)
  const Ic = isShoot ? Camera : (TYPE_ICON[type] || AlignLeft)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <span style={projFill(e.projectId)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold">
            <Ic size={12} /> {isShoot ? 'Съёмка' : (TYPE_LABEL[type] || 'Контент')}
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <h3 className="text-lg font-bold mb-1">{e.projectName || '—'}</h3>
        {!isShoot && e.topic && <p className="text-sm text-gray-500">{e.topic}</p>}
        <div className="space-y-1.5 text-sm my-4">
          <Row k="Дата" v={fmtDate(e.date)} />
          {isShoot && e.time && <Row k="Время" v={e.time} />}
          {isShoot && e.location && <Row k="Место" v={e.location} />}
          {isShoot && e.note && <Row k="Заметка" v={e.note} />}
          {!isShoot && e.assigneeName && <Row k="Ответственный" v={e.assigneeName} />}
          {!isShoot && <Row k="Статус" v={done ? 'Сделано' : (STATUS_LABEL[e.status || 'planned'] || e.status || 'В работе')} />}
        </div>
        {isShoot ? (
          <p className="text-xs text-gray-400 text-center">Съёмка запланирована.</p>
        ) : done ? (
          <button disabled={marking} onClick={() => onMark(false)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60">
            <RotateCcw size={15} /> Вернуть в работу
          </button>
        ) : (
          <button disabled={marking} onClick={() => onMark(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#3f7a58] text-white py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-60">
            <Check size={15} /> Отметить сделанным
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400 shrink-0">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  )
}

function MiniLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-gray-400 items-center mt-3">
      <span className="inline-flex items-center gap-1.5"><Camera size={12} /> Съёмка</span>
      <span className="inline-flex items-center gap-1.5"><Film size={12} /> Reel</span>
      <span className="inline-flex items-center gap-1.5"><AlignLeft size={12} /> Пост</span>
      <span className="inline-flex items-center gap-1.5"><ImageIcon size={12} /> Макет</span>
      <span className="inline-flex items-center gap-1.5"><Circle size={12} /> Сторис</span>
      <span className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
      <span>Цвет — проект · <span className="opacity-45">бледное — сделано</span></span>
    </div>
  )
}

