// СММ — календарь производства в минималистичном стиле (как Notion). Виды
// Месяц / Неделя / День + таб «Сторисы» (мини-календари по проектам). Публикации
// (зелёные) и съёмки (янтарные, со временем). Статус публикации: опубликовано —
// ярко + галочка, нет — бледно. Drag-перенос на другой день.
import { useMemo, useState, useRef, useEffect, useLayoutEffect, Fragment, type ReactNode, type DragEvent as RDragEvent } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, isSameDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, Camera, X, Check, RotateCcw, Search, Film, AlignLeft, Image as ImageIcon, Circle, Inbox, Settings, CalendarRange, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { contentPlanApi, workflowApi, projectsApi } from '@/services/api.service'

export type Ev = {
  id: string; itemId?: string; shootId?: string; kind: 'shoot' | 'publication'; date: string
  projectId: string; projectName: string
  title?: string; time?: string | null; location?: string | null; note?: string | null
  contentType?: string; topic?: string | null; status?: string; assigneeName?: string | null
  taskId?: string | null; taskStatus?: string | null; durationMin?: number | null
}
const DEFAULT_DUR = 60 // длительность съёмки по умолчанию (мин)
const DUR_OPTIONS = [30, 60, 90, 120, 180] // варианты длительности в модалке
const fmtDur = (m: number) => m % 60 === 0 ? `${m / 60}ч` : m < 60 ? `${m}м` : `${Math.floor(m / 60)}ч ${m % 60}м`
const addMinToTime = (t: string, add: number) => { const p = /^(\d{1,2}):(\d{2})/.exec(t); if (!p) return t; const tot = +p[1] * 60 + +p[2] + add; return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}` }

/** «Сделано» для публикации: опубликовано ИЛИ связанная задача выполнена. */
const isDone = (e: Ev) => e.status === 'published' || e.taskStatus === 'done'
type Proj = { id: string; name: string; startDate?: string | null; endDate?: string | null; cycleStartDay?: number | null; cycleAnchor?: string | null; normReels?: number | null; normPosts?: number | null }
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
export function assignProjectColors(ids: string[]): void {
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
export function monthTitle(ym: string): string {
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
export function buildCells(ym: string): Cell[] {
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
// 'yyyy-MM' → Date (1-е число) — для непрерывного скролла месяцев.
const ymToDate = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1) }
const HOUR_PX = 50
const VIEWS: { k: View; label: string }[] = [
  { k: 'month', label: 'Месяц' }, { k: 'week', label: 'Неделя' }, { k: 'day', label: 'День' },
]

// ═══════════════════════════════════════════════════════════════════════
export default function SmmPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(new Date())
  // Счётчик явной навигации (стрелки/«Сегодня») — по нему непрерывный месячный вид прокручивается к месяцу.
  const [scrollSeq, setScrollSeq] = useState(0)
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
    if (view === 'day') return { from: iso(cursor), to: iso(cursor) }
    if (view === 'stories') return { from: iso(startOfMonth(cursor)), to: iso(endOfMonth(cursor)) }
    // Месяц И неделя — непрерывные ленты: грузим ШИРОКОЕ окно ±1 год (по году курсора). Ключ меняется
    // редко (только при переходе через год), поэтому задачи есть сразу во всей ленте, без подзагрузки
    // на каждый месяц/неделю — иначе они «выскакивают» и лента прыгает.
    const y = cursor.getFullYear()
    return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y + 1, 11, 31)) }
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
  // Длительность съёмки: оптимистично меняем в кэше — карточка сразу меняет высоту.
  const durMut = useMutation({
    mutationFn: ({ itemId, min }: { itemId: string; min: number }) => contentPlanApi.smartUpdate(itemId, { durationMin: min }),
    onMutate: async ({ itemId, min }) => {
      const key = ['smm-calendar', from, to]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<CalData>(key)
      qc.setQueryData<CalData>(key, old => old ? { ...old, events: old.events.map(e => e.itemId === itemId ? { ...e, durationMin: min } : e) } : old)
      return { prev, key }
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); toast.error('Не удалось изменить длительность') },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['smm-calendar'] }) },
  })

  // Настройки проекта — день старта месячного цикла. Открывается по шестерёнке
  // на плитке «Не запланировано», сохраняет в project.smmData.cycleStartDay.
  const [projSettings, setProjSettings] = useState<Proj | null>(null)
  const openProjSettings = (id: string) => {
    const p = projects.find(x => x.id === id)
    if (p) setProjSettings(p)
  }
  const cycleMut = useMutation({
    mutationFn: async ({ id, day, normReels, normPosts, anchor }: { id: string; day: number | null; normReels: number | null; normPosts: number | null; anchor: string | null }) => {
      await projectsApi.setSmmCycle(id, { day, normReels, normPosts, anchor })
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
    // time: undefined — не трогаем время; string — ставим час; null — снимаем (всё-день).
    mutationFn: ({ ev, dateStr, time }: { ev: Ev; dateStr: string | null; time?: string | null }) =>
      ev.kind === 'publication'
        ? contentPlanApi.smartUpdate(ev.itemId!, { publishDate: dateStr, ...(time !== undefined ? { publishTime: time } : {}) })
        : workflowApi.updateShootSession(ev.shootId!, { date: dateStr, ...(time !== undefined ? { time } : {}) }),
    onMutate: async ({ ev, dateStr, time }) => {
      const key = ['smm-calendar', from, to]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<CalData>(key)
      qc.setQueryData<CalData>(key, old => {
        if (!old) return old
        const events = old.events.filter(e => e.id !== ev.id)
        const backlog = old.backlog.filter(b => b.id !== ev.id)
        if (dateStr) events.push({ ...ev, date: dateStr, ...(time !== undefined ? { time } : {}) })  // на дату (+час)
        else backlog.push({ ...ev, date: undefined, time: null })   // обратно в корзину
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
  // Окно текущего цикла проекта — за его пределы перетаскивать нельзя.
  // null — у проекта нет цикла, ограничения нет.
  const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null)
  const [dragDuration, setDragDuration] = useState<number>(DEFAULT_DUR) // длительность перетаскиваемой задачи
  const projCycle = (projectId: string): { start: string; end: string } | null => {
    const p = projects.find(x => x.id === projectId)
    if (!p?.cycleStartDay) return null
    return activeCycle(p.cycleStartDay, p.cycleAnchor, new Date())
  }
  // Сбрасываем подсветку ограничения по окончании любого перетаскивания.
  useEffect(() => {
    const clear = () => setDragRange(null)
    document.addEventListener('dragend', clear)
    return () => document.removeEventListener('dragend', clear)
  }, [])

  const onDragStartEv = (e: Ev) => { dragRef.current = e; setDragOverKey(null); setDragRange(projCycle(e.projectId)); setDragDuration(e.durationMin || DEFAULT_DUR) }
  // Перенос на день (всё-день) — снимаем время (публикация возвращается наверх).
  const onDropDate = (dateStr: string) => {
    const e = dragRef.current
    dragRef.current = null
    setDragOverKey(null); setDragRange(null)
    if (!e) return
    if (e.date === dateStr && !e.time) return
    // Только внутри текущего цикла проекта (если он задан).
    const range = projCycle(e.projectId)
    if (range && (dateStr < range.start || dateStr > range.end)) return
    const refId = e.kind === 'publication' ? e.itemId : e.shootId
    if (!refId) return
    moveMut.mutate({ ev: e, dateStr, time: null })
  }
  // Перенос в часовой слот — ставим время съёмки на этот день.
  const onDropTime = (dateStr: string, time: string) => {
    const e = dragRef.current
    dragRef.current = null
    setDragOverKey(null); setDragRange(null)
    if (!e) return
    if (e.date === dateStr && e.time === time) return
    const range = projCycle(e.projectId)
    if (range && (dateStr < range.start || dateStr > range.end)) return
    const refId = e.kind === 'publication' ? e.itemId : e.shootId
    if (!refId) return
    moveMut.mutate({ ev: e, dateStr, time })
  }
  // Сброс события ИЗ календаря в корзину — убираем дату (возврат в «Не запланировано»).
  const onDropBacklog = () => {
    const e = dragRef.current
    dragRef.current = null
    setDragOverKey(null); setDragRange(null)
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
    // Порядок: сперва события со временем (по возрастанию), затем «весь день» (без времени) — в конце дня.
    // При равном времени съёмка идёт раньше публикации.
    const tmin = (e: Ev) => { const t = parseTime(e.time); return t ? t.h * 60 + t.m : 9999 }
    for (const arr of map.values()) arr.sort((a, b) => {
      const d = tmin(a) - tmin(b)
      if (d) return d
      return a.kind === b.kind ? 0 : a.kind === 'shoot' ? -1 : 1
    })
    return map
  }, [mainEvents])

  // Месячные циклы выбранных проектов — лента на календаре. Показываем только
  // для выбранных проектов, у которых задан день старта цикла.
  const cycles = useMemo(() => {
    // ТЕКУЩИЙ цикл — тот, в котором находится сегодня. Один цикл во всех
    // месяцах (его дни), остальное не подсвечивается. Двигается сам с датой.
    const ref = new Date()
    const out: { id: string; name: string; color: string; start: string; end: string }[] = []
    for (const p of projects) {
      if (!selProjects.has(p.id) || !p.cycleStartDay) continue
      const { start, end } = activeCycle(p.cycleStartDay, p.cycleAnchor, ref)
      out.push({ id: p.id, name: p.name, color: projColor(p.id), start, end })
    }
    return out
  }, [projects, selProjects])

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
    return projects.map(p => ({ id: p.id, name: p.name, items: byProj.get(p.id) ?? [], norm: (p.normReels ?? 0) + (p.normPosts ?? 0) }))
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
    // Календарные виды: страница на всю высоту (flex-колонка) — календарь растягивается на всё
    // свободное место, чтобы при сворачивании бэклога снизу не оставалось пустоты. Сторисы — обычный поток.
    <div className={view === 'stories' ? 'space-y-3' : 'flex flex-col gap-3 h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] min-h-0'}>
      {/* ── шапка ── */}
      <header className="flex items-center justify-between gap-3 flex-wrap shrink-0">
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
          <button onClick={() => { setCursor(new Date()); setScrollSeq(s => s + 1) }} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Сегодня</button>
          <div className="flex items-center gap-0.5">
            <button onClick={() => { step(-1); setScrollSeq(s => s + 1) }} className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft size={17} /></button>
            <button onClick={() => { step(1); setScrollSeq(s => s + 1) }} className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronRight size={17} /></button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <>
          <BacklogPanel groups={backlogGroups} activeIds={selProjects} onPick={toggleProject}
            onSettings={openProjSettings}
            onDragStart={onDragStartEv} onDrop={onDropBacklog}
            over={dragOverKey === 'backlog'} setOver={v => setDragOverKey(v ? 'backlog' : null)} />
          {view === 'month' ? (
            <MonthScrollView initialMonth={monthStr} commandMonth={monthStr} commandSeq={scrollSeq}
              byDate={mainByDate} today={today} cycles={cycles} dragRange={dragRange}
              onOpen={setDetail} onDragStart={onDragStartEv} onDropDate={onDropDate}
              onVisibleMonth={ym => setCursor(c => format(c, 'yyyy-MM') === ym ? c : ymToDate(ym))}
              dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          ) : view === 'week' ? (
            <WeekScrollView initialDay={cursor} commandDay={cursor} commandSeq={scrollSeq}
              events={mainEvents} dragRange={dragRange} dragDuration={dragDuration}
              onOpen={setDetail} onDragStart={onDragStartEv} onDropDate={onDropDate} onDropTime={onDropTime}
              onVisibleDay={d => setCursor(c => isSameDay(c, d) ? c : d)}
              dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          ) : (
            <TimeGridView days={weekDays} events={mainEvents} onOpen={setDetail} dragRange={dragRange} dragDuration={dragDuration}
              onDragStart={onDragStartEv} onDropDate={onDropDate} onDropTime={onDropTime} dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
          )}
        </>
      )}

      {detail && (
        <EventModal e={detail} marking={markMut.isPending} onClose={() => setDetail(null)}
          onMark={done => markMut.mutate({ ev: detail, done })}
          onDuration={detail.itemId ? (min => { durMut.mutate({ itemId: detail.itemId!, min }); setDetail(d => d ? { ...d, durationMin: min } : d) }) : undefined}
          onUnschedule={() => { if (detail.date) moveMut.mutate({ ev: detail, dateStr: null }); setDetail(null) }} />
      )}

      {projSettings && (
        <ProjectCycleModal p={projSettings} saving={cycleMut.isPending} clearing={clearMut.isPending}
          onClose={() => setProjSettings(null)}
          onSave={(day, normReels, normPosts, anchor) => cycleMut.mutate({ id: projSettings.id, day, normReels, normPosts, anchor })}
          onClear={() => clearMut.mutate(projSettings.id)}
          onOpen={() => navigate(`/smm/projects/${projSettings.id}`)} />
      )}
    </div>
  )
}

// ─── окно «Цикл проекта» — день старта цикла (1..31) + норма (рилсы/посты) ─
function ProjectCycleModal({ p, saving, clearing, onClose, onSave, onClear, onOpen }: {
  p: Proj; saving: boolean; clearing: boolean; onClose: () => void
  onSave: (day: number | null, normReels: number | null, normPosts: number | null, anchor: string | null) => void
  onClear: () => void; onOpen: () => void
}) {
  const [day, setDay] = useState<number | null>(p.cycleStartDay ?? null)
  const [reels, setReels] = useState<number>(p.normReels ?? 0)
  const [posts, setPosts] = useState<number>(p.normPosts ?? 0)
  const accent = projColor(p.id)
  // Начало цикла: этот месяц (0) или прошлый (1). Дефолт — этот месяц; если у
  // проекта уже сохранён якорь прошлого месяца, показываем его выбранным.
  const todayRef = new Date()
  const initLast = p.cycleStartDay != null ? cycleAnchorIso(p.cycleStartDay, todayRef, 1) : null
  const [anchorBack, setAnchorBack] = useState<0 | 1>(p.cycleAnchor && p.cycleAnchor === initLast ? 1 : 0)
  const thisAnchor = day != null ? cycleAnchorIso(day, todayRef, 0) : null
  const lastAnchor = day != null ? cycleAnchorIso(day, todayRef, 1) : null
  const thisWin = thisAnchor ? cycleBoundsFor(new Date(thisAnchor + 'T00:00:00'), day!) : null
  const lastWin = lastAnchor ? cycleBoundsFor(new Date(lastAnchor + 'T00:00:00'), day!) : null
  const chosenAnchor = day == null ? null : (anchorBack === 0 ? thisAnchor : lastAnchor)
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
        <button type="button" onClick={onOpen}
          className="mt-2.5 w-full flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
          <ExternalLink size={15} /> Открыть проект
        </button>
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
        {day != null && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 mt-4">Начало цикла</p>
            <div className="flex flex-col gap-1.5">
              {([[0, thisWin, 'Этот месяц'], [1, lastWin, 'Прошлый месяц']] as const).map(([back, win, label]) => {
                const on = anchorBack === back
                return (
                  <button key={back} type="button" onClick={() => setAnchorBack(back)}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition"
                    style={on ? { borderColor: accent, background: accent + '14' } : { borderColor: 'rgba(120,120,130,0.28)' }}>
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 grid place-items-center shrink-0" style={{ borderColor: on ? accent : '#9ca3af' }}>
                        {on && <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
                      </span>
                      <span className="text-[13px] font-medium">{label}</span>
                    </span>
                    <span className="text-[12px] text-gray-500 dark:text-gray-400 font-medium">{win && fmtCycleShort(win)}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
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
            <button disabled={saving} onClick={() => onSave(day, reels || null, posts || null, chosenAnchor)}
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
// ISO даты дня-старта в месяце ref со сдвигом monthsBack (0 = этот, 1 = прошлый).
function cycleAnchorIso(day: number, ref: Date, monthsBack = 0): string {
  const d = new Date(ref.getFullYear(), ref.getMonth() - monthsBack, 1)
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return iso(new Date(d.getFullYear(), d.getMonth(), Math.min(day, dim)))
}
// Активный цикл: если есть якорь и сегодня раньше него — цикл от якоря
// (планируем предстоящий); иначе — цикл, содержащий сегодня.
function activeCycle(day: number, anchorIso: string | null | undefined, ref: Date): { start: string; end: string } {
  if (anchorIso && /^\d{4}-\d{2}-\d{2}$/.test(anchorIso) && iso(ref) < anchorIso) return cycleBoundsFor(new Date(anchorIso + 'T00:00:00'), day)
  return cycleBoundsFor(ref, day)
}
// Раскладка пересекающихся по времени событий дня по «дорожкам» (Google-стиль):
// кластер взаимно пересекающихся делит ширину дня поровну (lane / cols).
function layoutDayEvents(evs: { id: string; start: number; end: number }[]): Map<string, { lane: number; cols: number }> {
  const sorted = [...evs].sort((a, b) => a.start - b.start || a.end - b.end)
  const res = new Map<string, { lane: number; cols: number }>()
  let cluster: { id: string; lane: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    const cols = laneEnds.length || 1
    for (const c of cluster) res.set(c.id, { lane: c.lane, cols })
    cluster = []; laneEnds = []; clusterEnd = -1
  }
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush()  // разрыв — новый кластер
    let lane = laneEnds.findIndex(end => end <= e.start)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end) } else laneEnds[lane] = e.end
    cluster.push({ id: e.id, lane })
    clusterEnd = Math.max(clusterEnd, e.end)
  }
  flush()
  return res
}
const _MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function fmtCycleShort(w: { start: string; end: string }): string {
  const s = new Date(w.start + 'T00:00:00'), e = new Date(w.end + 'T00:00:00')
  return `${s.getDate()} ${_MON_SHORT[s.getMonth()]} → ${e.getDate()} ${_MON_SHORT[e.getMonth()]}`
}

// Одна дневная клетка непрерывной недельной ленты. Начало месяца (1-е число) помечается
// коротким названием месяца в клетке — так месяцы «связаны» без дублей дней на стыке.
function DayCell({ d, evs, isToday, blocked, droppable, cycles, onOpen, onDragStart, onDropDate, dragOverKey, setDragOverKey }: {
  d: Date; evs: Ev[]; isToday: boolean; blocked: boolean; droppable: boolean
  cycles: { id: string; name: string; color: string; start: string; end: string }[]
  onOpen: (e: Ev) => void; onDragStart: (e: Ev) => void; onDropDate: (dateStr: string) => void
  dragOverKey: string | null; setDragOverKey: (k: string | null) => void
}) {
  const dISO = iso(d)
  const isFirst = d.getDate() === 1
  const weekend = d.getDay() === 0 || d.getDay() === 6
  const covering = cycles.filter(cy => dISO >= cy.start && dISO <= cy.end)
  return (
    <div data-daymonth={dISO.slice(0, 7)}
      onDragOver={droppable ? (ev => { ev.preventDefault(); if (dragOverKey !== dISO) setDragOverKey(dISO) }) : undefined}
      onDragLeave={droppable ? (() => setDragOverKey(dragOverKey === dISO ? null : dragOverKey)) : undefined}
      onDrop={droppable ? (() => onDropDate(dISO)) : undefined}
      className={'min-h-[148px] border-b border-r border-gray-100 dark:border-gray-800/80 last:border-r-0 p-1 flex flex-col gap-0.5 transition-opacity duration-300 '
        + (blocked ? 'opacity-40 ' : '')
        + (dragOverKey === dISO ? 'ring-1 ring-inset ring-gray-400 ' : '')
        + (isToday ? 'bg-[#eb5757]/[0.06]' : weekend ? 'bg-gray-50/50 dark:bg-white/[0.015]' : '')}>
      {covering.length > 0 && (
        <div className="-mx-1 -mt-1 mb-0.5 flex flex-col gap-[2px]">
          {covering.map(cy => {
            const isStart = dISO === cy.start
            const isEnd = dISO === cy.end
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
      <div className="flex items-center justify-between gap-1">
        {isFirst
          ? <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 capitalize truncate px-0.5">{d.toLocaleDateString('ru-RU', { month: 'short' })}</span>
          : <span />}
        <span className={'text-[12px] font-semibold px-1 shrink-0 ' + (isToday ? 'bg-[#eb5757] text-white rounded-full w-[20px] h-[20px] grid place-items-center' : 'text-gray-500 dark:text-gray-400')}>{d.getDate()}</span>
      </div>
      {evs.map(e => <EventChip key={e.id} e={e} onOpen={onOpen} onDragStart={onDragStart} />)}
    </div>
  )
}

// Непрерывный (Notion-style) месячный вид: НЕПРЕРЫВНАЯ лента недель — без разбивки на отдельные
// месяцы и без дублей дней на стыке (последняя неделя сентября и первая неделя октября — одна
// непрерывная лента). Начало месяца помечается в клетке 1-го числа. Заголовок вверху меняется
// на видимый месяц; стрелки/«Сегодня» прокручивают к нужному месяцу через commandSeq.
function MonthScrollView({ initialMonth, commandMonth, commandSeq, byDate, today, cycles, dragRange, onOpen, onDragStart, onDropDate, onVisibleMonth, dragOverKey, setDragOverKey }: {
  initialMonth: string; commandMonth: string; commandSeq: number
  byDate: Map<string, Ev[]>; today: string
  cycles: { id: string; name: string; color: string; start: string; end: string }[]
  dragRange: { start: string; end: string } | null
  onOpen: (e: Ev) => void; onDragStart: (e: Ev) => void; onDropDate: (d: string) => void
  onVisibleMonth: (ym: string) => void
  dragOverKey: string | null; setDragOverKey: (k: string | null) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null) // липкая шапка дней недели — её высоту вычитаем при прокрутке
  const mondayOf = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })
  // Сразу предзагружаем БОЛЬШОЙ запас недель (~7 мес. назад / ~13 вперёд), чтобы при обычном скролле
  // ничего не подгружалось на лету — иначе контент «выскакивает» и лента дёргается.
  const rangeAround = (mon: Date, before = 32, after = 56) => Array.from({ length: before + after + 1 }, (_, i) => addDays(mon, (i - before) * 7))
  const [weeks, setWeeks] = useState<Date[]>(() => rangeAround(mondayOf(ymToDate(initialMonth))))
  const prependHRef = useRef<number | null>(null) // scrollHeight до добавления недель сверху (компенсация прыжка)
  const visibleRef = useRef(initialMonth)
  const lastReported = useRef(initialMonth) // последний месяц, о котором сообщили родителю (для дебаунса заголовка)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tickingRef = useRef(false)
  const pendingScroll = useRef<string | null>(iso(mondayOf(ymToDate(initialMonth)))) // ISO понедельника недели, к которой прокрутиться
  const dimmedMonthRef = useRef<string | null>(null) // месяц «в фокусе» (остальные приглушены)
  const returnRef = useRef<null | 'up' | 'down'>(null)
  const [returnBtn, setReturnBtn] = useState<null | 'up' | 'down'>(null) // кнопка «вернуться к сегодня» + направление стрелки

  // Прокрутить к отложенной неделе, если её строка уже в DOM.
  const scrollToPending = () => {
    const wk = pendingScroll.current
    if (!wk) return
    const el = scrollRef.current
    const t = el?.querySelector(`[data-week="${wk}"]`) as HTMLElement | null
    if (el && t) { el.scrollTop = Math.max(0, t.offsetTop - (headerRef.current?.offsetHeight ?? 0)); pendingScroll.current = null }
  }

  // Приглушаем дни НЕ активного месяца (фокус на месяце, к которому проскроллили) — прямыми стилями,
  // без ре-рендера (иначе лента дёргается). Обновляем только при смене активного месяца.
  const applyDim = (month: string) => {
    if (dimmedMonthRef.current === month) return
    dimmedMonthRef.current = month
    scrollRef.current?.querySelectorAll('[data-daymonth]').forEach(c => {
      (c as HTMLElement).style.opacity = (c as HTMLElement).dataset.daymonth === month ? '' : '0.5'
    })
  }

  // Прокрутка к сегодняшней неделе (кнопка «вернуться»).
  const goToToday = () => {
    const mon = mondayOf(new Date())
    pendingScroll.current = iso(mon)
    setWeeks(ws => ws.some(w => iso(w) === iso(mon)) ? ws : rangeAround(mon))
    scrollToPending()
  }

  // После любой смены списка недель: компенсируем прыжок при добавлении сверху + отложенная прокрутка.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependHRef.current != null) {
      el.scrollTop += el.scrollHeight - prependHRef.current
      prependHRef.current = null
    }
    scrollToPending()
    dimmedMonthRef.current = null; applyDim(visibleRef.current) // приглушить и вновь добавленные недели
  }, [weeks])

  // Маунт — прокрутка к initialMonth.
  useLayoutEffect(() => { scrollToPending() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Чистка таймера дебаунса при размонтировании.
  useEffect(() => () => clearTimeout(settleTimer.current), [])

  // Внешняя навигация (стрелки / «Сегодня») — прокрутка к неделе нужного месяца.
  useEffect(() => {
    if (commandSeq === 0) return
    const targetMon = mondayOf(ymToDate(commandMonth))
    const wkIso = iso(targetMon)
    pendingScroll.current = wkIso
    visibleRef.current = commandMonth; lastReported.current = commandMonth // чтобы прокрутка не «сообщала» месяц заново
    setWeeks(ws => ws.some(w => iso(w) === wkIso) ? ws : rangeAround(targetMon))
    scrollToPending() // если неделя уже в списке — прокрутится сразу; иначе сработает layout-effect выше
  }, [commandSeq]) // eslint-disable-line react-hooks/exhaustive-deps

  const handle = () => {
    const el = scrollRef.current
    if (!el) return
    const T = 800, BATCH = 26 // догружаем только у самого края и сразу большим пакетом (редко, без «шторма» подгрузок)
    if (el.scrollTop <= T) {
      prependHRef.current = el.scrollHeight
      setWeeks(ws => [...Array.from({ length: BATCH }, (_, i) => addDays(ws[0], -(BATCH - i) * 7)), ...ws])
    } else if (el.scrollTop + el.clientHeight >= el.scrollHeight - T) {
      setWeeks(ws => [...ws, ...Array.from({ length: BATCH }, (_, i) => addDays(ws[ws.length - 1], (i + 1) * 7))])
    }
    // активный месяц = тот, что занимает БОЛЬШУЮ часть видимой области (как в Notion — фокус
    // переключается, когда новый месяц становится преобладающим, а не когда старый полностью ушёл).
    const hh = headerRef.current?.offsetHeight ?? 0
    const vTop = el.scrollTop + hh, vBot = el.scrollTop + el.clientHeight
    const area: Record<string, number> = {}
    for (const w of Array.from(el.querySelectorAll('[data-week]')) as HTMLElement[]) {
      const vis = Math.min(w.offsetTop + w.offsetHeight, vBot) - Math.max(w.offsetTop, vTop)
      if (vis > 0) { const m = w.dataset.month as string; area[m] = (area[m] || 0) + vis }
    }
    let cur = visibleRef.current, best = -1
    for (const m in area) { if (area[m] > best) { best = area[m]; cur = m } }
    visibleRef.current = cur
    if (cur) applyDim(cur) // фокус на активном месяце (прямые стили, без ре-рендера)
    // Кнопка «вернуться к сегодня»: стрелка вниз, если сегодня ниже; вверх, если выше. Прячем на текущем месяце.
    const todayM = today.slice(0, 7)
    const want: null | 'up' | 'down' = !cur || cur === todayM ? null : (cur < todayM ? 'down' : 'up')
    if (want !== returnRef.current) { returnRef.current = want; setReturnBtn(want) }
    // Заголовок меняется МГНОВЕННО при пересечении месяца (без дебаунса).
    if (cur && cur !== lastReported.current) { lastReported.current = cur; onVisibleMonth(cur) }
  }
  const onScroll = () => {
    if (tickingRef.current) return
    tickingRef.current = true
    requestAnimationFrame(() => { tickingRef.current = false; handle() })
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll}
        className="relative border-t border-gray-200 dark:border-gray-800 overflow-y-auto h-full"
        style={{ overflowAnchor: 'none' }}>
        {/* общая шапка дней недели — липкая сверху */}
        <div ref={headerRef} className="grid grid-cols-7 sticky top-0 z-20 bg-surface-100 dark:bg-surface-900">
          {DOW.map((d, i) => (
            <div key={d} className={'px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide border-b border-gray-200 dark:border-gray-800 ' + (i >= 5 ? 'text-gray-400/70' : 'text-gray-400')}>{d}</div>
          ))}
        </div>
        {weeks.map(w => {
          const wkIso = iso(w)
          const month = format(addDays(w, 3), 'yyyy-MM') // «главный» месяц недели = месяц её четверга
          const days = Array.from({ length: 7 }, (_, i) => addDays(w, i))
          return (
            <div key={wkIso} data-week={wkIso} data-month={month} className="grid grid-cols-7">
              {days.map(d => {
                const dISO = iso(d)
                const blocked = !!(dragRange && (dISO < dragRange.start || dISO > dragRange.end))
                return (
                  <DayCell key={dISO} d={d} evs={byDate.get(dISO) ?? []} isToday={dISO === today}
                    blocked={blocked} droppable={!blocked} cycles={cycles}
                    onOpen={onOpen} onDragStart={onDragStart} onDropDate={onDropDate}
                    dragOverKey={dragOverKey} setDragOverKey={setDragOverKey} />
                )
              })}
            </div>
          )
        })}
      </div>
      {/* Плавающая кнопка «вернуться к сегодня» — видна, когда проскроллил в другой месяц. */}
      {returnBtn && (
        <button onClick={goToToday}
          className="absolute left-1/2 -translate-x-1/2 bottom-3 z-30 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold text-white bg-[#eb5757] shadow-lg hover:brightness-110 transition">
          {returnBtn === 'up' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Сегодня
        </button>
      )}
    </div>
  )
}

// ─── НЕДЕЛЯ / ДЕНЬ ─────────────────────────────────────────────────────
function TimeGridView({ days, events, dragRange, dragDuration, onOpen, onDragStart, onDropDate, onDropTime, dragOverKey, setDragOverKey }: {
  days: Date[]; events: Ev[]; onOpen: (e: Ev) => void
  dragRange: { start: string; end: string } | null
  dragDuration: number
  onDragStart: (e: Ev) => void; onDropDate: (dateStr: string) => void
  onDropTime: (dateStr: string, time: string) => void
  dragOverKey: string | null; setDragOverKey: (k: string | null) => void
}) {
  const now = new Date()
  const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')
  // Подсветка конкретного слота под курсором + подсказка времени.
  const [hover, setHover] = useState<{ key: string; h: number; min: number } | null>(null)
  // Раскрытые дни в строке «Весь день» (клик «ещё N» показывает все события).
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({})
  const toggleDay = (k: string) => setOpenDays(o => ({ ...o, [k]: !o[k] }))
  // Сетка (для отсчёта позиции) и смещение захвата: где ВНУТРИ карточки схватили —
  // чтобы drop считался по ВЕРХУ карточки (её корпусу), а не по курсору мыши.
  const gridRef = useRef<HTMLDivElement>(null)
  const grabOffsetRef = useRef(0)
  useEffect(() => {
    const clear = () => { setHover(null); grabOffsetRef.current = 0 }
    document.addEventListener('dragend', clear); document.addEventListener('drop', clear)
    return () => { document.removeEventListener('dragend', clear); document.removeEventListener('drop', clear) }
  }, [])
  // Вне окна цикла (при перетаскивании) день не принимает drop.
  const dayBlocked = (d: Date) => !!(dragRange && (dayKey(d) < dragRange.start || dayKey(d) > dragRange.end))
  const dropProps = (d: Date) => dayBlocked(d) ? {} : ({
    onDragOver: (ev: RDragEvent) => { ev.preventDefault(); if (dragOverKey !== dayKey(d)) setDragOverKey(dayKey(d)) },
    onDrop: () => onDropDate(dayKey(d)),
  })
  // Время по ВЕРХУ карточки относительно сетки (учитывая, за какое место схватили),
  // снап к 30 мин. День берётся из ячейки под курсором.
  const cardTopTime = (ev: RDragEvent): { h: number; min: number } => {
    const g = gridRef.current
    if (!g) return { h: startHour, min: 0 }
    const gTop = g.getBoundingClientRect().top + 10 // +10 = paddingTop сетки (начало startHour:00)
    const rel = Math.max(0, (ev.clientY - grabOffsetRef.current) - gTop)
    const slot = Math.max(0, Math.min((endHour - startHour) * 2, Math.round((rel / HOUR_PX) * 2)))
    const abs = startHour * 60 + slot * 30
    return { h: Math.floor(abs / 60), min: abs % 60 }
  }
  const timeDropProps = (d: Date) => dayBlocked(d) ? {} : ({
    onDragOver: (ev: RDragEvent) => { ev.preventDefault(); const { h, min } = cardTopTime(ev); setHover(cur => (cur && cur.key === dayKey(d) && cur.h === h && cur.min === min) ? cur : { key: dayKey(d), h, min }) },
    onDrop: (ev: RDragEvent) => { const { h, min } = cardTopTime(ev); setHover(null); onDropTime(dayKey(d), `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`) },
  })

  // Съёмки в сетке — любые события со временем (публикации, поставленные на час, и shoot-сессии).
  const timed = events.filter(e => parseTime(e.time))
  const startHour = 8, endHour = 23
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const nowVisible = days.some(d => isSameDay(d, now)) && now.getHours() >= startHour && now.getHours() <= endHour
  const nowTop = (now.getHours() - startHour + now.getMinutes() / 60) * HOUR_PX
  const todayIdx = days.findIndex(d => isSameDay(d, now)) // индекс колонки «сегодня» (−1, если недели нет сегодня)
  const TODAY_TINT = 'rgba(235,87,87,0.06)' // лёгкая заливка колонки текущего дня (V4)

  const allDayFor = (d: Date) => events.filter(e => e.date === dayKey(d) && !parseTime(e.time))
  const timedFor = (d: Date, h: number) => timed.filter(e => e.date === dayKey(d) && parseTime(e.time)!.h === h)
  const cols = `54px repeat(${days.length}, minmax(0,1fr))`
  // Раскладка пересекающихся событий по дням (дорожки → делят ширину дня).
  const layouts = new Map<string, Map<string, { lane: number; cols: number }>>()
  for (const d of days) {
    const key = dayKey(d)
    const dayEvs = timed.filter(e => e.date === key).map(e => { const t = parseTime(e.time)!; const start = t.h * 60 + t.m; return { id: e.id, start, end: start + (e.durationMin || DEFAULT_DUR) } })
    layouts.set(key, layoutDayEvents(dayEvs))
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 overflow-y-auto flex-1 min-h-0">
      {/* шапка + «Весь день» — липкие сверху; общий скролл с сеткой ⇒ колонки одной ширины, линии ровные */}
      <div className="sticky top-0 z-30 bg-surface-100 dark:bg-surface-900">
      {/* headers */}
      <div className="grid border-b border-gray-100 dark:border-gray-800/80" style={{ gridTemplateColumns: cols }}>
        <div className="text-[10px] text-gray-400 flex items-center px-2">GMT+5</div>
        {days.map(d => {
          const isToday = isSameDay(d, now)
          return (
            <div key={dayKey(d)} className={'px-2 py-2 text-center border-l border-gray-100 dark:border-gray-800/80 transition-opacity ' + (dayBlocked(d) ? 'opacity-40' : '')}
              style={isToday ? { background: TODAY_TINT } : undefined}>
              <span className={'text-[11px] mr-1.5 ' + (isToday ? 'text-[#eb5757] font-medium' : 'text-gray-400')}>{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
              {isToday
                ? <span className="inline-grid place-items-center align-middle w-[22px] h-[22px] rounded-full bg-[#eb5757] text-white text-[13px] font-semibold">{d.getDate()}</span>
                : <span className="text-[15px] font-semibold text-gray-500 dark:text-gray-300">{d.getDate()}</span>}
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
          const open = !!openDays[dayKey(d)]
          const collapsible = items.length > MAX_PER_DAY
          const visible = collapsible && !open ? items.slice(0, MAX_PER_DAY) : items
          const isToday = isSameDay(d, now)
          return (
            <div key={dayKey(d)} {...dropProps(d)}
              style={isToday ? { background: TODAY_TINT } : undefined}
              className={'border-l border-gray-100 dark:border-gray-800/80 p-1 flex flex-col gap-1 min-h-[34px] transition-opacity ' + (over ? 'ring-1 ring-inset ring-gray-400 ' : '') + (dayBlocked(d) ? 'opacity-40' : '')}>
              {visible.map(e => <EventChip key={e.id} e={e} onOpen={onOpen} onDragStart={onDragStart} />)}
              {collapsible && (
                <button type="button" onClick={() => toggleDay(dayKey(d))}
                  className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1 text-left font-medium">
                  {open ? 'свернуть' : `ещё ${items.length - MAX_PER_DAY}`}
                </button>
              )}
            </div>
          )
        })}
      </div>
      </div>

      {/* сетка времени — скроллится внутри общего контейнера, поэтому её колонки совпадают с шапкой */}
      <div ref={gridRef} className="relative grid" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${hours.length}, ${HOUR_PX}px)`, paddingTop: 10 }}>
          {/* V4 — заливка колонки текущего дня на всю высоту (позади ячеек, не мешает drop) */}
          {todayIdx >= 0 && (
            <div className="pointer-events-none" style={{ gridColumn: todayIdx + 2, gridRow: `1 / ${hours.length + 1}`, background: TODAY_TINT }} />
          )}
          {hours.map((h, hi) => (
            <Fragment key={h}>
              <div className="text-[11px] text-gray-400 text-right pr-2 relative -top-[7px]" style={{ gridColumn: 1, gridRow: hi + 1 }}>{String(h).padStart(2, '0')}:00</div>
              {days.map((d, di) => {
                const glow = !!(hover && hover.key === dayKey(d) && hover.h === h)
                return (
                  <div key={`${h}-${dayKey(d)}`} {...timeDropProps(d)}
                    className={'border-l border-t border-gray-100 dark:border-gray-800/70 relative transition-opacity ' + (dayBlocked(d) ? 'opacity-40' : '')}
                    style={{ gridColumn: di + 2, gridRow: hi + 1 }}>
                    {/* линия получаса — час делится на два 30-мин окошка */}
                    <div className="absolute left-0 right-0 border-t border-dashed border-gray-100 dark:border-gray-800/50 pointer-events-none" style={{ top: HOUR_PX / 2 }} />
                    {/* подсветка на ВСЮ длительность задачи (сколько слотов займёт) */}
                    {glow && (
                      <>
                        <div className="absolute left-0.5 right-0.5 rounded-md pointer-events-none z-[3]"
                          style={{ top: (hover!.min / 60) * HOUR_PX + 1, height: Math.max(HOUR_PX / 2, (dragDuration / 60) * HOUR_PX) - 2, boxShadow: 'inset 0 0 0 2px #8b7bf0, 0 0 12px rgba(139,123,240,.45)', background: 'rgba(139,123,240,.10)' }} />
                        <div className="absolute left-1/2 z-[6] px-2 py-0.5 rounded-md text-[11px] font-bold text-white pointer-events-none whitespace-nowrap"
                          style={{ top: (hover!.min / 60) * HOUR_PX, transform: 'translate(-50%,-120%)', background: '#8b7bf0', boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}>
                          {String(h).padStart(2, '0')}:{String(hover!.min).padStart(2, '0')}–{addMinToTime(`${String(h).padStart(2, '0')}:${String(hover!.min).padStart(2, '0')}`, dragDuration)} · {fmtDur(dragDuration)}
                        </div>
                      </>
                    )}
                    {timedFor(d, h).map(s => {
                      const mm = parseTime(s.time)!.m
                      // Пересекающиеся события делят ширину дня (дорожки).
                      const lay = layouts.get(dayKey(d))?.get(s.id) ?? { lane: 0, cols: 1 }
                      const leftPct = (lay.lane / lay.cols) * 100
                      const widthPct = 100 / lay.cols
                      const dur = s.durationMin || DEFAULT_DUR // высота карточки = длительность
                      return (
                        <div key={s.id} onClick={() => onOpen(s)} draggable={!!(s.itemId || s.shootId)}
                          onDragStart={(ev) => { grabOffsetRef.current = (ev.nativeEvent as DragEvent).offsetY || 0; onDragStart(s) }}
                          className="absolute rounded-md px-1.5 py-1 overflow-hidden cursor-grab active:cursor-grabbing z-[2] transition hover:brightness-110"
                          style={{ top: (mm / 60) * HOUR_PX + 1, height: Math.max(20, (dur / 60) * HOUR_PX - 2), left: `calc(${leftPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`, ...projFill(s.projectId), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${projColor(s.projectId)} 60%, transparent), 0 1px 3px rgba(0,0,0,.35)` }}>
                          <div className="flex items-center gap-1 text-[12px] font-medium leading-tight"><Camera size={11} className="shrink-0" /><span className="truncate">{s.projectName || s.title}</span></div>
                          <div className="text-[11px] opacity-75 truncate mt-0.5">{s.time}–{addMinToTime(s.time!, dur)} · 🎬 Команда видеографов{s.location ? ` · ${s.location}` : ''}</div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </Fragment>
          ))}
          {nowVisible && todayIdx >= 0 && (
            <>
              {/* линия текущего времени — только в колонке «сегодня» */}
              <div className="absolute z-[7] pointer-events-none" style={{ top: nowTop + 10, left: `calc(54px + ${todayIdx} * (100% - 54px) / ${days.length})`, width: `calc((100% - 54px) / ${days.length})`, height: 2, background: '#eb5757', borderRadius: 2 }} />
              {/* точка на левом крае колонки */}
              <div className="absolute z-[8] pointer-events-none" style={{ top: nowTop + 10, left: `calc(54px + ${todayIdx} * (100% - 54px) / ${days.length})`, width: 8, height: 8, borderRadius: 999, background: '#eb5757', transform: 'translate(-50%,-50%)' }} />
              {/* Красная «таблетка» со временем в левом жёлобе — перекрывает метку часа, если время рядом с ним. */}
              <div className="absolute z-20 text-[10px] font-bold px-1 rounded pointer-events-none" style={{ top: nowTop + 10, left: 3, transform: 'translateY(-50%)', color: '#fff', background: '#eb5757' }}>
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </>
          )}
      </div>
    </div>
  )
}

// ─── НЕДЕЛЯ — ГОРИЗОНТАЛЬНАЯ бесконечная лента дней ────────────────────
// Часы фиксированы слева (sticky), дни идут колонками вправо, скролл вбок листает недели непрерывно.
function WeekScrollView({ initialDay, commandDay, commandSeq, events, dragRange, dragDuration, onOpen, onDragStart, onDropDate, onDropTime, onVisibleDay, dragOverKey, setDragOverKey }: {
  initialDay: Date; commandDay: Date; commandSeq: number
  events: Ev[]
  dragRange: { start: string; end: string } | null
  dragDuration: number
  onOpen: (e: Ev) => void; onDragStart: (e: Ev) => void; onDropDate: (dateStr: string) => void
  onDropTime: (dateStr: string, time: string) => void; onVisibleDay: (d: Date) => void
  dragOverKey: string | null; setDragOverKey: (k: string | null) => void
}) {
  const now = new Date()
  const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')
  const mondayOf = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })
  const startHour = 8, endHour = 23
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const HEADER_H = 46, COL_W = 150, GUT_W = 54, PAD = 10
  const TODAY_TINT = 'rgba(235,87,87,0.06)'
  const nowTop = (now.getHours() - startHour + now.getMinutes() / 60) * HOUR_PX

  const [hover, setHover] = useState<{ key: string; h: number; min: number } | null>(null)
  const rangeDays = (center: Date, before = 21, after = 42) => {
    const start = addDays(mondayOf(center), -before)
    return Array.from({ length: before + after + 1 }, (_, i) => addDays(start, i))
  }
  const [days, setDays] = useState<Date[]>(() => rangeDays(initialDay))

  const scrollRef = useRef<HTMLDivElement>(null)
  const hoursTopRef = useRef<HTMLDivElement>(null) // маркер начала часов (startHour:00) — база для времени при drop
  const grabOffsetRef = useRef(0)
  const prependRef = useRef(0) // сколько колонок добавлено слева (для компенсации scrollLeft; ширина фикс.)
  const visibleRef = useRef(dayKey(mondayOf(initialDay)))
  const lastReported = useRef(visibleRef.current)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tickingRef = useRef(false)
  const returnRef = useRef<null | 'left' | 'right'>(null)
  const [returnBtn, setReturnBtn] = useState<null | 'left' | 'right'>(null)
  const pendingScroll = useRef<string | null>(dayKey(mondayOf(initialDay)))

  useEffect(() => {
    const clear = () => { setHover(null); grabOffsetRef.current = 0 }
    document.addEventListener('dragend', clear); document.addEventListener('drop', clear)
    return () => { document.removeEventListener('dragend', clear); document.removeEventListener('drop', clear) }
  }, [])

  const dayBlocked = (d: Date) => !!(dragRange && (dayKey(d) < dragRange.start || dayKey(d) > dragRange.end))
  const dropProps = (d: Date) => dayBlocked(d) ? {} : ({
    onDragOver: (ev: RDragEvent) => { ev.preventDefault(); if (dragOverKey !== dayKey(d)) setDragOverKey(dayKey(d)) },
    onDrop: () => onDropDate(dayKey(d)),
  })
  // Время по ВЕРХУ карточки (с учётом захвата), снап 30 мин. День — из колонки под курсором.
  const cardTopTime = (ev: RDragEvent): { h: number; min: number } => {
    const g = hoursTopRef.current
    if (!g) return { h: startHour, min: 0 }
    const rel = Math.max(0, (ev.clientY - grabOffsetRef.current) - g.getBoundingClientRect().top)
    const slot = Math.max(0, Math.min((endHour - startHour) * 2, Math.round((rel / HOUR_PX) * 2)))
    const abs = startHour * 60 + slot * 30
    return { h: Math.floor(abs / 60), min: abs % 60 }
  }
  const timeDropProps = (d: Date) => dayBlocked(d) ? {} : ({
    onDragOver: (ev: RDragEvent) => { ev.preventDefault(); const { h, min } = cardTopTime(ev); setHover(cur => (cur && cur.key === dayKey(d) && cur.h === h && cur.min === min) ? cur : { key: dayKey(d), h, min }) },
    onDrop: (ev: RDragEvent) => { const { h, min } = cardTopTime(ev); setHover(null); onDropTime(dayKey(d), `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`) },
  })

  const timed = events.filter(e => parseTime(e.time))
  const allDayFor = (d: Date) => events.filter(e => e.date === dayKey(d) && !parseTime(e.time))
  // Строка «Весь день» (Вариант A): высота подстраивается под ВИДИМЫЕ дни (visMax) — при скролле
  // вбок растёт/уменьшается; до MAX_AD задач + «ещё N» при переполнении; клик разворачивает всю строку.
  const [allDayOpen, setAllDayOpen] = useState(false)
  const [visMax, setVisMax] = useState(0)
  const visMaxRef = useRef(0)
  const MAX_AD = 4, AD_ROW = 21, AD_CAP = 8
  // Кол-во событий «весь день» по дате (для быстрого подсчёта видимого максимума при скролле).
  const adCountMap = new Map<string, number>()
  for (const e of events) if (!parseTime(e.time)) adCountMap.set(e.date, (adCountMap.get(e.date) || 0) + 1)
  const recomputeVisMax = () => {
    const el = scrollRef.current
    if (!el) return
    const vLeft = el.scrollLeft + GUT_W, vRight = el.scrollLeft + el.clientWidth
    let m = 0
    for (const c of Array.from(el.querySelectorAll('[data-day]')) as HTMLElement[]) {
      if (c.offsetLeft + COL_W > vLeft && c.offsetLeft < vRight) m = Math.max(m, adCountMap.get(c.dataset.day as string) || 0)
    }
    if (m !== visMaxRef.current) { visMaxRef.current = m; setVisMax(m) }
  }
  const adRows = allDayOpen ? Math.min(visMax, AD_CAP) + 1 : (visMax > MAX_AD ? MAX_AD + 1 : visMax) // +1 ряд под кнопку «свернуть»
  const alldayH = Math.max(26, adRows * AD_ROW + 6)
  const timedFor = (d: Date, h: number) => timed.filter(e => e.date === dayKey(d) && parseTime(e.time)!.h === h)
  const layoutFor = (d: Date) => {
    const key = dayKey(d)
    const dayEvs = timed.filter(e => e.date === key).map(e => { const t = parseTime(e.time)!; const start = t.h * 60 + t.m; return { id: e.id, start, end: start + (e.durationMin || DEFAULT_DUR) } })
    return layoutDayEvents(dayEvs)
  }

  const scrollToPending = () => {
    const k = pendingScroll.current
    if (!k) return
    const el = scrollRef.current
    const t = el?.querySelector(`[data-day="${k}"]`) as HTMLElement | null
    if (el && t) { el.scrollLeft = Math.max(0, t.offsetLeft - GUT_W); pendingScroll.current = null }
  }
  // Добавили колонки слева → компенсируем scrollLeft (ширина колонки фикс.), чтобы лента не прыгала.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependRef.current) { el.scrollLeft += prependRef.current * COL_W; prependRef.current = 0 }
    scrollToPending()
    recomputeVisMax()
  }, [days])
  useLayoutEffect(() => { scrollToPending() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Высота строки «Весь день» под видимые дни — пересчёт при смене данных.
  useLayoutEffect(() => { recomputeVisMax() }, [events]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(settleTimer.current), [])

  // Навигация (стрелки / «Сегодня») — прокрутка к нужной неделе.
  useEffect(() => {
    if (commandSeq === 0) return
    const k = dayKey(mondayOf(commandDay))
    pendingScroll.current = k
    visibleRef.current = k; lastReported.current = k
    setDays(ds => ds.some(d => dayKey(d) === k) ? ds : rangeDays(commandDay))
    scrollToPending()
  }, [commandSeq]) // eslint-disable-line react-hooks/exhaustive-deps

  const handle = () => {
    const el = scrollRef.current
    if (!el) return
    const T = 700, BATCH = 14
    if (el.scrollLeft <= T) {
      prependRef.current += BATCH
      setDays(ds => [...Array.from({ length: BATCH }, (_, i) => addDays(ds[0], -(BATCH - i))), ...ds])
    } else if (el.scrollLeft + el.clientWidth >= el.scrollWidth - T) {
      setDays(ds => [...ds, ...Array.from({ length: BATCH }, (_, i) => addDays(ds[ds.length - 1], i + 1))])
    }
    // видимая неделя = понедельник первой видимой колонки (левый край после жёлоба)
    const x = el.scrollLeft + GUT_W + 4
    let leftDay = visibleRef.current
    for (const c of Array.from(el.querySelectorAll('[data-day]')) as HTMLElement[]) {
      if (c.offsetLeft <= x) leftDay = c.dataset.day as string
    }
    const [ly, lm, ld] = leftDay.split('-').map(Number)
    const cur = dayKey(mondayOf(new Date(ly, lm - 1, ld)))
    visibleRef.current = cur
    // Кнопка «Сегодня» — если сегодня вне видимой области.
    const todayK = dayKey(now)
    const todayEl = el.querySelector(`[data-day="${todayK}"]`) as HTMLElement | null
    let want: null | 'left' | 'right' = null
    if (todayEl) {
      if (todayEl.offsetLeft + COL_W < el.scrollLeft + GUT_W) want = 'left'
      else if (todayEl.offsetLeft > el.scrollLeft + el.clientWidth) want = 'right'
    } else want = dayKey(days[0]) > todayK ? 'left' : 'right'
    if (want !== returnRef.current) { returnRef.current = want; setReturnBtn(want) }
    // Заголовок недели меняется МГНОВЕННО при смене недели (без дебаунса).
    if (cur !== lastReported.current) {
      lastReported.current = cur
      const [y, m, dd] = cur.split('-').map(Number)
      onVisibleDay(new Date(y, m - 1, dd))
    }
    recomputeVisMax() // высота «Весь день» под видимые сейчас дни
  }
  const onScroll = () => {
    if (tickingRef.current) return
    tickingRef.current = true
    requestAnimationFrame(() => { tickingRef.current = false; handle() })
  }
  const goToToday = () => {
    const k = dayKey(mondayOf(now))
    pendingScroll.current = k
    setDays(ds => ds.some(d => dayKey(d) === k) ? ds : rangeDays(now))
    scrollToPending()
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll}
        className="relative border-t border-gray-200 dark:border-gray-800 overflow-auto h-full"
        style={{ overflowAnchor: 'none' }}>
        <div className="flex" style={{ width: 'max-content' }}>
          {/* ЖЁЛОБ ЧАСОВ — фиксирован слева */}
          <div className="sticky left-0 z-30 bg-surface-100 dark:bg-surface-900 border-r border-gray-200 dark:border-gray-800" style={{ flex: `0 0 ${GUT_W}px` }}>
            <div className="sticky top-0 z-40 bg-surface-100 dark:bg-surface-900 border-b border-gray-200 dark:border-gray-800" style={{ height: HEADER_H + alldayH }}>
              <div className="text-[10px] text-gray-400 flex items-center px-2" style={{ height: HEADER_H }}>GMT+5</div>
              {visMax > MAX_AD ? (
                <button type="button" onClick={() => setAllDayOpen(o => !o)}
                  className="w-full text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex items-start justify-end gap-0.5 pr-1.5 pt-1 transition-colors" style={{ height: alldayH }}>
                  Весь день <ChevronDown size={11} className={'mt-[1px] transition-transform ' + (allDayOpen ? 'rotate-180' : '')} />
                </button>
              ) : (
                <div className="text-[10px] text-gray-400 text-right pr-2 pt-1" style={{ height: alldayH }}>Весь день</div>
              )}
            </div>
            <div style={{ paddingTop: PAD }}>
              <div ref={hoursTopRef} />
              {hours.map(h => (
                <div key={h} className="text-[11px] text-gray-400 text-right pr-2 relative -top-[7px]" style={{ height: HOUR_PX }}>{String(h).padStart(2, '0')}:00</div>
              ))}
            </div>
          </div>

          {/* КОЛОНКИ ДНЕЙ */}
          {days.map(d => {
            const key = dayKey(d)
            const isToday = isSameDay(d, now)
            const blocked = dayBlocked(d)
            const lay = layoutFor(d)
            const weekend = d.getDay() === 0 || d.getDay() === 6 // сб/вс — слегка выделяем колонку (как в Notion)
            const nowHere = isToday && now.getHours() >= startHour && now.getHours() <= endHour
            const adItems = allDayFor(d)
            const adVisible = allDayOpen || adItems.length <= MAX_AD ? adItems : adItems.slice(0, MAX_AD)
            const adHidden = adItems.length - adVisible.length
            return (
              <div key={key} data-day={key}
                className={'border-r border-gray-100 dark:border-gray-800/80 shrink-0 ' + (!isToday && weekend ? 'bg-gray-100/60 dark:bg-white/[0.025]' : '')}
                style={{ width: COL_W, ...(isToday ? { background: TODAY_TINT } : {}) }}>
                {/* header */}
                <div className={'sticky top-0 z-20 bg-surface-100 dark:bg-surface-900 border-b border-gray-100 dark:border-gray-800/80 px-1 flex items-center justify-center gap-1.5 transition-opacity ' + (blocked ? 'opacity-40' : '')}
                  style={{ height: HEADER_H }}>
                  <span className={'text-[11px] ' + (isToday ? 'text-[#eb5757] font-medium' : 'text-gray-400')}>{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
                  {isToday
                    ? <span className="inline-grid place-items-center w-[22px] h-[22px] rounded-full bg-[#eb5757] text-white text-[13px] font-semibold">{d.getDate()}</span>
                    : <span className="text-[15px] font-semibold text-gray-500 dark:text-gray-300">{d.getDate()}</span>}
                  {d.getDate() === 1 && <span className="text-[9px] font-bold text-[#eb5757] uppercase">{d.toLocaleDateString('ru-RU', { month: 'short' })}</span>}
                </div>
                {/* all-day */}
                <div {...dropProps(d)}
                  className={'sticky z-10 bg-surface-100 dark:bg-surface-900 border-b border-gray-200 dark:border-gray-800 p-1 flex flex-col gap-1 overflow-y-auto transition-opacity ' + (dragOverKey === key ? 'ring-1 ring-inset ring-gray-400 ' : '') + (blocked ? 'opacity-40' : '')}
                  style={{ top: HEADER_H, height: alldayH }}>
                  {adVisible.map(e => <EventChip key={e.id} e={e} onOpen={onOpen} onDragStart={onDragStart} />)}
                  {adHidden > 0 && (
                    <button type="button" onClick={() => setAllDayOpen(true)}
                      className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-left px-0.5 shrink-0">ещё {adHidden}</button>
                  )}
                  {allDayOpen && adItems.length > MAX_AD && (
                    <button type="button" onClick={() => setAllDayOpen(false)}
                      className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-left px-0.5 shrink-0">свернуть</button>
                  )}
                </div>
                {/* сетка часов */}
                <div className={'relative transition-opacity ' + (blocked ? 'opacity-40' : '')} style={{ paddingTop: PAD }}>
                  {hours.map(h => {
                    const glow = !!(hover && hover.key === key && hover.h === h)
                    return (
                      <div key={h} {...timeDropProps(d)} className="border-t border-gray-100 dark:border-gray-800/70 relative" style={{ height: HOUR_PX }}>
                        <div className="absolute left-0 right-0 border-t border-dashed border-gray-100 dark:border-gray-800/50 pointer-events-none" style={{ top: HOUR_PX / 2 }} />
                        {glow && (<>
                          <div className="absolute left-0.5 right-0.5 rounded-md pointer-events-none z-[3]" style={{ top: (hover!.min / 60) * HOUR_PX + 1, height: Math.max(HOUR_PX / 2, (dragDuration / 60) * HOUR_PX) - 2, boxShadow: 'inset 0 0 0 2px #8b7bf0, 0 0 12px rgba(139,123,240,.45)', background: 'rgba(139,123,240,.10)' }} />
                          <div className="absolute left-1/2 z-[6] px-2 py-0.5 rounded-md text-[11px] font-bold text-white pointer-events-none whitespace-nowrap" style={{ top: (hover!.min / 60) * HOUR_PX, transform: 'translate(-50%,-120%)', background: '#8b7bf0', boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}>
                            {String(h).padStart(2, '0')}:{String(hover!.min).padStart(2, '0')}–{addMinToTime(`${String(h).padStart(2, '0')}:${String(hover!.min).padStart(2, '0')}`, dragDuration)} · {fmtDur(dragDuration)}
                          </div>
                        </>)}
                        {timedFor(d, h).map(s => {
                          const mm = parseTime(s.time)!.m
                          const l = lay.get(s.id) ?? { lane: 0, cols: 1 }
                          const leftPct = (l.lane / l.cols) * 100, widthPct = 100 / l.cols
                          const dur = s.durationMin || DEFAULT_DUR
                          return (
                            <div key={s.id} onClick={() => onOpen(s)} draggable={!!(s.itemId || s.shootId)}
                              onDragStart={(ev) => { grabOffsetRef.current = (ev.nativeEvent as DragEvent).offsetY || 0; onDragStart(s) }}
                              className="absolute rounded-md px-1.5 py-1 overflow-hidden cursor-grab active:cursor-grabbing z-[2] transition hover:brightness-110"
                              style={{ top: (mm / 60) * HOUR_PX + 1, height: Math.max(20, (dur / 60) * HOUR_PX - 2), left: `calc(${leftPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`, ...projFill(s.projectId), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${projColor(s.projectId)} 60%, transparent), 0 1px 3px rgba(0,0,0,.35)` }}>
                              <div className="flex items-center gap-1 text-[12px] font-medium leading-tight"><Camera size={11} className="shrink-0" /><span className="truncate">{s.projectName || s.title}</span></div>
                              <div className="text-[11px] opacity-75 truncate mt-0.5">{s.time}–{addMinToTime(s.time!, dur)} · 🎬{s.location ? ` ${s.location}` : ''}</div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {nowHere && (<>
                    <div className="absolute left-0 right-0 z-[7] pointer-events-none" style={{ top: nowTop + PAD, height: 2, background: '#eb5757', borderRadius: 2 }} />
                    <div className="absolute z-[8] pointer-events-none" style={{ top: nowTop + PAD, left: 0, width: 8, height: 8, borderRadius: 999, background: '#eb5757', transform: 'translate(-50%,-50%)' }} />
                  </>)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {returnBtn && (
        <button onClick={goToToday}
          className="absolute bottom-3 z-30 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold text-white bg-[#eb5757] shadow-lg hover:brightness-110 transition"
          style={returnBtn === 'left' ? { left: 12 } : { right: 12 }}>
          {returnBtn === 'left' ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          Сегодня
        </button>
      )}
    </div>
  )
}

// ─── ТАБ «СТОРИСЫ» — мини-календари по проектам ────────────────────────
export function StoriesTab({ projects, cells, byProject, today, monthLabel, activeIds, onPick }: {
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
  groups: { id: string; name: string; items: Ev[]; norm: number }[]; activeIds: Set<string>; onPick: (id: string) => void
  onSettings: (id: string) => void
  onDragStart: (e: Ev) => void; onDrop: () => void; over: boolean; setOver: (v: boolean) => void
}) {
  // Панель сворачивается в одну строку-кнопку, чтобы отдать место календарю (запоминаем выбор).
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('smmBacklogOpen') === '1' } catch { return false } })
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem('smmBacklogOpen', n ? '1' : '0') } catch { /* ignore */ } return n })
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!over) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop() }}
      className={'rounded-xl border px-2.5 py-1.5 transition shrink-0 ' + (over
        ? 'border-gray-400 dark:border-gray-500 bg-gray-100/50 dark:bg-gray-800/50'
        : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40')}>
      {/* Заголовок-переключатель: клик сворачивает/разворачивает панель */}
      <button type="button" onClick={toggle}
        className="w-full flex items-center gap-2 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
        <Inbox size={13} className="shrink-0" />
        <span>Не запланировано</span>
        {total > 0 && <span className="text-gray-400/70 font-semibold normal-case">· {total}</span>}
        <ChevronDown size={14} className={'ml-auto shrink-0 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (groups.length === 0 ? (
        <div className="text-[12.5px] text-gray-400 px-1 py-2">Нет SMM-проектов.</div>
      ) : (
      <div className="grid gap-2 max-h-[176px] overflow-y-auto pr-0.5 mt-1.5"
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
                <span className="text-[11px] text-gray-400 font-medium shrink-0 tabular-nums"
                  title={g.norm > 0 ? `Всего за цикл ${g.norm} · в корзине ${g.items.length}` : undefined}>
                  {g.norm > 0 ? `${g.norm}/${g.items.length}` : g.items.length}
                </span>
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
      ))}
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
          className={'flex items-center gap-1 rounded px-1.5 py-[2px] text-[11px] font-medium leading-tight truncate transition hover:brightness-110 ' + (done ? 'opacity-45 ' : '') + grab}
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

function EventModal({ e, onClose, onMark, marking, onUnschedule, onDuration }: { e: Ev; onClose: () => void; onMark: (done: boolean) => void; marking: boolean; onUnschedule: () => void; onDuration?: (min: number) => void }) {
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
        {!isShoot && onDuration && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Длительность съёмки</p>
            <div className="flex flex-wrap gap-1.5">
              {DUR_OPTIONS.map(m => {
                const on = (e.durationMin || DEFAULT_DUR) === m
                return (
                  <button key={m} type="button" onClick={() => onDuration(m)}
                    className={'text-[12px] font-semibold px-2.5 py-1 rounded-lg border transition ' + (on ? 'text-white' : 'text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800')}
                    style={on ? { background: projColor(e.projectId), borderColor: projColor(e.projectId) } : undefined}>{fmtDur(m)}</button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Столько времени займёт карточка на календаре и подсветка при перетаскивании.</p>
          </div>
        )}
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

