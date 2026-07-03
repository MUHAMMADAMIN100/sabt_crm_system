import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import clsx from 'clsx'
import { monthLabel, shiftYm } from './financeUtils'

/* ------------------------------------------------------------------ *
 * Общий UI-набор для страниц раздела «Финансы».
 * Один словарь примитивов на все страницы — чтобы не расходились
 * стили карточек, бейджей, переключателей месяца и таблиц.
 * Идиома CRM: классы card / btn-primary / input / label, токены surface / primary,
 * tabular-nums для чисел, тёмная тема через dark:.
 * ------------------------------------------------------------------ */

/** Переключатель одного месяца: ‹ Июль 2026 › */
export function MonthNav({ ym, onChange }: { ym: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-1 py-0.5">
      <button onClick={() => onChange(shiftYm(ym, -1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500" title="Предыдущий месяц">
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm font-medium px-2 min-w-[110px] text-center">{monthLabel(ym)}</span>
      <button onClick={() => onChange(shiftYm(ym, 1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500" title="Следующий месяц">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/** Переключатель окна из 6 месяцев (матрицы Dev/Design/Долги): ‹ Июнь 2026 – Ноя 2026 › */
export function MonthRangeNav({ start, onChange, span = 6 }: { start: string; onChange: (v: string) => void; span?: number }) {
  const end = shiftYm(start, span - 1)
  return (
    <div className="flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-1 py-0.5">
      <button onClick={() => onChange(shiftYm(start, -1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500" title="Раньше">
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm font-medium px-2 min-w-[190px] text-center">{monthLabel(start)} – {monthLabel(end)}</span>
      <button onClick={() => onChange(shiftYm(start, 1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500" title="Позже">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/** Карточка-показатель: подпись, значение, необязательная сноска. tone красит значение. */
export function Stat({
  label, value, tone = 'default', sub, icon, onClick,
}: {
  label: ReactNode; value: ReactNode; tone?: 'default' | 'pos' | 'neg' | 'muted'
  sub?: ReactNode; icon?: ReactNode; onClick?: () => void
}) {
  const toneCls =
    tone === 'pos' ? 'text-green-600 dark:text-green-400'
    : tone === 'neg' ? 'text-red-600 dark:text-red-400'
    : tone === 'muted' ? 'text-surface-500 dark:text-surface-400'
    : 'text-surface-800 dark:text-surface-100'
  return (
    <div className={clsx('card', onClick && 'cursor-pointer hover:border-primary-300 dark:hover:border-primary-800 transition-colors')} onClick={onClick}>
      <p className="text-xs text-surface-400 flex items-center gap-1.5">{icon}{label}</p>
      <p className={clsx('text-2xl font-bold mt-1 tabular-nums', toneCls)}>{value}</p>
      {sub != null && <p className="text-[11px] text-surface-400 mt-2">{sub}</p>}
    </div>
  )
}

type BadgeTone = 'ok' | 'wait' | 'transfer' | 'neutral' | 'danger'
const BADGE_CLS: Record<BadgeTone, string> = {
  ok: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  wait: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  transfer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  neutral: 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

/** Статус-бейдж. tone='ok' + check выводит галочку. */
export function Badge({
  tone = 'neutral', check, children, onClick, title, className,
}: {
  tone?: BadgeTone; check?: boolean; children: ReactNode
  onClick?: () => void; title?: string; className?: string
}) {
  return (
    <span
      onClick={onClick}
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap',
        BADGE_CLS[tone], onClick && 'cursor-pointer', className,
      )}
    >
      {check && <Check size={12} />}{children}
    </span>
  )
}

/** Прогресс-бар (матрицы проектов, долги). pct 0..100. */
export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color || 'var(--tw-primary, #0ea5e9)' }} />
    </div>
  )
}

/** Мелкий заголовок секции. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={clsx('text-xs font-semibold text-surface-400 uppercase tracking-wide', className)}>{children}</h3>
}

/** Пустое состояние: иконка + текст. */
export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-10 text-center text-surface-400">
      {icon && <div className="mx-auto mb-2 opacity-40 flex justify-center">{icon}</div>}
      <p className="text-sm">{children}</p>
    </div>
  )
}

/** Полоса-напоминание (например, цикл оплаты SMM). tone красит фон/границу. */
export function AlertBar({ tone = 'amber', children }: { tone?: 'amber' | 'blue'; children: ReactNode }) {
  const cls = tone === 'blue'
    ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
    : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
  return (
    <div className={clsx('card flex items-center gap-3 !py-2.5 !px-3.5 text-sm', cls)}>
      {children}
    </div>
  )
}

/** Ячейка-комментарий с сохранением по потере фокуса (Enter — тоже). */
export function CellInput({
  value, onCommit, placeholder = '—', className,
}: {
  value?: string; onCommit: (v: string) => void; placeholder?: string; className?: string
}) {
  const [v, setV] = useState(value ?? '')
  const commit = () => { const t = v.trim(); if (t !== (value ?? '')) onCommit(t) }
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder={placeholder}
      className={clsx('w-full bg-transparent text-sm px-1.5 py-1 rounded border border-transparent hover:border-surface-200 focus:border-primary-400 dark:hover:border-surface-700 focus:outline-none', className)}
    />
  )
}

/** Обёртка широкой таблицы с горизонтальным скроллом (матрицы). */
export function TableCard({ children, scroll = false, className }: { children: ReactNode; scroll?: boolean; className?: string }) {
  return (
    <div className={clsx('card !p-0 overflow-hidden', className)}>
      <div className={clsx(scroll && 'overflow-x-auto')}>{children}</div>
    </div>
  )
}

/** Кнопка «назад» к списку направлений/статей. */
export function BackLink({ to, label, onClick }: { to?: string; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-primary-600 mb-1">
      <ChevronLeft size={15} /> {label}
    </button>
  )
}
