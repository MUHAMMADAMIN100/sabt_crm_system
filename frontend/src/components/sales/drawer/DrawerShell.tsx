import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsDesktop } from '../salesHooks'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Оболочка карточки лида (15.11.2026, макет «Карточка лида»):
 * - компьютер (от 993 px) — панель справа 560 px без затемнения: список и
 *   доска остаются видны и кликабельны, другой лид открывается в той же
 *   панели;
 * - телефон — шторка снизу с затемнением (модальная, Tab не уходит под неё).
 * Через портал в body: обёртка страницы анимируется transform'ом, и
 * position:fixed внутри неё считался бы от обёртки, а не от экрана.
 * Escape закрывает карточку, только если поверх не открыто другое окно.
 */
export default function DrawerShell({ open, onClose, labelledBy, children }: {
  open: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
}) {
  const desktop = useIsDesktop()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const panel = panelRef.current
      const others = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter(el => el !== panel)
      if (others.length) return
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Фокус в карточку при открытии и обратно туда, откуда открыли, — при
  // закрытии (клавиатура и экранный диктор не теряют место в списке).
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(raf)
      if (opener && opener !== document.body && opener.isConnected) {
        try { opener.focus({ preventScroll: true }) } catch { /* ignore */ }
      }
    }
  }, [open])

  // Шторка на телефоне модальная: Tab ходит по кругу внутри неё.
  useEffect(() => {
    if (!open || desktop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel || document.querySelector('[aria-modal="true"]:not([data-lead-drawer])')) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, desktop])

  if (!open) return null

  const panelCls = 'flex flex-col bg-surface-50 text-surface-900 outline-none dark:bg-surface-800 dark:text-surface-100'

  return createPortal(
    desktop ? (
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-lead-drawer=""
        className={`${panelCls} fixed inset-y-0 right-0 z-[45] w-[560px] max-w-full animate-slide-in-right border-l border-surface-200 shadow-[-12px_0_32px_-12px_rgba(0,0,0,0.35)] dark:border-surface-700`}
      >
        {children}
      </div>
    ) : (
      <div className="fixed inset-0 z-[45] flex items-end">
        <div className="absolute inset-0 animate-backdrop-in bg-black/50" onClick={onClose} aria-hidden="true" />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          data-lead-drawer=""
          className={`${panelCls} relative max-h-[92vh] w-full animate-fade-up rounded-t-2xl border-t border-surface-200 dark:border-surface-700`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-surface-300 dark:bg-surface-600" aria-hidden="true" />
          {children}
        </div>
      </div>
    ),
    document.body,
  )
}
