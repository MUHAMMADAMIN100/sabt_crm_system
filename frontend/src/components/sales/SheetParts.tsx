import clsx from 'clsx'
import { useId, type ReactNode } from 'react'

/**
 * Детали шторок продаж (15.11.2026): крупный выбор «Результат / Да–Нет»
 * (52 px — попадать пальцем на ходу) и чипы итога. Это настоящие радио-
 * кнопки с role="radio": клавиатура и экранный диктор понимают выбор.
 */
export function BigChoice<T extends string>({ label, options, value, onChange }: {
  label: string
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  value: T | null
  onChange: (v: T) => void
}) {
  const id = useId()
  return (
    <div>
      <p className="label" id={id}>{label}</p>
      <div role="radiogroup" aria-labelledby={id} className={clsx('grid gap-2', options.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {options.map(o => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={clsx(
                'flex min-h-[52px] items-center justify-center gap-2 rounded-lg border px-2 text-sm font-semibold transition-colors',
                on
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-surface-300 bg-surface-50 text-surface-800 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100',
              )}
            >
              {o.icon}{o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ChoiceChips<T extends string>({ label, options, value, onChange }: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T | null
  onChange: (v: T | null) => void
}) {
  const id = useId()
  return (
    <div>
      <p className="label" id={id}>{label}</p>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map(o => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? null : o.value)}
              className={clsx(
                'min-h-[44px] rounded-full border px-3.5 text-sm font-medium transition-colors',
                on
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-surface-300 bg-surface-50 text-surface-700 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
