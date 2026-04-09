import { useEffect, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

// ── Modal ──────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
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

  if (!mounted) return null

  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* Backdrop */}
      <div
        className={clsx(
          'absolute inset-0 bg-black/40 transition-opacity duration-200',
          '-webkit-backdrop-filter: blur(4px)',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={clsx(
          'relative bg-white dark:bg-surface-800 shadow-modal w-full',
          'rounded-t-2xl sm:rounded-2xl',
          'max-h-[90vh] sm:max-h-[85vh] flex flex-col',
          'transition-all duration-300 ease-out',
          sizes[size],
          visible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 sm:scale-95 translate-y-8 sm:translate-y-5',
        )}
        style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        {title && (
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-surface-100 dark:border-surface-700 shrink-0">
            <h2 className="text-base sm:text-lg font-semibold text-surface-900 dark:text-surface-100">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 transition-all duration-150 hover:rotate-90"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {!title && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 z-10 transition-all duration-150 hover:rotate-90"
          >
            <X size={18} />
          </button>
        )}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>{children}</div>
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

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая', in_progress: 'В работе', review: 'На проверке',
  returned: 'Возвращено', done: 'Готово', cancelled: 'Отменена',
  planning: 'Планируется', completed: 'Завершён', archived: 'Архив', on_hold: 'Пауза',
  active: 'Активный', inactive: 'Неактивный',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status}>{STATUS_LABELS[status] || status}</Badge>
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
export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-20 h-20 rounded-2xl animate-pulse flex items-center justify-center relative shadow-lg
                      bg-white dark:bg-primary-600">
        <span className="text-[52px] font-black leading-none select-none text-primary-600 dark:text-white"
              style={{ fontFamily: 'Arial Black, sans-serif' }}>S</span>
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
export function EmptyState({ title, description, action }: {
  title: string; description?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-up">
      <div className="w-16 h-16 rounded-2xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mb-4 animate-bounce-soft">
        <span className="text-2xl">📭</span>
      </div>
      <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{title}</h3>
      {description && <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 max-w-xs">{description}</p>}
      {action && <div className="animate-fade-up delay-150">{action}</div>}
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
export function Avatar({ name, src, size = 32 }: { name?: string; src?: string; size?: number }) {
  if (src) {
    return (
      <img
        src={src.startsWith('http') ? src : `/uploads/avatars/${src}`}
        alt={name}
        title={name}
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        className="rounded-full object-cover cursor-default"
      />
    )
  }
  const initials = name
    ? name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    : '?'
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
export function StatCard({ title, value, icon: Icon, color, sub }: {
  title: string; value: string | number; icon: any; color: string; sub?: string
}) {
  return (
    <div className="card flex items-center gap-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
      <div className={clsx(
        'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110',
        color,
      )}>
        <Icon size={22} className="text-white" />
      </div>
      <div className="animate-count-up">
        <p className="text-sm text-surface-500 dark:text-surface-400">{title}</p>
        <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">{value}</p>
        {sub && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{sub}</p>}
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
  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <button
        onClick={() => onChange(page - 1)} disabled={page <= 1}
        className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      ><ChevronLeft size={16} /></button>
      <span className="text-sm text-surface-600 dark:text-surface-300">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)} disabled={page >= totalPages}
        className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      ><ChevronRight size={16} /></button>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className={clsx('w-full bg-surface-100 dark:bg-surface-700 rounded-full h-2 overflow-hidden', className)}>
      <div
        className="bg-primary-600 h-2 rounded-full transition-all duration-700 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
