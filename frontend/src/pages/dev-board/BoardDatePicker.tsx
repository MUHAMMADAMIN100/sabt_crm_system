import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import clsx from 'clsx'

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const WEEK = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']

function parseIso(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, m: mo, d }
}
function toIso(y: number, m: number, d: number) {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return y + '-' + p2(m) + '-' + p2(d)
}
function fmtRu(iso: string) {
  const p = parseIso(iso)
  if (!p) return String(iso ?? '')
  return String(p.d).padStart(2,'0') + '.' + String(p.m).padStart(2,'0') + '.' + p.y
}
function todayIso() {
  const n = new Date()
  return toIso(n.getFullYear(), n.getMonth() + 1, n.getDate())
}
export function BoardDatePicker(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  clearable?: boolean
  small?: boolean
}) {
  const value = props.value || ''
  const ph = props.placeholder || 'Выберите дату'
  const clr = props.clearable !== false
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnId = useId()
  const rafRef = useRef<number[]>([])
  const closeTimer = useRef<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0, width: 280, up: false, ready: false })
  const parsed = value ? parseIso(value) : null
  const now = new Date()
  const initY = parsed ? parsed.y : now.getFullYear()
  const initM = parsed ? parsed.m : now.getMonth() + 1
  const [viewY, setViewY] = useState(initY)
  const [viewM, setViewM] = useState(initM)
  const [focusD, setFocusD] = useState<number | null>(null)
  const label = parsed ? fmtRu(value) : ph
  const empty = !value
  const openPanel = () => {
    if (mounted) return
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
    const r = rootRef.current ? rootRef.current.getBoundingClientRect() : null
    if (r) {
      const w = Math.max(r.width, 280)
      const below = window.innerHeight - r.bottom
      const up = below < 340 && r.top > 340
      setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: w, up, ready: true })
    } else {
      setPos((p) => ({ ...p, ready: true }))
    }
    const p = value ? parseIso(value) : null
    const n = new Date()
    setViewY(p ? p.y : n.getFullYear())
    setViewM(p ? p.m : n.getMonth() + 1)
    setFocusD(p ? p.d : null)
    setMounted(true)
    rafRef.current.push(requestAnimationFrame(() => {
      rafRef.current.push(requestAnimationFrame(() => setVisible(true)))
    }))
  }
  const closePanel = () => {
    setVisible(false)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { setMounted(false); closeTimer.current = null }, 160)
  }
  const toggle = () => { if (mounted) closePanel(); else openPanel() }
  const pick = (iso: string) => { closePanel(); props.onChange(iso); if (btnRef.current) btnRef.current.focus({ preventScroll: true }) }
  const doClear = () => { closePanel(); props.onChange('') }
  useEffect(() => {
    return () => {
      rafRef.current.forEach((id) => cancelAnimationFrame(id))
      if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
    }
  }, [])
  useEffect(() => {
    if (!mounted) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      const inRoot = rootRef.current ? rootRef.current.contains(t) : false
      const inPanel = panelRef.current ? panelRef.current.contains(t) : false
      if (!inRoot && !inPanel) closePanel()
    }
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return
      closePanel()
    }
    const onResize = () => closePanel()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [mounted])
  const stepDay = (delta: number) => {
    const base = focusD !== null ? focusD : (parsed ? parsed.d : 1)
    const dt = new Date(viewY, viewM - 1, base + delta)
    setViewY(dt.getFullYear())
    setViewM(dt.getMonth() + 1)
    setFocusD(dt.getDate())
  }
  const shiftMonth = (delta: number) => {
    const dt = new Date(viewY, viewM - 1 + delta, 1)
    setViewY(dt.getFullYear())
    setViewM(dt.getMonth() + 1)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!mounted) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openPanel() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel() }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (focusD !== null) pick(toIso(viewY, viewM, focusD)) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepDay(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepDay(-1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepDay(7) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); stepDay(-7) }
    else if (e.key === 'Tab') closePanel()
  }
  const first = new Date(viewY, viewM - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const tIso = todayIso()
  const years: number[] = []
  for (let y = 1970; y <= 2045; y++) years.push(y)
  const panelLeft = Math.max(8, Math.min(pos.left, window.innerWidth - pos.width - 8))
  return (
    <div ref={rootRef} className={clsx('relative', props.className)} onKeyDown={onKeyDown}>
      <button ref={btnRef} id={btnId} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={mounted} aria-label={parsed ? ('Дата ' + label) : ph}
        className={clsx('input w-full flex items-center gap-2 text-left transition-colors', props.small && '!py-1 text-xs', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50', empty && 'text-surface-500 dark:text-surface-400')}>
        <CalendarDays size={14} className="text-surface-400 shrink-0" aria-hidden={true} />
        <span className="flex-1 truncate tabular-nums">{label}</span>
        {clr && value ? (
          <button
            type="button"
            aria-label="Очистить дату"
            title="Очистить дату"
            onClick={(e) => { e.stopPropagation(); doClear() }}
            className="shrink-0 rounded p-0.5 -m-0.5 min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center text-surface-400 hover:text-red-500 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
          >
            <X size={14} aria-hidden={true} />
          </button>
        ) : (
          <ChevronDown size={15} aria-hidden={true} className={clsx('shrink-0 text-surface-400 transition-transform duration-150 ease-out', mounted && 'rotate-180')} />
        )}
      </button>
      {mounted && pos.ready && createPortal(
        <div ref={panelRef} role="dialog" aria-label="Выбор даты"
          style={pos.up ? { position: 'fixed', left: panelLeft, width: pos.width, maxWidth: 'calc(100vw - 16px)', bottom: window.innerHeight - pos.top } : { position: 'fixed', left: panelLeft, width: pos.width, maxWidth: 'calc(100vw - 16px)', top: pos.top }}
          className={clsx('z-[999] overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700', 'bg-white dark:bg-surface-800 shadow-xl transition-all duration-150 ease-out', pos.up ? 'origin-bottom' : 'origin-top', visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none')}>
          <CalHead viewY={viewY} viewM={viewM} years={years} setViewY={setViewY} shiftMonth={shiftMonth} />
          <CalGrid viewY={viewY} viewM={viewM} lead={lead} value={value} tIso={tIso} focusD={focusD} setFocusD={setFocusD} pick={pick} />
          <div className="flex gap-2 px-3 py-2 border-t border-surface-100 dark:border-surface-700 text-xs">
            <button type="button" onClick={() => pick(tIso)} className="text-primary-600 dark:text-primary-400 hover:underline font-medium">Сегодня</button>
            {clr && value && <button type="button" onClick={doClear} className="ml-auto text-red-500 hover:underline">Очистить</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function CalHead(props: { viewY: number; viewM: number; years: number[]; setViewY: (y: number) => void; shiftMonth: (d: number) => void }) {
  return (
    <div className="flex items-center gap-1 px-3 pt-3 pb-2">
      <button type="button" onClick={() => props.shiftMonth(-1)} aria-label="Предыдущий месяц" className="p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"><ChevronLeft size={16} /></button>
      <div className="flex-1 text-center text-sm font-semibold text-surface-900 dark:text-surface-100 capitalize">
        {MONTHS[props.viewM - 1] + ' '}
        <select value={props.viewY} onChange={(e) => props.setViewY(Number(e.target.value))} aria-label="Год" onClick={(e) => e.stopPropagation()} className="bg-transparent font-semibold cursor-pointer rounded px-0.5 outline-none">
          {props.years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <button type="button" onClick={() => props.shiftMonth(1)} aria-label="Следующий месяц" className="p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"><ChevronRight size={16} /></button>
    </div>
  )
}
function CalGrid(props: { viewY: number; viewM: number; lead: number; value: string; tIso: string; focusD: number | null; setFocusD: (d: number) => void; pick: (iso: string) => void }) {
  return (
    <div>
      <div className="px-3 pb-1 grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-surface-400 dark:text-surface-500">
        {WEEK.map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>
      <div className="px-3 pb-2 grid grid-cols-7 gap-0.5">
        {Array.from({ length: 42 }).map((_, i) => {
          const dt = new Date(props.viewY, props.viewM - 1, 1 - props.lead + i)
          const y = dt.getFullYear()
          const m = dt.getMonth() + 1
          const d = dt.getDate()
          const iso = toIso(y, m, d)
          const outside = m !== props.viewM
          const selected = props.value !== '' && iso === props.value.slice(0, 10)
          const isToday = iso === props.tIso
          const focused = props.focusD === d && m === props.viewM && !outside
          const cls = selected ? 'bg-primary-600 text-white font-semibold hover:bg-primary-600'
            : outside ? 'text-surface-300 dark:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700'
            : 'text-surface-700 dark:text-surface-300 hover:bg-primary-50 dark:hover:bg-primary-900/30'
          return (
            <button key={iso} type="button" onClick={() => props.pick(iso)} onMouseEnter={() => { if (!outside) props.setFocusD(d) }} aria-label={d + ' ' + MONTHS[m - 1] + ' ' + y} aria-pressed={selected}
              className={clsx('relative h-8 rounded-lg text-[13px] tabular-nums transition-colors duration-100', cls, focused && !selected && 'bg-primary-50 dark:bg-primary-900/30', isToday && !selected && 'font-bold text-primary-700 dark:text-primary-300')}>
              {d}
              {isToday && !selected && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-600 dark:bg-primary-400" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
