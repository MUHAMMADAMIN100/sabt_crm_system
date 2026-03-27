import { useEffect, ReactNode } from 'react'
import { X } from 'lucide-react'
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
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative bg-white dark:bg-surface-800 rounded-2xl shadow-modal w-full animate-fade-in', sizes[size])}>
        {title && (
          <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{title}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400">
              <X size={18} />
            </button>
          </div>
        )}
        {!title && (
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 z-10">
            <X size={18} />
          </button>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
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
  done: 'Готово', cancelled: 'Отменена',
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
  return (
    <svg
      className={clsx('animate-spin text-primary-600', className)}
      style={{ width: size, height: size }}
      fill="none" viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  )
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={32} />
    </div>
  )
}

// ── EmptyState ───────────────────────────────────────────────────────
export function EmptyState({ title, description, action }: {
  title: string; description?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mb-4">
        <span className="text-2xl">📭</span>
      </div>
      <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{title}</h3>
      {description && <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 max-w-xs">{description}</p>}
      {action}
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
      {error && <p className="text-xs text-red-500">{error}</p>}
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
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center font-semibold shrink-0"
    >
      {name?.[0]?.toUpperCase() || '?'}
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

// ── Stat card ─────────────────────────────────────────────────────────
export function StatCard({ title, value, icon: Icon, color, sub }: {
  title: string; value: string | number; icon: any; color: string; sub?: string
}) {
  return (
    <div className="card flex items-center gap-4">
      <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', color)}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-surface-500 dark:text-surface-400">{title}</p>
        <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
        {sub && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('w-full bg-surface-100 dark:bg-surface-700 rounded-full h-2', className)}>
      <div
        className="bg-primary-600 h-2 rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
