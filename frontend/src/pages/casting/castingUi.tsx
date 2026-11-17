// Общие кусочки раздела «Кастинг» (17.11.2026): ключи запросов, права,
// миниатюра фото, окно «модалка на компьютере — полный экран на телефоне».
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { photoUrl } from '@/services/casting.api'
import { compressImage } from '@/lib/imageCompress'
import { canBookCasting, canEditCasting, canImportCasting, canSeeCasting } from '@/lib/permissions'

export const castingKeys = {
  /** Префикс всех списков (страница и поиск в съёмке). */
  lists: ['casting-talents'] as const,
  talent: (id: string) => ['casting-talent', id] as const,
  /** Префикс всех карточек — съёмки меняют их историю. */
  talents: ['casting-talent'] as const,
  shoot: (contentItemId: string) => ['casting-shoot', contentItemId] as const,
}

export function castingRights(user: { role?: string | null; secondaryRole?: string | null } | null | undefined) {
  const role = user?.role, second = user?.secondaryRole
  return {
    canSee: canSeeCasting(role, second),
    canEdit: canEditCasting(role, second),
    canImport: canImportCasting(role, second),
    canBook: canBookCasting(role, second),
  }
}

/** Текст ошибки сервера (class-validator отдаёт массив). */
export function errorText(e: any, fallback: string): string {
  const m = e?.response?.data?.message
  if (Array.isArray(m)) return m.filter(x => typeof x === 'string').join('. ') || fallback
  if (typeof m === 'string' && m) return m
  return fallback
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Фото для кастинга: сторона до 2048 px, ~1,6 МБ, JPEG — хватает на весь
 *  экран телефона без мыла (17.11.2026: было 1600 px / 700 КБ). Снимок с
 *  телефона весит 5–12 МБ и упёрся бы в лимит сервера (8 МБ). Не получилось
 *  сжать (редкий формат) — отправляем как есть, сервер сам скажет. */
export async function preparePhoto(file: File): Promise<File> {
  try {
    const { blob } = await compressImage(file, { maxSide: 2048, targetBytes: 1600 * 1024 })
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** Фото человека с запасным вариантом — инициалы, если фото нет или оно не грузится. */
export function TalentThumb({ path, name, size = 40, className }: {
  path: string | null | undefined; name: string; size?: number; className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [path])
  const url = photoUrl(path)
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
  const box = 'shrink-0 rounded-lg overflow-hidden bg-surface-200 dark:bg-surface-700'
  if (url && !failed) {
    return (
      <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}
        style={{ width: size, height: size }} className={clsx(box, 'object-cover', className)} />
    )
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={clsx(box, 'grid place-items-center font-semibold text-surface-500 dark:text-surface-300 select-none', className)}>
      {initials}
    </span>
  )
}

// Открытые окна по порядку: Escape закрывает только верхнее (форма поверх карточки).
const sheetStack: symbol[] = []

/** Окно раздела: по центру на компьютере, на весь экран на телефоне
 *  (до 600 px). Escape и крестик закрывают; прокрутка страницы под окном
 *  заперта. */
export function CastingSheet({ title, onClose, children, footer, headerExtra, size = 'md', label }: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Кнопки в шапке слева от крестика. */
  headerExtra?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  /** Подпись окна для экранного диктора, если заголовок не строка. */
  label?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const token = Symbol('sheet')
    sheetStack.push(token)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      try { panel.focus({ preventScroll: true }) } catch { /* ignore */ }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sheetStack[sheetStack.length - 1] !== token) return
      e.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = sheetStack.lastIndexOf(token)
      if (i >= 0) sheetStack.splice(i, 1)
      document.body.style.overflow = sheetStack.length ? 'hidden' : prevOverflow
      if (opener && opener.isConnected && opener !== document.body) {
        try { opener.focus({ preventScroll: true }) } catch { /* ignore */ }
      }
    }
  }, [])

  const width = size === 'xl' ? 'sm:max-w-4xl' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
  return createPortal(
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}
        aria-label={label || (typeof title === 'string' ? title : undefined)}
        className={clsx('relative w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col outline-none',
          'bg-surface-50 dark:bg-surface-800 sm:rounded-xl sm:border border-surface-200 dark:border-surface-700',
          'shadow-[0_12px_32px_-8px_rgba(15,15,18,0.25)]', width)}>
        <div className="flex items-center gap-2 pl-4 pr-2 sm:pl-5 pt-[max(8px,env(safe-area-inset-top))] sm:pt-2 pb-2 border-b border-surface-100 dark:border-surface-700 shrink-0 min-h-[60px] sm:min-h-[52px]">
          <div className="flex-1 min-w-0 text-base font-semibold text-surface-900 dark:text-surface-100 truncate">{title}</div>
          {headerExtra}
          <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть"
            className="w-11 h-11 sm:w-9 sm:h-9 grid place-items-center rounded-lg text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-surface-100 dark:border-surface-700 px-4 sm:px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Мелкая подпись секции. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1.5">{children}</p>
}
