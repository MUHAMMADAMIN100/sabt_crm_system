import { useId, type ReactNode } from 'react'
import clsx from 'clsx'

/** Блок карточки лида: заголовок + необязательная кнопка справа (15.11.2026). */
export default function Section({ title, action, children, className }: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={clsx('border-t border-surface-200 px-4 py-4 dark:border-surface-700 sm:px-5', className)}>
      <div className="mb-2.5 flex min-h-[32px] items-center justify-between gap-2">
        <h3 id={id} className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Строка «подпись — значение» в блоках «Сделка» и «Контакты». */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-surface-500 dark:text-surface-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-surface-900 dark:text-surface-100">{children}</dd>
    </div>
  )
}

export function LinkButton({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-2 text-xs font-medium text-primary-700 hover:bg-surface-100 dark:text-primary-300 dark:hover:bg-surface-700 max-lg:min-h-[44px]">
      {children}
    </button>
  )
}
