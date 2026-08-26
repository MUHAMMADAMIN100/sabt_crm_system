// СММ — календарь производства. Что и когда 📤 публиковать (контент-план) и
// что и когда 📸 снимать (съёмки), по проектам. Только чтение (данные из уже
// существующих контент-плана и shoot_sessions).
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Megaphone, Loader2, Camera, Send } from 'lucide-react'
import { contentPlanApi } from '@/services/api.service'

type Ev = {
  id: string; kind: 'shoot' | 'publication'; date: string
  projectId: string; projectName: string
  // shoot
  title?: string; time?: string | null; location?: string | null; note?: string | null
  // publication
  contentType?: string; topic?: string | null; status?: string; assigneeName?: string | null
}
type CalData = { month: string; events: Ev[]; projects: { id: string; name: string }[] }

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

// ─── helpers ──────────────────────────────────────────────────────────
function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, (m - 1) + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const todayIso = () => new Date().toLocaleDateString('en-CA')
const nowYm = () => todayIso().slice(0, 7)

function pubDot(e: Ev): 'ok' | 'warn' | 'late' | 'none' {
  if (e.status === 'published' || e.status === 'approved') return 'ok'
  if (e.status === 'cancelled') return 'none'
  if (e.date < todayIso()) return 'late'
  return 'warn'
}

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MAX_PER_DAY = 3

// ═══════════════════════════════════════════════════════════════════════
export default function SmmPage() {
  const [month, setMonth] = useState(nowYm())
  const [projectId, setProjectId] = useState<string | undefined>(undefined)

  const { data, isLoading, isFetching } = useQuery<CalData>({
    queryKey: ['smm-calendar', month, projectId ?? 'all'],
    queryFn: () => contentPlanApi.smmCalendar({ month, projectId }),
    placeholderData: keepPreviousData,
  })

  const events = data?.events ?? []
  const projects = data?.projects ?? []

  // события по дате (YYYY-MM-DD)
  const byDate = useMemo(() => {
    const map = new Map<string, Ev[]>()
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date)!.push(e)
    }
    // сначала съёмки, потом публикации
    for (const arr of map.values()) arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shoot' ? -1 : 1))
    return map
  }, [events])

  // сетка месяца (понедельник — первый день)
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const startWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7
    const daysInMonth = new Date(y, m, 0).getDate()
    const prevDays = new Date(y, m - 1, 0).getDate()
    const total = Math.ceil((startWeekday + daysInMonth) / 7) * 7
    const out: { label: number; inMonth: boolean; iso: string | null }[] = []
    for (let i = 0; i < total; i++) {
      const dn = i - startWeekday + 1
      if (dn < 1) out.push({ label: prevDays + dn, inMonth: false, iso: null })
      else if (dn > daysInMonth) out.push({ label: dn - daysInMonth, inMonth: false, iso: null })
      else out.push({ label: dn, inMonth: true, iso: `${month}-${String(dn).padStart(2, '0')}` })
    }
    return out
  }, [month])

  const today = todayIso()

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone size={22} /> СММ</h1>
          <p className="text-sm text-gray-500 mt-1">
            Что и когда <b className="text-orange-600 dark:text-orange-400">📸 снимать</b> и что и когда <b className="text-blue-600 dark:text-blue-400">📤 публиковать</b> — по вашим проектам.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(nowYm())} className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Сегодня</button>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth(shiftYm(month, -1))} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronLeft size={16} /></button>
            <span className="text-sm font-bold px-2 min-w-[140px] text-center">{monthTitle(month)}</span>
            <button onClick={() => setMonth(shiftYm(month, 1))} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronRight size={16} /></button>
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
      ) : (
        <>
          <div className={'rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden transition ' + (isFetching ? 'opacity-70' : '')}>
            {/* days of week */}
            <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800/70 border-b border-gray-200 dark:border-gray-700">
              {DOW.map((d, i) => (
                <div key={d} className={'px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide ' + (i >= 5 ? 'text-red-400' : 'text-gray-400')}>{d}</div>
              ))}
            </div>
            {/* month grid */}
            <div className="grid grid-cols-7">
              {cells.map((c, i) => {
                const evs = c.iso ? (byDate.get(c.iso) ?? []) : []
                const isToday = c.iso === today
                return (
                  <div key={i} className={'min-h-[104px] border-r border-b border-gray-100 dark:border-gray-800 last:border-r-0 p-1.5 flex flex-col gap-1 '
                    + (c.inMonth ? '' : 'bg-gray-50/60 dark:bg-gray-800/30 ')
                    + ((i + 1) % 7 === 0 ? 'border-r-0 ' : '')
                    + (isToday ? 'bg-surface-50/50 dark:bg-surface-900/20' : '')}>
                    <span className={'text-xs font-bold self-start px-1 ' + (isToday ? 'bg-surface-500 text-white rounded-md min-w-[22px] text-center' : c.inMonth ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600')}>{c.label}</span>
                    {evs.slice(0, MAX_PER_DAY).map(e => <EventChip key={e.id} e={e} />)}
                    {evs.length > MAX_PER_DAY && <span className="text-[10.5px] text-gray-400 font-semibold px-1">+{evs.length - MAX_PER_DAY} ещё</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500 items-center">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500" /> 📸 Съёмка</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-pink-500" /> Reel</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-500" /> Макет</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-cyan-500" /> Сторис</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500" /> Пост</span>
            <span className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> готово <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ml-1" /> в работе <span className="w-2.5 h-2.5 rounded-full bg-red-500 ml-1" /> просрочено</span>
          </div>

          {events.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">На этот месяц публикаций и съёмок не запланировано.</p>
          )}
        </>
      )}
    </div>
  )
}

function EventChip({ e }: { e: Ev }) {
  if (e.kind === 'shoot') {
    return (
      <span className={'flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md truncate ' + SHOOT_CLS}
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
    <span className={'flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md truncate ' + (TYPE_CLS[type] || TYPE_CLS.other)}
          title={`${TYPE_LABEL[type] || 'Контент'} · ${e.projectName}${e.topic ? ` · ${e.topic}` : ''}${e.assigneeName ? ` · ${e.assigneeName}` : ''}`}>
      <Send size={10} className="shrink-0" />
      <span className="truncate">{TYPE_LABEL[type] || 'Контент'} · {e.projectName}</span>
      {dot !== 'none' && <span className={'w-1.5 h-1.5 rounded-full ml-auto shrink-0 ' + DOT[dot]} />}
    </span>
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
