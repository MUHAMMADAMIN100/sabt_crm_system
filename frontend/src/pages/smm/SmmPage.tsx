// СММ — календарь производства. Виды Месяц / Неделя / День. Публикации 📤
// (из контент-плана) и съёмки 📸 (из shoot_sessions). В неделя/день — почасовая
// сетка: съёмки на своём времени с местом, публикации «весь день», линия «сейчас».
// Поиск по событиям. Клик по событию → окно с инфо и кнопкой статуса.
import { useMemo, useState, Fragment, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, isSameDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Megaphone, Loader2, Camera, Send, X, Check, RotateCcw, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi } from '@/services/api.service'

type Ev = {
  id: string; itemId?: string; kind: 'shoot' | 'publication'; date: string
  projectId: string; projectName: string
  title?: string; time?: string | null; location?: string | null; note?: string | null
  contentType?: string; topic?: string | null; status?: string; assigneeName?: string | null
}
type CalData = { from: string; to: string; events: Ev[]; projects: { id: string; name: string }[] }
type View = 'month' | 'week' | 'day'

// ─── типы контента ────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  reel: 'Reel', story: 'Сторис', post: 'Пост', design: 'Макет',
  ad: 'Реклама', video: 'Видео', carousel: 'Карусель', other: 'Контент',
}
const TYPE_CLS: Record<string, string> = {
  reel:  'bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  design:'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  story: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  post:  'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  video: 'bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  carousel: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ad:    'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  other: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}
const SHOOT_CLS = 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
const DOT: Record<string, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', late: 'bg-red-500', none: 'bg-gray-300 dark:bg-gray-600' }

// ─── категории для точек (мини-календари) ─────────────────────────────
type Cat = 'shoot' | 'reel' | 'design' | 'story' | 'post'
const CAT_ORDER: Cat[] = ['shoot', 'reel', 'design', 'story', 'post']
const CAT_DOT: Record<Cat, string> = {
  shoot: 'bg-orange-500', reel: 'bg-pink-500', design: 'bg-violet-500', story: 'bg-cyan-500', post: 'bg-blue-500',
}
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
function pubDot(e: Ev): 'ok' | 'warn' | 'late' | 'none' {
  if (e.status === 'published' || e.status === 'approved') return 'ok'
  if (e.status === 'cancelled') return 'none'
  if (e.date < todayIso()) return 'late'
  return 'warn'
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
const HOUR_PX = 48

// ═══════════════════════════════════════════════════════════════════════
export default function SmmPage() {
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(new Date())
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')

  // Диапазон запроса по текущему виду.
  const { from, to } = useMemo(() => {
    if (view === 'month') return { from: iso(startOfMonth(cursor)), to: iso(endOfMonth(cursor)) }
    if (view === 'week') return { from: iso(startOfWeek(cursor, { weekStartsOn: 1 })), to: iso(endOfWeek(cursor, { weekStartsOn: 1 })) }
    return { from: iso(cursor), to: iso(cursor) }
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
    mutationFn: ({ itemId, status }: { itemId: string; status: string }) => contentPlanApi.update(itemId, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Обновлено'); setDetail(null) },
    onError: () => toast.error('Не удалось обновить'),
  })

  // Отфильтрованные события для основного вида: проект + поиск + без сторис.
  const mainEvents = useMemo(() => allEvents.filter(e =>
    (!projectId || e.projectId === projectId)
    && matchSearch(e, search)
    && !(e.kind === 'publication' && e.contentType === 'story')
  ), [allEvents, projectId, search])

  // Месяц: события по дате (для больших ячеек).
  const mainByDate = useMemo(() => {
    const map = new Map<string, Ev[]>()
    for (const e of mainEvents) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date)!.push(e)
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shoot' ? -1 : 1))
    return map
  }, [mainEvents])

  // Мини-календари (только в Месяце): все события по проекту → дате.
  const byProject = useMemo(() => {
    const m = new Map<string, Map<string, Ev[]>>()
    for (const e of allEvents) {
      if (!m.has(e.projectId)) m.set(e.projectId, new Map())
      const dm = m.get(e.projectId)!
      if (!dm.has(e.date)) dm.set(e.date, [])
      dm.get(e.date)!.push(e)
    }
    return m
  }, [allEvents])
  const EMPTY: Map<string, Ev[]> = new Map()

  const monthStr = format(cursor, 'yyyy-MM')
  const cells = useMemo(() => buildCells(monthStr), [monthStr])

  // Заголовок диапазона.
  const rangeLabel = view === 'month'
    ? monthTitle(monthStr)
    : view === 'day'
      ? cursor.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
      : `${startOfWeek(cursor, { weekStartsOn: 1 }).toLocaleDateString('ru-RU', { day: 'numeric' })}–${endOfWeek(cursor, { weekStartsOn: 1 }).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`

  const step = (dir: number) => setCursor(c =>
    view === 'month' ? addMonths(c, dir) : view === 'week' ? addDays(c, dir * 7) : addDays(c, dir))

  const weekDays = useMemo(() => {
    if (view === 'week') { const s = startOfWeek(cursor, { weekStartsOn: 1 }); return Array.from({ length: 7 }, (_, i) => addDays(s, i)) }
    if (view === 'day') return [cursor]
    return []
  }, [view, cursor])

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone size={22} /> СММ</h1>
          <p className="text-sm text-gray-500 mt-1">
            Что и когда <b className="text-orange-600 dark:text-orange-400">📸 снимать</b> и что и когда <b className="text-blue-600 dark:text-blue-400">📤 публиковать</b> — по вашим проектам.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 bg-white dark:bg-gray-900">
            <Search size={14} className="text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: проект, тема, место…"
              className="bg-transparent text-sm outline-none w-40 placeholder:text-gray-400" />
            {search && <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {(['month', 'week', 'day'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={'px-3 py-1.5 text-sm font-semibold ' + (view === v ? 'bg-surface-500 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800')}>
                {v === 'month' ? 'Месяц' : v === 'week' ? 'Неделя' : 'День'}
              </button>
            ))}
          </div>
          <button onClick={() => setCursor(new Date())} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Сегодня</button>
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronLeft size={16} /></button>
            <span className="text-sm font-bold px-2 min-w-[130px] text-center">{rangeLabel}</span>
            <button onClick={() => step(1)} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronRight size={16} /></button>
          </div>
        </div>
      </header>

      {/* project filter */}
      <div className="flex gap-1.5 flex-wrap items-center">
        <Chip active={!projectId} onClick={() => setProjectId(undefined)}>Все проекты</Chip>
        {projects.map(p => (
          <Chip key={p.id} active={projectId === p.id} onClick={() => setProjectId(p.id)}>{p.name}</Chip>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-surface-500" /></div>
      ) : view === 'month' ? (
        <>
          <div className={'rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden transition ' + (isFetching ? 'opacity-70' : '')}>
            <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800/70 border-b border-gray-200 dark:border-gray-700">
              {DOW.map((d, i) => (
                <div key={d} className={'px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide ' + (i >= 5 ? 'text-red-400' : 'text-gray-400')}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((c, i) => {
                const evs = c.iso ? (mainByDate.get(c.iso) ?? []) : []
                const isToday = c.iso === today
                return (
                  <div key={i} className={'min-h-[104px] border-r border-b border-gray-100 dark:border-gray-800 p-1.5 flex flex-col gap-1 '
                    + (c.inMonth ? '' : 'bg-gray-50/60 dark:bg-gray-800/30 ')
                    + ((i + 1) % 7 === 0 ? 'border-r-0 ' : '')
                    + (isToday ? 'bg-surface-50/50 dark:bg-surface-900/20' : '')}>
                    <span className={'text-xs font-bold self-start px-1 ' + (isToday ? 'bg-surface-500 text-white rounded-md min-w-[22px] text-center' : c.inMonth ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600')}>{c.label}</span>
                    {evs.slice(0, MAX_PER_DAY).map(e => <EventChip key={e.id} e={e} onOpen={setDetail} />)}
                    {evs.length > MAX_PER_DAY && <span className="text-[10.5px] text-gray-400 font-semibold px-1">+{evs.length - MAX_PER_DAY} ещё</span>}
                  </div>
                )
              })}
            </div>
          </div>

          <Legend />

          {/* мини-календари по всем проектам */}
          {projects.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">По проектам · {monthTitle(monthStr)}</h2>
                <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
                  {CAT_ORDER.map(cat => (
                    <span key={cat} className="inline-flex items-center gap-1"><span className={'w-2 h-2 rounded-full ' + CAT_DOT[cat]} />{{ shoot: 'Съёмка', reel: 'Reel', design: 'Макет', story: 'Сторис', post: 'Пост' }[cat]}</span>
                  ))}
                </div>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                {projects.map(p => (
                  <MiniCalendar key={p.id} name={p.name} cells={cells} dayMap={byProject.get(p.id) ?? EMPTY} today={today}
                    active={projectId === p.id} onClick={() => setProjectId(projectId === p.id ? undefined : p.id)} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <TimeGridView days={weekDays} events={mainEvents} onOpen={setDetail} fetching={isFetching} />
          <Legend />
        </>
      )}

      {detail && (
        <EventModal e={detail} marking={markMut.isPending} onClose={() => setDetail(null)}
          onMark={status => detail.itemId && markMut.mutate({ itemId: detail.itemId, status })} />
      )}
    </div>
  )
}

// ─── недельный / дневной вид с почасовой сеткой ────────────────────────
function TimeGridView({ days, events, onOpen, fetching }: { days: Date[]; events: Ev[]; onOpen: (e: Ev) => void; fetching?: boolean }) {
  const now = new Date()
  const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')

  // Диапазон часов — по съёмкам, но не уже 9–20.
  const timed = events.filter(e => e.kind === 'shoot' && parseTime(e.time))
  const hoursOfShoots = timed.map(e => parseTime(e.time)!.h)
  const startHour = Math.max(6, Math.min(9, ...(hoursOfShoots.length ? hoursOfShoots : [9])))
  const endHour = Math.min(23, Math.max(20, ...(hoursOfShoots.length ? hoursOfShoots.map(h => h + 2) : [20])))
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)

  const nowVisible = days.some(d => isSameDay(d, now)) && now.getHours() >= startHour && now.getHours() <= endHour
  const nowTop = (now.getHours() - startHour + now.getMinutes() / 60) * HOUR_PX

  const allDayFor = (d: Date) => events.filter(e => e.date === dayKey(d) && !(e.kind === 'shoot' && parseTime(e.time)))
  const shootsFor = (d: Date, h: number) => timed.filter(e => e.date === dayKey(d) && parseTime(e.time)!.h === h)

  const cols = `56px repeat(${days.length}, minmax(0,1fr))`

  return (
    <div className={'rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden transition ' + (fetching ? 'opacity-70' : '')}>
      {/* headers */}
      <div className="grid border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70" style={{ gridTemplateColumns: cols }}>
        <div className="border-r border-gray-100 dark:border-gray-800" />
        {days.map(d => {
          const isToday = isSameDay(d, now)
          const wknd = [6, 0].includes(d.getDay())
          return (
            <div key={dayKey(d)} className="px-2 py-2 text-center border-r border-gray-100 dark:border-gray-800 last:border-r-0">
              <div className={'text-[11px] font-bold uppercase tracking-wide ' + (wknd ? 'text-red-400' : 'text-gray-400')}>{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</div>
              <div className={'text-base font-bold ' + (isToday ? 'inline-block bg-surface-500 text-white rounded-lg min-w-[26px] px-1.5' : '')}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      {/* all-day row */}
      <div className="grid border-b border-gray-200 dark:border-gray-700" style={{ gridTemplateColumns: cols }}>
        <div className="border-r border-gray-100 dark:border-gray-800 text-[9px] font-bold uppercase text-gray-400 text-right pr-1.5 pt-1.5 leading-tight">Весь<br />день</div>
        {days.map(d => {
          const items = allDayFor(d)
          return (
            <div key={dayKey(d)} className={'border-r border-gray-100 dark:border-gray-800 last:border-r-0 p-1 flex flex-col gap-1 min-h-[38px] ' + (isSameDay(d, now) ? 'bg-surface-50/40 dark:bg-surface-900/15' : '')}>
              {items.slice(0, MAX_PER_DAY).map(e => <EventChip key={e.id} e={e} onOpen={onOpen} />)}
              {items.length > MAX_PER_DAY && <span className="text-[10px] text-gray-400 font-semibold px-1">+{items.length - MAX_PER_DAY}</span>}
            </div>
          )
        })}
      </div>

      {/* time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 560 }}>
        <div className="relative grid" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${hours.length}, ${HOUR_PX}px)` }}>
          {hours.map((h, hi) => (
            <Fragment key={h}>
              <div className="border-r border-b border-gray-100 dark:border-gray-800 text-[10.5px] text-gray-400 text-right pr-1.5 relative -top-[7px]" style={{ gridColumn: 1, gridRow: hi + 1 }}>{String(h).padStart(2, '0')}:00</div>
              {days.map((d, di) => (
                <div key={dayKey(d)} className={'border-r border-b border-gray-100 dark:border-gray-800 last:border-r-0 relative ' + (isSameDay(d, now) ? 'bg-surface-50/30 dark:bg-surface-900/10' : '')} style={{ gridColumn: di + 2, gridRow: hi + 1 }}>
                  {shootsFor(d, h).map(s => {
                    const mm = parseTime(s.time)!.m
                    return (
                      <div key={s.id} onClick={() => onOpen(s)}
                        className="absolute left-0.5 right-0.5 rounded-lg bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800/60 text-orange-700 dark:text-orange-300 px-1.5 py-1 overflow-hidden cursor-pointer shadow-sm z-[2]"
                        style={{ top: (mm / 60) * HOUR_PX, height: HOUR_PX * 1.35 }}>
                        <div className="flex items-center gap-1 text-[11px] font-bold leading-tight"><Camera size={11} className="shrink-0" /><span className="truncate">{s.projectName || s.title}</span></div>
                        <div className="text-[10px] opacity-80 truncate mt-0.5">{s.time}{s.location ? ` · ${s.location}` : ''}</div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </Fragment>
          ))}

          {nowVisible && (
            <>
              <div className="absolute z-10 pointer-events-none" style={{ top: nowTop, left: 56, right: 0, height: 2, background: '#ef4444' }} />
              <div className="absolute z-20 text-[9.5px] font-bold text-white rounded px-1" style={{ top: nowTop, left: 4, transform: 'translateY(-50%)', background: '#ef4444' }}>
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500 items-center">
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" /> 📸 Съёмка</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-pink-500" /> Reel</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-500" /> Макет</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500" /> Пост</span>
      <span className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> готово <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ml-1" /> в работе <span className="w-2.5 h-2.5 rounded-full bg-red-500 ml-1" /> просрочено</span>
      <span className="ml-auto text-gray-400">Сторис — точками в мини-календарях (в виде «Месяц»)</span>
    </div>
  )
}

function EventChip({ e, onOpen }: { e: Ev; onOpen?: (e: Ev) => void }) {
  if (e.kind === 'shoot') {
    return (
      <span onClick={() => onOpen?.(e)}
            className={'flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md truncate cursor-pointer ' + SHOOT_CLS}
            title={`Съёмка · ${e.projectName}${e.time ? ` · ${e.time}` : ''}${e.location ? ` · ${e.location}` : ''}`}>
        <Camera size={11} className="shrink-0" />
        <span className="truncate">{e.projectName || e.title}</span>
        {e.time && <span className="opacity-70 shrink-0">{e.time}</span>}
      </span>
    )
  }
  const type = e.contentType || 'other'
  const dot = pubDot(e)
  return (
    <span onClick={() => onOpen?.(e)}
          className={'flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md truncate cursor-pointer ' + (TYPE_CLS[type] || TYPE_CLS.other)}
          title={`${TYPE_LABEL[type] || 'Контент'} · ${e.projectName}${e.topic ? ` · ${e.topic}` : ''}${e.assigneeName ? ` · ${e.assigneeName}` : ''}`}>
      <Send size={10} className="shrink-0" />
      <span className="truncate">{TYPE_LABEL[type] || 'Контент'} · {e.projectName}</span>
      {dot !== 'none' && <span className={'w-1.5 h-1.5 rounded-full ml-auto shrink-0 ' + DOT[dot]} />}
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
      className={'text-left rounded-xl border bg-white dark:bg-gray-900 p-2.5 transition cursor-pointer '
        + (active ? 'border-surface-500 ring-1 ring-surface-500' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300')}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[13px] font-bold truncate">{name}</span>
        <span className="flex gap-1.5 text-[10px] font-bold tabular-nums shrink-0">
          {counts.shoot > 0 && <span className="text-orange-500">📸{counts.shoot}</span>}
          {counts.reel > 0 && <span className="text-pink-500">🎬{counts.reel}</span>}
          {counts.design > 0 && <span className="text-violet-500">🎨{counts.design}</span>}
          {counts.story > 0 && <span className="text-cyan-500">📱{counts.story}</span>}
          {counts.post > 0 && <span className="text-blue-500">✉{counts.post}</span>}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-px">
        {DOW.map(d => <span key={d} className="text-[8px] text-gray-300 dark:text-gray-600 text-center">{d[0]}</span>)}
        {cells.map((c, i) => {
          const evs = c.iso ? (dayMap.get(c.iso) ?? []) : []
          const cats = new Set<Cat>(evs.map(catOf))
          const isToday = c.iso === today
          return (
            <div key={i} className={'h-[26px] rounded flex flex-col items-center pt-0.5 ' + (c.inMonth ? '' : 'opacity-30 ') + (isToday ? 'bg-surface-500/15 ring-1 ring-surface-500' : '')}>
              <span className={'text-[8px] leading-none ' + (isToday ? 'text-surface-600 dark:text-surface-300 font-bold' : 'text-gray-400')}>{c.label}</span>
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

function EventModal({ e, onClose, onMark, marking }: { e: Ev; onClose: () => void; onMark: (status: string) => void; marking: boolean }) {
  const isShoot = e.kind === 'shoot'
  const type = e.contentType || 'other'
  const isPublished = e.status === 'published'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <span className={'px-2 py-0.5 rounded-md text-xs font-bold ' + (isShoot ? SHOOT_CLS : (TYPE_CLS[type] || TYPE_CLS.other))}>
            {isShoot ? '📸 Съёмка' : (TYPE_LABEL[type] || 'Контент')}
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
          {!isShoot && <Row k="Статус" v={STATUS_LABEL[e.status || 'planned'] || e.status || '—'} />}
        </div>
        {isShoot ? (
          <p className="text-xs text-gray-400 text-center">Съёмка запланирована.</p>
        ) : isPublished ? (
          <button disabled={marking} onClick={() => onMark('planned')}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60">
            <RotateCcw size={15} /> Снять отметку «опубликовано»
          </button>
        ) : (
          <button disabled={marking} onClick={() => onMark('published')}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">
            <Check size={15} /> Отметить опубликованным
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

function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
            className={'text-[13px] font-medium px-3 py-1.5 rounded-full border transition '
              + (active ? 'bg-surface-500 border-surface-500 text-white' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300')}>
      {children}
    </button>
  )
}
