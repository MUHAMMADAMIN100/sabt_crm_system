// Шапка дня в кабинетах: кольцо «сделано из» и цифры сводки. Общие для
// панели СММ-специалиста и панели менеджера по продажам — шапки у них
// одинаковые (решение владельца 17.10.2026: «как у СММ, точь-в-точь»).
import clsx from 'clsx'

// ── Кольцо прогресса дня ──
export function Ring({ done, total, unit = 'задач' }: { done: number; total: number; unit?: string }) {
  const C = 2 * Math.PI * 15.5
  const pct = total > 0 ? Math.min(1, done / total) : 0
  const full = total > 0 && done >= total
  return (
    <svg viewBox="0 0 36 36" className="w-[68px] h-[68px] shrink-0" role="img" aria-label={`Сделано ${done} из ${total}`}>
      <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-surface-200 dark:text-surface-700" />
      {pct > 0 && (
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
          className={full ? 'text-green-500' : 'text-primary-500'}
          strokeDasharray={`${(C * pct).toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 18 18)" />
      )}
      <text x="18" y="17.8" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" className="text-surface-900 dark:text-surface-100">{done}/{total}</text>
      <text x="18" y="23.6" textAnchor="middle" fontSize="4.4" fill="currentColor" className="text-surface-400 dark:text-surface-500">{unit}</text>
    </svg>
  )
}

// ── Цифра сводки ──
export function Metric({ value, label, tone, bar }: { value: string; label: string; tone?: 'danger' | 'ok'; bar?: number }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-1.5 flex-1 min-w-[calc(50%-0.25rem)] sm:flex-none sm:min-w-[96px]',
      tone === 'danger' ? 'border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-900/10'
        : 'border-surface-100 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-800/50')}>
      <div className={clsx('text-[17px] font-extrabold tabular-nums leading-tight',
        tone === 'danger' ? 'text-red-500 dark:text-red-400'
          : tone === 'ok' ? 'text-green-600 dark:text-green-400'
          : 'text-surface-900 dark:text-surface-100')}>{value}</div>
      <div className="text-[10.5px] text-surface-400 dark:text-surface-500">{label}</div>
      {bar !== undefined && (
        <div className="h-1 rounded-full bg-surface-200 dark:bg-surface-700 mt-1 overflow-hidden">
          <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
