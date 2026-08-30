// СММ — календарь производства в минималистичном стиле (как Notion). Виды
// Месяц / Неделя / День + таб «Сторисы» (мини-календари по проектам). Публикации
// (зелёные) и съёмки (янтарные, со временем). Статус публикации: опубликовано —
// ярко + галочка, нет — бледно. Drag-перенос на другой день.
import { useMemo, useState, useRef, Fragment, type ReactNode, type DragEvent as RDragEvent } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, isSameDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Camera, X, Check, RotateCcw, Search, Film, AlignLeft, Image as ImageIcon, Circle, Inbox, Settings, CalendarRange } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi, workflowApi, projectsApi } from '@/services/api.service'

type Ev = {
  id: string; itemId?: string; shootId?: string; kind: 'shoot' | 'publication'; date: string
  projectId: string; projectName: string
  title?: string; time?: string | null; location?: string | null; note?: string | null
  contentType?: string; topic?: string | null; status?: string; assigneeName?: string | null
  taskId?: string | null; taskStatus?: string | null
}

/** «Сделано» для публикации: опубликовано ИЛИ связанная задача выполнена. */
const isDone = (e: Ev) => e.status === 'published' || e.taskStatus === 'done'
type Proj = { id: string; name: string; startDate?: string | null; endDate?: string | null; cycleStartDay?: number | null; normReels?: number | null; normPosts?: number | null }
type CalData = { from: string; to: string; events: Ev[]; projects: Proj[]; backlog: Ev[] }
type View = 'month' | 'week' | 'day' | 'stories'

// ─── мягкая палитра (Notion-стиль), адаптивная к теме ─────────────────
// Иконка по типу контента — тип виден сразу, без чтения текста.
const TYPE_ICON: Record<string, any> = {
  reel: Film, video: Film, design: ImageIcon, story: Circle,
  post: AlignLeft, ad: AlignLeft, carousel: ImageIcon, other: AlignLeft,
}

// Цвет проекта — стабильный по projectId; средние тона читаются в обеих темах.
// Палитра максимально разнесённых оттенков (14 шт.) — по кругу цветового тона.
const PROJ_COLORS = ['#e0865a', '#d9b74a', '#a7c14f', '#5fbd80', '#3fb6a0', '#4aa6cf', '#6f8bea', '#9a7be0', '#c77be0', '#e07ac0', '#e07a90', '#d0616a', '#c08a5a', '#8a97a6']
// Цвет назначается по позиции проекта в отсортированном списке — так у разных
// проектов цвета гарантированно разные (пока их не больше длины палитры),
// а не «по хешу», где случались совпадения. Реестр заполняет assignProjectColors.
const _projColorMap = new Map<string, string>()
function assignProjectColors(ids: string[]): void {
  const uniq = [...new Set(ids.map(String))].sort()
  _projColorMap.clear()
  uniq.forEach((id, i) => _projColorMap.set(id, PROJ_COLORS[i % PROJ_COLORS.length]))
}
function projColor(id: string): string {
  const mapped = _projColorMap.get(String(id))
  if (mapped) return mapped
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

// ─── фильтр по типу в шапке: Reels · Макет · Одноразовые задачи ─────────
// «Одноразовые задачи» = всё, что относится к проекту «Одноразовые съёмки».
type FKind = 'reel' | 'design' | 'oneoff'
const FKINDS: FKind[] = ['reel', 'design', 'oneoff']
const FKIND_LABEL: Record<FKind, string> = { reel: 'Reels', design: 'Макет', oneoff: 'Одноразовые задачи' }
const FKIND_ICON: Record<FKind, any> = { reel: Film, design: ImageIcon, oneoff: Camera }
const ONEOFF_RE = /одноразов/i
function matchesFKind(e: Ev, k: FKind): boolean {
  if (k === 'oneoff') return ONEOFF_RE.test(e.projectName || '')
  if (k === 'reel') return e.kind === 'publication' && (e.contentType === 'reel' || e.contentType === 'video')
  return e.kind === 'publication' && e.contentType === 'design'
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
  // Фильтр по проектам — множественный выбор (пусто = все проекты).
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const toggleProject = (id: string) => setSelProjects(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // Фильтр по типу в шапке (пусто = все типы).
  const [selTypes, setSelTypes] = useState<Set<FKind>>(new Set())
  const toggleType = (k: FKind) => setSelTypes(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  const clearTypes = () => setSelTypes(new Set())

  const { from, to } = useMemo(() => {
    if (view === 'week') return { from: iso(startOfWeek(cursor, { weekStartsOn: 1 })), to: iso(endOfWeek(cursor, { weekStartsOn: 1 })) }
    if (view === 'day') return { from: iso(cursor), to: iso(cursor) }
    return { from: iso(startOfMonth(cursor)), to: iso(endOfMonth(cursor)) } // month + stories
  }, [view, cursor])

  const { data, isLoading } = useQuery<CalData>({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
    placeholderData: keepPreviousData,
  })

  const allEvents = data?.events ?? []
  const projects = data?.projects ?? []
  const backlog = data?.backlog ?? []
  const today = todayIso()

  // Назначаем каждому проекту свой цвет по индексу — все id из проектов,
  // событий и бэклога, чтобы у любого проекта цвет был уникальным.
  const projIds = useMemo(() => {
    const s = new Set<string>()
    for (const p of projects) s.add(String(p.id))
    for (const e of allEvents) if (e.projectId) s.add(String(e.projectId))
    for (const b of backlog) if (b.projectId) s.add(String(b.projectId))
    return [...s].sort()
  }, [projects, allEvents, backlog])
  useMemo(() => assignProjectColors(projIds), [projIds.join(',')])

  const qc = useQueryClient()
  const [detail, setDetail] = useState<Ev | null>(null)
  const markMut = useMutation({
    mutationFn: ({ ev, done }: { ev: Ev; done: boolean }) =>
      contentPlanApi.smartUpdate(ev.itemId!, { status: done ? 'published' : 'planned' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Обновлено'); setDetail(null) },
    onError: () => toast.error('Не удалось обновить'),
  })

  // Настройки проекта — день старта месячного цикла. Открывается по шестерёнке
  // на плитке «Не запланировано», сохраняет в project.smmData.cycleStartDay.
  const [projSettings, setProjSettings] = useState<Proj | null>(null)
  const openProjSettings = (id: string) => {
    const p = projects.find(x => x.id === id)
    if (p) setProjSettings(p)
  }
  const cycleMut = useMutation({
    mutationFn: async ({ id, day, normReels, normPosts }: { id: string; day: number | null; normReels: number | null; normPosts: number | null }) => {
      await projectsApi.setSmmCycle(id, { day, normReels, normPosts })
      // Довести незапланированные заготовки ровно до нормы (только при сохранении).
      await contentPlanApi.smartGenerate({ projectId: id, reels: normReels ?? 0, posts: normPosts ?? 0 })
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Цикл проекта сохранён'); setProjSettings(null) },
    onError: () => toast.error('Не удалось сохранить цикл'),
  })
  const clearMut = useMutation({
    mutationFn: (id: string) => contentPlanApi.smartClear(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Контент проекта очищен') },
    onError: () => toast.error('Не удалось очистить'),
  })

  const dragRef = useRef<Ev | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  // Оптимистичный перенос: правим кэш ПРЯМО на месте — событие мгновенно
  // переезжает на дату (и уходит из «Не запланировано»), фоновый запрос лишь
  // сохраняет. Никакого рефетча/затемнения; при ошибке — откат.
  const moveMut = useMutation({
    mutationFn: ({ ev, dateStr }: { ev: Ev; dateStr: string | null }) =>
      ev.kind === 'publication'
        ? contentPlanApi.smartUpdate(ev.itemId!, { publishDate: dateStr })   // своё хранилище, без побочных эффектов
        : workflowApi.updateShootSession(ev.shootId!, { date: dateStr }),
    onMutate: async ({ ev, dateStr }) => {
      const key = ['smm-calendar', from, to]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<CalData>(key)
      qc.setQueryData<CalData>(key, old => {
        if (!old) return old
        const events = old.events.filter(e => e.id !== ev.id)
        const backlog = old.backlog.filter(b => b.id !== ev.id)
        if (dateStr) events.push({ ...ev, date: dateStr })          // на дату
        else backlog.push({ ...ev, date: undefined })               // обратно в корзину
        return { ...old, events, backlog }
      })
      return { prev, key }
    },
    onError: (_e, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev)
      toast.error('Не удалось поставить дату')
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['smm-calendar'] }) },
  })
  const onDragStartEv = (e: Ev) => { dragRef.current = e; setDragOverKey(null) }
  const onDropDate = (dateStr: string) => {
    const e = dragRef.current
    dragRef.current = null
    setDragOverKey(null)
    if (!e || e.date === dateStr) return
    const refId = e.kind === 'publication' ? e.itemId : e.shootId
    if (!refId) return
    moveMut.mutate({ ev: e, dateStr })
  }
  // Сброс события ИЗ календаря в корзину — убираем дату (возврат в «Не запланировано»).
  const onDropBacklog = () => {
    const e = dragRef.current
    dragRef.current = null
    setDragOverKey(null)
    if (!e || !e.date) return
    const refId = e.kind === 'publication' ? e.itemId : e.shootId
    if (!refId) return
    moveMut.mutate({ ev: e, dateStr: null })
  }

  // Основной вид: проект + поиск + без сторис (сторис — в отдельном табе).
  const mainEvents = useMemo(() => allEvents.filter(e =>
    (selProjects.size === 0 || selProjects.has(e.projectId))
    && (selTypes.size === 0 || FKINDS.some(k => selTypes.has(k) && matchesFKind(e, k)))
    && matchSearch(e, search)
    && !(e.kind === 'publication' && e.contentType === 'story')
  ), [allEvents, selProjects, selTypes, search])

  const mainByDate = useMemo(() => {
    const map = new Map<string, Ev[]>()
    for (const e of mainEvents) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date)!.push(e)
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shoot' ? -1 : 1))
    return map
  }, [mainEvents])

  // Месячные циклы выбранных проектов — лента на календаре. Показываем только
  // для выбранных проектов, у которых задан день старта цикла.
  const cycles = useMemo(() => {
    // Цикл открытого месяца (по его середине) — виден один чёткий цикл того
    // месяца, что смотрим, а не «весь календарь».
    const ref = new Date(cursor.getFullYear(), cursor.getMonth(), 15)
    const out: { id: string; name: string; color: string; start: string; end: string }[] = []
    for (const p of projects) {
      if (!selProjects.has(p.id) || !p.cycleStartDay) continue
      const { start, end } = cycleBoundsFor(ref, p.cycleStartDay)
      out.push({ id: p.id, name: p.name, color: projColor(p.id), start, end })
    }
    return out
  }, [projects, selProjects, cursor])

  // Норма за цикл — сколько рилсов/постов нужно (для выбранных проектов).
  const normLines = useMemo(() =>
    projects
      .filter(p => selProjects.has(p.id) && ((p.normReels ?? 0) > 0 || (p.normPosts ?? 0) > 0))
      .map(p => ({ id: p.id, name: p.name, color: projColor(p.id), reels: p.normReels ?? 0, posts: p.normPosts ?? 0 })),
  [projects, selProjects])

  // Таб «Сторисы»: мини-календари по проекту → дате (все события, в т.ч. сторис).
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

  // «Не запланировано» — ЯЧЕЙКА НА КАЖДЫЙ проект (даже пустую показываем),
  // внутри — карточки без даты (минус уже брошенные, с учётом поиска).
  const backlogGroups = useMemo(() => {
    const filtered = backlog.filter(b => matchSearch(b, search))
    const byProj = new Map<string, Ev[]>()
    for (const b of filtered) { if (!byProj.has(b.projectId)) byProj.set(b.projectId, []); byProj.get(b.projectId)!.push(b) }
    // Показываем ВСЕ проекты — выбранный подсвечивается, остальные приглушаются
    // (клик по плитке фильтрует календарь, но плитки не прячем).
    return projects.map(p => ({ id: p.id, name: p.name, items: byProj.get(p.id) ?? [] }))
  }, [backlog, search, projects])

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
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5">
            <Search size={13} className="text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск"
              className="bg-transparent text-[13px] outline-none w-24 placeholder:text-gray-400" />
            {search && <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>}
          </div>
          <div className="relative">
            <button onClick={() => setFilterOpen(o => !o)}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300">
              {selTypes.size === 0
                ? 'Все типы'
                : selTypes.size === 1
                  ? FKIND_LABEL[[...selTypes][0]]
                  : `${selTypes.size} типа`}
              <ChevronDown size={14} className="text-gray-400" />
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-40 w-56 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1">
                  <button onClick={() => clearTypes()}
                    className={'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left hover:bg-gray-100 dark:hover:bg-gray-800 ' + (selTypes.size === 0 ? 'font-semibold' : '')}>
                    Все типы {selTypes.size === 0 && <Check size={14} className="ml-auto text-gray-400 shrink-0" />}
                  </button>
                  {FKINDS.map(k => {
                    const Ic = FKIND_ICON[k]
                    return (
                      <button key={k} onClick={() => toggleType(k)}
                        className={'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left hover:bg-gray-100 dark:hover:bg-gray-800 ' + (selTypes.has(k) ? 'font-semibold' : '')}>
                        <Ic size={14} className="text-gray-400 shrink-0" />
                        <span className="truncate">{FKIND_LABEL[k]}</span>
                        {selTypes.has(k) && <Check size={14} className="ml-auto text-gray-400 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
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

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : view === 'stories' ? (
        <StoriesTab projects={projects} cells={cells} byProject={byProject} today={today} monthLabel={monthTitle(monthStr)}
          activeIds={selProjects} onPick={toggleProject} />
      ) : (
        <>
          <BacklogPanel groups={backlogGroups} activeIds={selProjects} onPick={toggleProject}
            onSettings={openProjSettings}
            onDragStart={onDragStartEv} onDrop={onDropBacklog}
            over={dragOverKey === 'backlog'} setOver={v => setDragOverKey(v ? 'backlog' : null)} />
          {normLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 px-3.5 py-2.5">
              {normLines.map(n => (
                <div key={n.id} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: n.color }} />
                  <span className="font-semibold">{n.name}</span>
                  <span className="text-gray-400">нужно за цикл:</span>
                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: n.color }}><Film size={13} /> {n.reels}</span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: n.color }}><ImageIcon size={13} /> {n.posts}</span>
                </div>
              ))}
            </div>
          )}
          {view === 'month' ? (
            <MonthView cells={cells} byDate={mainByDate} today={today} cycles={cycles}
              onOpen={setDetail} onDragStart={onDragStartEv} onDropDate={onDropDate}
              dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          ) : (
            <TimeGridView days={weekDays} events={mainEvents} onOpen={setDetail}
              onDragStart={onDragStartEv} onDropDate={onDropDate} dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          )}
        </>
      )}

      {detail && (
        <EventModal e={detail} marking={markMut.isPending} onClose={() => setDetail(null)}
          onMark={done => markMut.mutate({ ev: detail, done })}
          onUnschedule={() => { if (detail.date) moveMut.mutate({ ev: detail, dateStr: null }); setDetail(null) }} />
      )}

      {projSettings && (
        <ProjectCycleModal p={projSettings} saving={cycleMut.isPending} clearing={clearMut.isPending}
          onClose={() => setProjSettings(null)}
          onSave={(day, normReels, normPosts) => cycleMut.mutate({ id: projSettings.id, day, normReels, normPosts })}
          onClear={() => clearMut.mutate(projSettings.id)} />
      )}
    </div>
  )
}

// ─── окно «Цикл проекта» — день старта цикла (1..31) + норма (рилсы/посты) ─
function ProjectCycleModal({ p, saving, clearing, onClose, onSave, onClear }: {
  p: Proj; saving: boolean; clearing: boolean; onClose: () => void
  onSave: (day: number | null, normReels: number | null, normPosts: number | null) => void
  onClear: () => void
}) {
  const [day, setDay] = useState<number | null>(p.cycleStartDay ?? null)
  const [reels, setReels] = useState<number>(p.normReels ?? 0)
  const [posts, setPosts] = useState<number>(p.normPosts ?? 0)
  const accent = projColor(p.id)
  const hint = day == null
    ? 'Цикл не задан — на календаре период не подсвечивается.'
    : day === 1
      ? 'Цикл: с 1-го по конец каждого месяца.'
      : `Цикл: с ${day}-го по ${day - 1}-е следующего месяца (сдвигается каждый месяц).`
  const clamp = (n: number) => Math.max(0, Math.min(999, Math.trunc(n) || 0))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <span style={projFill(p.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold">
            <CalendarRange size={12} /> Цикл проекта
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <h3 className="text-lg font-bold">{p.name}</h3>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 mt-3">День старта цикла</p>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 31 }, (_, i) => i + 1).map(n => {
            const on = day === n
            return (
              <button key={n} type="button" onClick={() => setDay(on ? null : n)}
                className={'h-8 grid place-items-center rounded-full text-[13px] transition ' + (on ? 'font-bold text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')}
                style={on ? { background: accent } : undefined}>{n}</button>
            )
          })}
        </div>
        <div className="mt-2 text-[12px] font-medium" style={day != null ? { color: accent } : undefined}>{hint}</div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 mt-4">Норма за цикл</p>
        <div className="grid grid-cols-2 gap-2.5">
          {([['Рилсы', reels, setReels], ['Посты', posts, setPosts]] as const).map(([label, val, set]) => (
            <div key={label}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button type="button" onClick={() => set(clamp(val - 1))} className="w-8 h-9 grid place-items-center text-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">−</button>
                <input type="number" min={0} value={val} onChange={e => set(clamp(Number(e.target.value)))}
                  className="flex-1 w-full text-center text-[15px] font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                <button type="button" onClick={() => set(clamp(val + 1))} className="w-8 h-9 grid place-items-center text-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">+</button>
              </div>
            </div>
          ))}
        </div>
        <button disabled={clearing} onClick={() => { if (window.confirm(`Удалить весь контент проекта «${p.name}» из Умного календаря? Доску это не затронет.`)) onClear() }}
          className="mt-4 text-xs font-medium text-red-500/80 hover:text-red-500 disabled:opacity-60">
          Очистить контент проекта
        </button>
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={() => { setDay(null); setReels(0); setPosts(0) }} className="text-xs font-medium text-gray-400 hover:text-gray-600">Сбросить</button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm font-semibold px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
            <button disabled={saving} onClick={() => onSave(day, reels || null, posts || null)}
              className="flex items-center gap-1.5 rounded-lg bg-[#3f7a58] text-white px-4 py-2 text-sm font-semibold hover:brightness-110 disabled:opacity-60">
              <Check size={15} /> Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── МЕСЯЦ ─────────────────────────────────────────────────────────────
// Границы цикла, в который попадает опорная дата ref, по дню старта anchor.
// Напр. anchor=10, ref=15 сен → 10 сен … 9 окт. Подсвечивается один цикл того
// месяца, что открыт — не «весь календарь».
function cycleBoundsFor(ref: Date, anchor: number): { start: string; end: string } {
  const dim = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
  const y = ref.getFullYear(), m = ref.getMonth(), d = ref.getDate()
  const anchorThis = Math.min(anchor, dim(y, m))
  let sy = y, sm = m
  if (d < anchorThis) { sm -= 1; if (sm < 0) { sm = 11; sy -= 1 } }
  const sAnchor = Math.min(anchor, dim(sy, sm))
  const start = new Date(sy, sm, sAnchor)
  const nAnchor = Math.min(anchor, dim(start.getFullYear(), start.getMonth() + 1))
  const end = new Date(start.getFullYear(), start.getMonth() + 1, nAnchor)
  end.setDate(end.getDate() - 1)
  return { start: iso(start), end: iso(end) }
}

function MonthView({ cells, byDate, today, cycles, onOpen, onDragStart, onDropDate, dragOverKey, setDragOverKey }: {
  cells: Cell[]; byDate: Map<string, Ev[]>; today: string
  cycles: { id: string; name: string; color: string; start: string; end: string }[]
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
              className={'min-h-[92px] border-b border-r border-gray-100 dark:border-gray-800/80 p-1 flex flex-col gap-0.5 '
                + ((i + 1) % 7 === 0 ? 'border-r-0 ' : '')
                + (c.iso && dragOverKey === c.iso ? 'ring-1 ring-inset ring-gray-400 ' : '')
                + (!c.inMonth ? 'bg-gray-50/40 dark:bg-black/20' : isToday ? 'bg-[#eb5757]/[0.06]' : (i % 7 >= 5 ? 'bg-gray-50/50 dark:bg-white/[0.015]' : ''))}>
              {c.iso && cycles.some(cy => c.iso! >= cy.start && c.iso! <= cy.end) && (
                <div className="-mx-1 -mt-1 mb-0.5 flex flex-col gap-[2px]">
                  {cycles.filter(cy => c.iso! >= cy.start && c.iso! <= cy.end).map(cy => {
                    const isStart = c.iso === cy.start
                    const isEnd = c.iso === cy.end
                    return (
                      <div key={cy.id} title={`${cy.name} · текущий цикл ${cy.start} → ${cy.end}`}
                        className="h-[4px]"
                        style={{
                          background: cy.color,
                          marginLeft: isStart ? 4 : 0, marginRight: isEnd ? 4 : 0,
                          borderTopLeftRadius: isStart ? 999 : 0, borderBottomLeftRadius: isStart ? 999 : 0,
                          borderTopRightRadius: isEnd ? 999 : 0, borderBottomRightRadius: isEnd ? 999 : 0,
                        }} />
                    )
                  })}
                </div>
              )}
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
function StoriesTab({ projects, cells, byProject, today, monthLabel, activeIds, onPick }: {
  projects: { id: string; name: string }[]; cells: Cell[]; byProject: Map<string, Map<string, Ev[]>>
  today: string; monthLabel: string; activeIds: Set<string>; onPick: (id: string) => void
}) {
  const EMPTY: Map<string, Ev[]> = new Map()
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-[13px] font-semibold text-gray-500">По проектам · {monthLabel}</h2>
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
          {CAT_ORDER.map(cat => (
            <span key={cat} className="inline-flex items-center gap-1"><span className={'w-2 h-2 rounded-full ' + CAT_DOT[cat]} />{CAT_LABEL[cat]}</span>
          ))}
        </div>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {projects.map(p => (
          <MiniCalendar key={p.id} name={p.name} cells={cells} dayMap={byProject.get(p.id) ?? EMPTY} today={today}
            active={activeIds.has(p.id)} onClick={() => onPick(p.id)} />
        ))}
      </div>
    </div>
  )
}

// ─── панель «Не запланировано» ─────────────────────────────────────────
function BacklogPanel({ groups, activeIds, onPick, onSettings, onDragStart, onDrop, over, setOver }: {
  groups: { id: string; name: string; items: Ev[] }[]; activeIds: Set<string>; onPick: (id: string) => void
  onSettings: (id: string) => void
  onDragStart: (e: Ev) => void; onDrop: () => void; over: boolean; setOver: (v: boolean) => void
}) {
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!over) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop() }}
      className={'rounded-xl border p-2.5 transition ' + (over
        ? 'border-gray-400 dark:border-gray-500 bg-gray-100/50 dark:bg-gray-800/50'
        : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40')}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">
        <Inbox size={13} /> Не запланировано — перетащите на дату <span className="normal-case font-medium text-gray-400/70">(или сюда, чтобы снять дату)</span>
      </div>
      {groups.length === 0 ? (
        <div className="text-[12.5px] text-gray-400 px-1 py-2">Нет SMM-проектов.</div>
      ) : (
      <div className="grid gap-2 max-h-[176px] overflow-y-auto pr-0.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {groups.map(g => {
          const c = projColor(g.id)
          const active = activeIds.has(g.id)
          const dim = activeIds.size > 0 && !active
          return (
            <div key={g.id} className={'rounded-lg p-1.5 transition-opacity ' + (dim ? 'opacity-35 hover:opacity-100' : '')}
              style={{ border: `1px solid color-mix(in srgb, ${c} ${active ? 85 : 40}%, transparent)`, background: `color-mix(in srgb, ${c} ${active ? 14 : 8}%, transparent)` }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button type="button" onClick={() => onPick(g.id)} title={active ? 'Убрать из фильтра' : 'Добавить в фильтр (можно несколько)'}
                  className="flex items-center gap-1.5 min-w-0 flex-1 text-[11.5px] font-semibold cursor-pointer" style={{ color: c }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                  <span className="truncate text-left">{g.name}</span>
                </button>
                <span className="text-[11px] text-gray-400 font-medium shrink-0">{g.items.length}</span>
                <button type="button" onClick={() => onSettings(g.id)} title="Настройки проекта — день старта цикла"
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
                  <Settings size={13} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[20px]">
                {g.items.length === 0
                  ? <span className="text-[11px] text-gray-400/60">—</span>
                  : g.items.map(it => <BacklogCard key={it.id} e={it} onDragStart={onDragStart} />)}
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

function BacklogCard({ e, onDragStart }: { e: Ev; onDragStart: (e: Ev) => void }) {
  const type = e.contentType || 'other'
  const Ic = e.kind === 'shoot' ? Camera : (TYPE_ICON[type] || AlignLeft)
  const label = e.kind === 'shoot' ? 'Съёмка' : (TYPE_LABEL[type] || 'Контент')
  return (
    <span draggable onDragStart={() => onDragStart(e)}
      style={projFill(e.projectId)}
      className="inline-flex items-center justify-center w-6 h-6 rounded-md cursor-grab active:cursor-grabbing transition hover:brightness-110"
      title={`${label}${e.topic ? ` · ${e.topic}` : ''}`}>
      <Ic size={13} className="shrink-0" />
    </span>
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
      <div className="grid grid-cols-7 gap-0.5">
        {DOW.map(d => <span key={d} className="text-[9px] text-gray-300 dark:text-gray-600 text-center">{d[0]}</span>)}
        {cells.map((c, i) => {
          const evs = c.iso ? (dayMap.get(c.iso) ?? []) : []
          const cats = new Set<Cat>(evs.map(catOf))
          const isToday = c.iso === today
          return (
            <div key={i} className={'h-[36px] rounded flex flex-col items-center pt-1 ' + (c.inMonth ? '' : 'opacity-30 ') + (isToday ? 'bg-gray-200/60 dark:bg-gray-700/40' : '')}>
              <span className={'text-[10px] leading-none ' + (isToday ? 'font-bold text-gray-600 dark:text-gray-200' : 'text-gray-400')}>{c.label}</span>
              <span className="flex gap-0.5 mt-1 flex-wrap justify-center max-w-[34px]">
                {CAT_ORDER.filter(cat => cats.has(cat)).map(cat => <span key={cat} className={'w-1.5 h-1.5 rounded-full ' + CAT_DOT[cat]} />)}
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

function EventModal({ e, onClose, onMark, marking, onUnschedule }: { e: Ev; onClose: () => void; onMark: (done: boolean) => void; marking: boolean; onUnschedule: () => void }) {
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
        <div className="space-y-2">
          {e.date && (
            <button onClick={onUnschedule}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Inbox size={15} /> Вернуть в «Не запланировано»
            </button>
          )}
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

