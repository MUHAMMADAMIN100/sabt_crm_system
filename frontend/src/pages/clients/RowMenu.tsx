import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'

export interface RowMenuItem { label: string; onSelect: () => void; danger?: boolean }

/**
 * Меню «⋯» строки списка (15.11.2026): через портал с фиксированной
 * позицией — таблица прокручивается вбок, и меню внутри неё обрезалось бы
 * краем. Закрывается по Escape, щелчку мимо и прокрутке; стрелки ходят
 * по пунктам.
 */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = !!pos

  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); btnRef.current?.focus() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
        const i = els.indexOf(document.activeElement as HTMLElement)
        const n = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length
        els[n]?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (open) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 lg:h-9 lg:w-9"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ position: 'fixed', top: Math.min(pos.top, window.innerHeight - 8 - 48 * items.length), right: pos.right }}
          className="z-[46] min-w-[180px] rounded-lg border border-surface-200 bg-surface-50 py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800"
        >
          {items.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setPos(null); it.onSelect() }}
              className={clsx(
                'flex min-h-[44px] w-full items-center px-3 text-left text-sm hover:bg-surface-100 focus:bg-surface-100 focus:outline-none dark:hover:bg-surface-700 dark:focus:bg-surface-700',
                it.danger ? 'text-red-600 dark:text-red-300' : 'text-surface-800 dark:text-surface-100',
              )}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
