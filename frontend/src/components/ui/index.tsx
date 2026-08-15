import { useEffect, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'

// ── Collapsible section with localStorage persistence ─────────────────
interface CollapsibleSectionProps {
  id: string
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  /** false — не запоминать свёрнутость между визитами. Для ключевых рабочих
   *  блоков: случайный клик по заголовку «прятал» таблицу навсегда, и это
   *  выглядело как пустой дашборд. */
  persist?: boolean
}

export function CollapsibleSection({ id, title, children, defaultOpen = true, className, persist = true }: CollapsibleSectionProps) {
  const storageKey = `dash-collapse:${id}`
  const [open, setOpen] = useState<boolean>(() => {
    if (!persist) return defaultOpen
    try {
      const v = localStorage.getItem(storageKey)
      if (v === '1') return true
      if (v === '0') return false
    } catch {}
    return defaultOpen
  })

  useEffect(() => {
    if (!persist) return
    try { localStorage.setItem(storageKey, open ? '1' : '0') } catch {}
  }, [open, storageKey, persist])

  return (
    <div className={clsx('card', className)}>
      {/* Заголовок — div с role="button", а не <button>: в title приходит
          произвольный контент, и у некоторых секций внутри свои кнопки
          (переключатель периода в сводке продаж). Вложенный button в button —
          невалидная разметка: React ругается, а клик по внутренней кнопке
          браузер может отдать внешней. Клики по интерактивным элементам
          внутри заголовка не схлопывают секцию. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={e => {
          const t = e.target as HTMLElement
          if (t.closest('button, a, input, select, textarea, [role="button"]:not([data-collapse-root])')) return
          setOpen(o => !o)
        }}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
        }}
        data-collapse-root
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0">{title}</div>
        <ChevronDown
          size={16}
          className={clsx(
            'text-surface-400 shrink-0 transition-transform duration-200 ease-out',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </div>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Произвольный контент в правом верхнем углу заголовка (например,
   *  быстрая кнопка действия). Появляется между title и X-кнопкой. */
  titleAction?: ReactNode
}

export function Modal({ open, onClose, title, children, size = 'md', titleAction }: ModalProps) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // double rAF: first frame renders the initial state (opacity-0/scale-95),
      // second frame triggers the transition to visible state
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => setVisible(true))
        return () => cancelAnimationFrame(r2)
      })
      return () => cancelAnimationFrame(r1)
    } else {
      setVisible(false)
      const t = setTimeout(() => setMounted(false), 250)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Escape закрывает окно — привычно и позволяет выйти с клавиатуры, не
  // целясь мышью в крестик. Клик по подложке уже работает.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* Backdrop — простое затемнение, без backdrop-blur и spring-эффектов. */}
      <div
        className={clsx(
          'absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      {/* Panel — спокойный fade + лёгкий slide-up без overshoot. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        className={clsx(
          'relative bg-surface-50 dark:bg-surface-800 w-full',
          'rounded-t-xl sm:rounded-xl border border-surface-200 dark:border-surface-700',
          'shadow-[0_12px_32px_-8px_rgba(15,15,18,0.18)]',
          'max-h-[90vh] sm:max-h-[85vh] flex flex-col',
          'transition-all duration-200 ease-out',
          sizes[size],
          visible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-3',
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100 dark:border-surface-700 shrink-0 gap-3">
            <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100 tracking-tight">{title}</h2>
            <div className="flex items-center gap-2 shrink-0">
              {titleAction}
              <button
                onClick={onClose}
                aria-label="Закрыть"
                title="Закрыть"
                className="p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        {!title && (
          <button
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 z-10 transition-colors"
          >
            <X size={16} />
          </button>
        )}
        <div className="p-5 overflow-y-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ── Badge ──────────────────────────────────────────────────────────
interface BadgeProps { children: ReactNode; variant?: string; className?: string }

export function Badge({ children, variant = '', className }: BadgeProps) {
  return (
    <span className={clsx('badge', variant && `status-${variant}`, className)}>
      {children}
    </span>
  )
}

// Подписи статусов задачи импортируем из централизованного модуля
// (Wave 11 — 4-статусная модель). Старые проектные статусы оставлены
// как есть для других сущностей (project/employee), которые ими пользуются.
import { STATUS_LABELS as TASK_STATUS_LABELS, normalizeTaskStatus } from '@/lib/taskStatus'

const NON_TASK_STATUS_LABELS: Record<string, string> = {
  planning: 'Планируется', completed: 'Завершён', archived: 'Архив', on_hold: 'Пауза',
  active: 'Активный', inactive: 'Неактивный',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический',
}

export function StatusBadge({ status }: { status: string }) {
  // Сначала пробуем как статус задачи (нормализуем легаси-значения).
  // Если статус не из таск-набора — берём подпись из набора проектов/прочих.
  const taskLabel = TASK_STATUS_LABELS[normalizeTaskStatus(status)]
  const label = NON_TASK_STATUS_LABELS[status] ?? taskLabel ?? status
  return <Badge variant={status}>{label}</Badge>
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={clsx('badge', `priority-${priority}`)}>{PRIORITY_LABELS[priority] || priority}</span>
}

// ── Spinner ─────────────────────────────────────────────────────────
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  const r = (size / 2) - 3
  const circ = 2 * Math.PI * r
  return (
    <svg
      className={clsx('text-primary-600', className)}
      style={{ width: size, height: size }}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
    >
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="currentColor" strokeWidth="3"
        className="opacity-15"
      />
      {/* Arc */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="currentColor" strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * 0.7}
        className="animate-spin origin-center"
        style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
      />
    </svg>
  )
}

// ── PageLoader ───────────────────────────────────────────────────────
/** Брендированный «пульсирующий S» — узнаваемый лоадер для пустых
 *  состояний загрузки. На светлой теме — белый плиточный фон + индиго
 *  буква; на тёмной — индиго фон + белая буква. Красная точка — фирменный
 *  маркер. */
export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-20 h-20 rounded-2xl animate-pulse flex items-center justify-center relative shadow-lg
                      bg-surface-50 dark:bg-primary-600">
        <span
          className="text-[52px] font-black leading-none select-none text-primary-600 dark:text-white"
          style={{ fontFamily: 'Arial Black, sans-serif' }}
        >S</span>
        <div className="absolute top-2 right-3 w-4 h-4 rounded-full bg-red-500" />
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function SkeletonCard() {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  )
}

// ── EmptyState ───────────────────────────────────────────────────────
/** Нейтральный пустой стейт — без эмодзи и без bouncing. Спокойная плашка
 *  для всех «нет данных» сценариев. */
export function EmptyState({ title, description, action }: {
  title: string; description?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <h3 className="font-semibold text-surface-700 dark:text-surface-200 mb-1">{title}</h3>
      {description && <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 max-w-xs">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

// ── ConfirmDialog ────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void
  title: string; message?: string; danger?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      {message && <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">{message}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">Отмена</button>
        <button
          onClick={() => { onConfirm(); onClose() }}
          className={danger ? 'btn btn-danger' : 'btn-primary'}
        >
          Подтвердить
        </button>
      </div>
    </Modal>
  )
}

// ── FormField ────────────────────────────────────────────────────────
export function FormField({ label, error, children, required }: {
  label?: string; error?: string; children: ReactNode; required?: boolean
}) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="label">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      {children}
      {error && <p className="text-xs text-red-500 animate-fade-in">{error}</p>}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────
const AVATAR_BASE = import.meta.env.VITE_API_URL || ''
export function Avatar({ name, src, size = 32 }: { name?: string; src?: string; size?: number }) {
  // Если src указан и ещё не упал с onError — пытаемся показать картинку.
  // Если src отсутствует или картинка не загрузилась — показываем инициалы.
  const [failed, setFailed] = useState(false)
  // Сбрасываем флаг ошибки, если src сменился (например, юзер загрузил новый аватар).
  useEffect(() => { setFailed(false) }, [src])

  const initials = name
    ? name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    : '?'

  if (src && !failed) {
    // Бэкенд хранит только filename аватара (uuid.ext). Фронт может быть
    // на другом домене (Vercel) чем backend (Railway) — поэтому строим
    // полный URL через VITE_API_URL. Если src уже полный http(s) — берём
    // как есть.
    const url = src.startsWith('http') ? src : `${AVATAR_BASE}/uploads/avatars/${src}`
    return (
      <img
        src={url}
        alt={name}
        title={name}
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        className="rounded-full object-cover cursor-default shrink-0"
        // Если картинка 404 / битая — переключаемся на инициалы вместо пустого квадрата.
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center font-semibold shrink-0 select-none cursor-default"
    >
      {initials}
    </div>
  )
}

// ── Select ────────────────────────────────────────────────────────────
export function Select({ value, onChange, options, placeholder, className }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string; className?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={clsx('input', className)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── StatCard ─────────────────────────────────────────────────────────
/** Карточка метрики — без подпрыгивания при hover, без scale на иконке. */
export function StatCard({ title, value, icon: Icon, color, sub }: {
  title: string; value: string | number; icon: any; color: string; sub?: string
}) {
  return (
    <div className="card flex items-center gap-3 sm:gap-4 min-w-0">
      <div className={clsx(
        'w-9 h-9 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center shrink-0',
        color,
      )}>
        <Icon size={18} className="text-white sm:hidden" />
        <Icon size={20} className="text-white hidden sm:block" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] sm:text-xs uppercase tracking-wider text-surface-500 dark:text-surface-400 break-words">{title}</p>
        <p className="text-lg sm:text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] sm:text-xs leading-tight text-surface-400 dark:text-surface-500 mt-0.5 break-words">{sub}</p>}
      </div>
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────
export function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  // Три блока одновременно: первые 7, средние 5, последние 7 —
  // «1 2 3 4 5 6 7 … 15 16 17 18 19 … 26 27 28 29 30 31 32».
  // Средний блок центрируется на текущей странице, когда она в «дыре»
  // между блоками (иначе до неё нельзя дойти по номерам); в остальных
  // случаях — на середине диапазона. До 19 страниц — все подряд.
  const HEAD = 7, MID = 5, TAIL = 7
  const pages: (number | '...')[] = []
  if (totalPages <= HEAD + MID + TAIL) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    for (let i = 1; i <= HEAD; i++) pages.push(i)
    const gapStart = HEAD + 1
    const gapEnd = totalPages - TAIL
    let mStart = (page > HEAD && page <= gapEnd)
      ? page - Math.floor(MID / 2)
      : Math.round((gapStart + gapEnd) / 2) - Math.floor(MID / 2)
    mStart = Math.max(gapStart, Math.min(mStart, gapEnd - MID + 1))
    const mEnd = mStart + MID - 1
    if (mStart > gapStart) pages.push('...')
    for (let i = mStart; i <= mEnd; i++) pages.push(i)
    if (mEnd < gapEnd) pages.push('...')
    for (let i = totalPages - TAIL + 1; i <= totalPages; i++) pages.push(i)
  }

  return (
    <div className="flex items-center justify-center flex-wrap gap-1 pt-3">
      <button
        onClick={() => onChange(page - 1)} disabled={page <= 1}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-surface-500 dark:text-surface-400"
      ><ChevronLeft size={16} /></button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-sm text-surface-400 dark:text-surface-500">...</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={clsx(
              'w-8 h-8 flex items-center justify-center rounded-md text-sm font-medium transition-colors',
              p === page
                ? 'bg-primary-600 text-white'
                : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700',
            )}
          >{p}</button>
        )
      )}
      <button
        onClick={() => onChange(page + 1)} disabled={page >= totalPages}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-surface-500 dark:text-surface-400"
      ><ChevronRight size={16} /></button>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  // Анимируем рост от 0 → value при mount, чтобы каждый прогресс «вырастал»
  // плавно. Используем небольшой эффект задержки + shimmer-блик для оживления.
  const [animated, setAnimated] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(clamped))
    return () => cancelAnimationFrame(id)
  }, [clamped])
  return (
    <div className={clsx('w-full bg-surface-100 dark:bg-surface-700 rounded-full h-1.5 overflow-hidden', className)}>
      <div
        className="h-1.5 rounded-full bg-primary-600 transition-[width] ease-out"
        style={{
          width: `${animated}%`,
          transitionDuration: '600ms',
        }}
      />
    </div>
  )
}
