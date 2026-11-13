import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Окно «Директа» поверх страницы: шаблоны, метки, горячие клавиши. Esc и
 * клик по затемнению закрывают; Esc не доходит до страницы (иначе закрылся
 * бы и чат). На телефоне — лист снизу во всю ширину.
 */
export default function DirectModal({ title, onClose, children, width = 520 }: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  useEffect(() => { panel.current?.focus() }, [])

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        style={{ maxWidth: width }}
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-modal outline-none dark:bg-surface-800 sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-surface-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
