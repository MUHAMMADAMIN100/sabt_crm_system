// Общие мелочи раздела «Продажи» (15.11.2026): переключатель-сегменты и
// карточка ошибки загрузки с «Повторить».
import clsx from 'clsx'
import { AlertCircle, RefreshCw } from 'lucide-react'

/** Сегменты (Месяц / Квартал / Год и т. п.): кнопки с aria-pressed. */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label}
      className="inline-flex max-w-full overflow-x-auto hide-scrollbar rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-0.5">
      {options.map(o => {
        const active = o.value === value
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
            className={clsx('shrink-0 min-h-[44px] lg:min-h-[32px] px-3 rounded-md text-[13px] font-semibold transition-colors',
              active
                ? 'bg-white dark:bg-surface-600 text-surface-900 dark:text-white shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Карточка «не загрузилось» с повтором. */
export function ErrorCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="card flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-surface-700 dark:text-surface-200">{text} Проверьте связь и попробуйте ещё раз.</p>
      </div>
      <button type="button" onClick={onRetry} className="btn-secondary min-h-[44px] lg:min-h-[36px] shrink-0">
        <RefreshCw size={15} aria-hidden="true" /> Повторить
      </button>
    </div>
  )
}
