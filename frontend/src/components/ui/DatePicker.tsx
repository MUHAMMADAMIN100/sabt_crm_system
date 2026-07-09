import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import type { DateRange } from 'react-day-picker'
import { ru } from 'date-fns/locale'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import clsx from 'clsx'
import 'react-day-picker/dist/style.css'

/**
 * Универсальные date-инпуты на базе react-day-picker. Заменяют родные
 * <input type="date"> и <input type="datetime-local">, чтобы:
 *  - выглядеть консистентно с indigo-палитрой проекта;
 *  - не зависеть от тёмной/светлой темы браузера;
 *  - поддержать одиночную дату, дату+время и диапазон.
 */

const dayPickerClass = clsx('rdp-custom p-3 text-sm')
// Фиксированная ширина popover'а — нужна для корректного flip'а у правого края.
// 320px = 7 колонок дат × 36px + padding × 2 + бордеры (с запасом для preset-чипов).
const POPOVER_WIDTH = 320

/**
 * Popover через portal в body. Раньше абсолютно позиционировался относительно
 * якоря и обрезался при overflow:hidden родителя (внутри модалок popover
 * вылезал за границу и был обрезан). Теперь:
 *  - рендерится в document.body (поверх всего, не зависит от overflow);
 *  - координаты считаются от bounding-rect якоря;
 *  - если справа не помещается — flip вправо (right-align к якорю);
 *  - если снизу не помещается — flip вверх над якорем.
 */
function Popover({
  children, open, onClose, anchorRef,
}: {
  children: React.ReactNode
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Считаем позицию ПЕРЕД отрисовкой, чтобы не было «прыжка» из левого
  // верхнего угла. useLayoutEffect синхронен относительно reflow.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const popH = popRef.current?.offsetHeight || 360
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = rect.left
    if (left + POPOVER_WIDTH + 8 > vw) {
      // Не лезет справа — выравниваем по правому краю якоря.
      left = Math.max(8, rect.right - POPOVER_WIDTH)
    }
    let top = rect.bottom + 4
    if (top + popH + 8 > vh) {
      const flipped = rect.top - popH - 4
      top = flipped > 8 ? flipped : Math.max(8, vh - popH - 8)
    }
    setPos({ top, left })
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onScroll = () => onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    // На скролл закрываем — пересчёт позиции при каждом скролле даёт
    // дёрганый popover, проще закрыть и открыть заново.
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null
  return createPortal(
    <div
      ref={popRef}
      className="fixed z-[200] bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl animate-fade-in"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: POPOVER_WIDTH,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// ─── Одиночная дата (YYYY-MM-DD) ──────────────────────────────────────

export function DatePicker({
  value, onChange, placeholder = 'Выберите дату', className, disabled,
  clearable = true, allowFuture = true, startYear = 1940, marks, minDate, maxDate,
}: {
  /** ISO YYYY-MM-DD или пустая строка. */
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  clearable?: boolean
  allowFuture?: boolean
  /** Первый год в дропдауне. Дефолт 1940 — чтобы даты рождения и любые
   *  исторические даты были доступны; нативный select сам скроллится
   *  к выбранному году, длинный список не мешает. */
  startYear?: number
  /** «Занятые» дни — подсветка цветом типа: рилс — голубой, макет —
   *  оранжевый, съёмка — фиолетовый. Помогает выбрать свободный день.
   *  label — подпись для ховер-подсказки («Проект · Рилс: Тема»). */
  marks?: { date: string; kind: 'reel' | 'macro' | 'shoot'; label?: string }[]
  /** Минимально/максимально допустимая дата (ISO YYYY-MM-DD). Дни вне
   *  диапазона гасятся и недоступны для выбора. */
  minDate?: string
  maxDate?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const date = value ? parseLocalDate(value) : undefined

  const reelDays = (marks || []).filter(m => m.kind === 'reel').map(m => parseLocalDate(m.date))
  const macroDays = (marks || []).filter(m => m.kind === 'macro').map(m => parseLocalDate(m.date))
  const shootDays = (marks || []).filter(m => m.kind === 'shoot').map(m => parseLocalDate(m.date))

  // Группировка меток по дню: количество (бейдж) + список для ховер-подсказки.
  const marksByDay = new Map<string, { count: number; labels: string[] }>()
  const KIND_LABEL: Record<string, string> = { reel: 'Рилс', macro: 'Макет', shoot: 'Съёмка' }
  for (const m of marks || []) {
    if (!m.date) continue
    const e = marksByDay.get(m.date) || { count: 0, labels: [] }
    e.count += 1
    e.labels.push(m.label || KIND_LABEL[m.kind] || m.kind)
    marksByDay.set(m.date, e)
  }

  // Ограничения диапазона: дни до minDate и после maxDate — недоступны.
  const minD = minDate ? parseLocalDate(minDate) : undefined
  const maxD = maxDate ? parseLocalDate(maxDate) : undefined
  const disabledMatchers: any[] = []
  if (!allowFuture) disabledMatchers.push({ after: new Date() })
  if (minD) disabledMatchers.push({ before: minD })
  if (maxD) disabledMatchers.push({ after: maxD })
  const disabledProp = disabledMatchers.length ? disabledMatchers : undefined

  // «Сегодня» показываем только если сегодня попадает в допустимый диапазон.
  const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()
  const todayInRange = (!minD || todayStart >= minD) && (!maxD || todayStart <= maxD)

  const handleSelect = (d: Date | undefined) => {
    if (!d) return
    onChange(format(d, 'yyyy-MM-dd'))
    setOpen(false)
  }

  // Кастомная кнопка дня: бейдж с количеством (когда на день ≥2 единиц) и
  // нативная ховер-подсказка со списком «что именно стоит на этот день».
  const DayBtn = (props: any) => {
    const { day, modifiers: _m, ...buttonProps } = props
    const iso = format(day.date, 'yyyy-MM-dd')
    const info = marksByDay.get(iso)
    return (
      <button
        {...buttonProps}
        title={info ? info.labels.join('\n') : buttonProps.title}
        style={{ ...buttonProps.style, position: 'relative' }}
      >
        {buttonProps.children}
        {info && info.count >= 2 && (
          <span
            style={{
              position: 'absolute', top: -4, right: -4, minWidth: 15, height: 15,
              padding: '0 3px', borderRadius: 8, background: '#4f46e5', color: '#fff',
              fontSize: 9.5, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
              pointerEvents: 'none', boxShadow: '0 0 0 1.5px #fff',
            }}
          >{info.count}</span>
        )}
      </button>
    )
  }

  return (
    <div ref={anchorRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className={clsx(
          'input w-full text-left flex items-center gap-2',
          !value && 'text-surface-400',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        <CalendarIcon size={14} className="text-surface-400 shrink-0" />
        <span className="flex-1 truncate">
          {date ? format(date, 'd MMM yyyy', { locale: ru }) : placeholder}
        </span>
        {clearable && value && !disabled && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            className="text-surface-400 hover:text-red-500"
          ><X size={14} /></span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}>
        <DayPicker
          mode="single"
          selected={date}
          onSelect={handleSelect}
          locale={ru as any}
          weekStartsOn={1}
          showOutsideDays
          disabled={disabledProp}
          className={dayPickerClass}
          captionLayout="dropdown"
          startMonth={new Date(startYear, 0)}
          endMonth={new Date(2035, 11)}
          modifiers={{ reelMark: reelDays, macroMark: macroDays, shootMark: shootDays }}
          modifiersStyles={{
            reelMark: { backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: 700, borderRadius: 6 },
            macroMark: { backgroundColor: '#ffedd5', color: '#c2410c', fontWeight: 700, borderRadius: 6 },
            shootMark: { backgroundColor: '#ede9fe', color: '#6d28d9', fontWeight: 700, borderRadius: 6 },
          }}
          components={{ DayButton: DayBtn }}
        />
        {(reelDays.length > 0 || macroDays.length > 0 || shootDays.length > 0) && (
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 px-3 pt-2 text-[11px] text-surface-500 dark:text-surface-400">
            {reelDays.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dbeafe', border: '1px solid #93c5fd' }} /> рилс
              </span>
            )}
            {macroDays.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ffedd5', border: '1px solid #fdba74' }} /> макет
              </span>
            )}
            {shootDays.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ede9fe', border: '1px solid #c4b5fd' }} /> съёмка
              </span>
            )}
            <span className="text-surface-400">— занятые дни (наведите: что стоит)</span>
          </div>
        )}
        <div className="flex gap-2 px-3 py-2 border-t border-surface-100 dark:border-surface-700 text-xs">
          {todayInRange && (
            <button
              type="button"
              onClick={() => { onChange(format(new Date(), 'yyyy-MM-dd')); setOpen(false) }}
              className="text-primary-600 hover:underline"
            >Сегодня</button>
          )}
          {clearable && value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="ml-auto text-red-500 hover:underline"
            >Очистить</button>
          )}
        </div>
      </Popover>
    </div>
  )
}

// ─── Дата + время (datetime-local) ────────────────────────────────────

export function DateTimePicker({
  value, onChange, placeholder = 'Дата и время', className, disabled, clearable = true,
}: {
  /** ISO YYYY-MM-DDTHH:mm или пустая строка. */
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const dt = value ? new Date(value) : undefined
  const datePart = value ? value.slice(0, 10) : ''
  const timePart = value ? value.slice(11, 16) : '12:00'

  const setDate = (d: Date | undefined) => {
    if (!d) return
    const dStr = format(d, 'yyyy-MM-dd')
    onChange(`${dStr}T${timePart}`)
  }
  const setTime = (t: string) => {
    const dStr = datePart || format(new Date(), 'yyyy-MM-dd')
    onChange(`${dStr}T${t}`)
  }

  return (
    <div ref={anchorRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className={clsx(
          'input w-full text-left flex items-center gap-2',
          !value && 'text-surface-400',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        <CalendarIcon size={14} className="text-surface-400 shrink-0" />
        <span className="flex-1 truncate">
          {dt ? format(dt, 'd MMM yyyy, HH:mm', { locale: ru }) : placeholder}
        </span>
        {clearable && value && !disabled && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            className="text-surface-400 hover:text-red-500"
          ><X size={14} /></span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}>
        <DayPicker
          mode="single"
          selected={dt}
          onSelect={setDate}
          locale={ru as any}
          weekStartsOn={1}
          showOutsideDays
          className={dayPickerClass}
          captionLayout="dropdown"
          startMonth={new Date(1940, 0)}
          endMonth={new Date(2035, 11)}
        />
        <div className="flex items-center gap-2 px-3 py-2 border-t border-surface-100 dark:border-surface-700">
          <label className="text-xs text-surface-500">Время</label>
          <input
            type="time"
            value={timePart}
            onChange={e => setTime(e.target.value)}
            className="input text-sm py-1 px-2 flex-1 min-h-0"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn-primary text-xs px-3 py-1.5 min-h-0"
          >ОК</button>
        </div>
      </Popover>
    </div>
  )
}

// ─── Диапазон дат (от-до) ─────────────────────────────────────────────

export function DateRangePicker({
  from, to, onChange, placeholder = 'Выберите период', className,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const range: DateRange | undefined = from
    ? { from: parseLocalDate(from), to: to ? parseLocalDate(to) : undefined }
    : undefined

  const handleSelect = (r: DateRange | undefined) => {
    if (!r?.from) return
    onChange(
      format(r.from, 'yyyy-MM-dd'),
      r.to ? format(r.to, 'yyyy-MM-dd') : format(r.from, 'yyyy-MM-dd'),
    )
  }

  const setPreset = (preset: 'today' | 'week' | 'month' | 'prev_month') => {
    const now = new Date()
    let f: Date, t: Date
    if (preset === 'today') {
      f = t = now
    } else if (preset === 'week') {
      f = new Date(now); f.setDate(now.getDate() - 6)
      t = now
    } else if (preset === 'month') {
      f = new Date(now.getFullYear(), now.getMonth(), 1)
      t = now
    } else {
      f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      t = new Date(now.getFullYear(), now.getMonth(), 0)
    }
    onChange(format(f, 'yyyy-MM-dd'), format(t, 'yyyy-MM-dd'))
    setOpen(false)
  }

  const label = (() => {
    if (!from) return placeholder
    const fd = parseLocalDate(from)
    if (!to || from === to) return format(fd, 'd MMM yyyy', { locale: ru })
    const td = parseLocalDate(to)
    return `${format(fd, 'd MMM', { locale: ru })} – ${format(td, 'd MMM yyyy', { locale: ru })}`
  })()

  return (
    <div ref={anchorRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'input w-full text-left flex items-center gap-2',
          !from && 'text-surface-400',
        )}
      >
        <CalendarIcon size={14} className="text-surface-400 shrink-0" />
        <span className="flex-1 truncate">{label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}>
        <div className="flex flex-wrap gap-1 px-3 pt-3 pb-2 border-b border-surface-100 dark:border-surface-700">
          {([
            ['today', 'Сегодня'],
            ['week', 'Неделя'],
            ['month', 'Этот месяц'],
            ['prev_month', 'Прошлый месяц'],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPreset(k)}
              className="px-2 py-1 text-xs rounded-md bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-200 hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            >{lbl}</button>
          ))}
        </div>
        <DayPicker
          mode="range"
          selected={range}
          onSelect={handleSelect}
          locale={ru as any}
          weekStartsOn={1}
          showOutsideDays
          numberOfMonths={1}
          className={dayPickerClass}
          captionLayout="dropdown"
          startMonth={new Date(1940, 0)}
          endMonth={new Date(2035, 11)}
        />
        <div className="flex gap-2 px-3 py-2 border-t border-surface-100 dark:border-surface-700 text-xs">
          <button
            type="button"
            onClick={() => { onChange('', ''); setOpen(false) }}
            className="text-red-500 hover:underline"
          >Сбросить</button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto text-primary-600 hover:underline font-semibold"
          >Готово</button>
        </div>
      </Popover>
    </div>
  )
}

/** Парсим строку YYYY-MM-DD в локальную полночь — Date('2026-05-29')
 *  отдаёт UTC и в некоторых tz сдвигается на день назад. */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
