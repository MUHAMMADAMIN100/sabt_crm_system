import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Plus, Minus } from 'lucide-react'
import clsx from 'clsx'

/**
 * Свёрнутое по умолчанию поле формы. Заголовок (label) + кнопка
 * +/− справа. Контент рендерится только когда раскрыто, но значение
 * из children (если оно управляется через react-hook-form Controller
 * или useState родителя) сохраняется — мы не размонтируем содержимое
 * при сворачивании, чтобы submit формы получил все значения.
 *
 * Используется во всех формах добавления/редактирования (Задачи,
 * Клиенты, Проекты, Финансы и т.п.), чтобы умещать форму на 1 экран
 * без вертикального скролла.
 */
export function CollapsibleField({
  label, hint, children, defaultOpen = false, badge, className,
}: {
  label: string
  /** Подсказка справа от label маленьким серым (например «(заполнено)»). */
  hint?: string
  /** Маленький бейдж справа от label (число подзадач, число файлов и т.п.). */
  badge?: string | number
  children: ReactNode
  /** Принудительно раскрыть. По умолчанию закрыт. */
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Если родитель сменил defaultOpen (например, после загрузки initial
  // данных) — раскрываемся автоматически.
  const prev = useRef(defaultOpen)
  useEffect(() => {
    if (defaultOpen && !prev.current) setOpen(true)
    prev.current = defaultOpen
  }, [defaultOpen])

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'w-full flex items-center gap-2 text-left -mx-1 px-1 py-1 rounded-md transition-colors',
          'hover:bg-surface-50 dark:hover:bg-surface-700/30',
        )}
      >
        <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{label}</span>
        {badge !== undefined && badge !== '' && badge !== 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
            {badge}
          </span>
        )}
        {hint && !open && (
          <span className="text-xs text-surface-400 truncate flex-1 min-w-0">{hint}</span>
        )}
        <span className={clsx(
          'ml-auto inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors',
          open
            ? 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300'
            : 'text-surface-400 hover:text-primary-600',
        )}>
          {open ? <Minus size={12} /> : <Plus size={12} />}
        </span>
      </button>
      {/* Не размонтируем при сворачивании — Controller'ы внутри сохраняют
          значения. CSS-скрытие через hidden чтобы не ломать формы. */}
      <div className={clsx('mt-1.5', !open && 'hidden')}>
        {children}
      </div>
    </div>
  )
}
