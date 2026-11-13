import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { apiUrl } from '@/services/direct.api'

export interface LightboxItem {
  id: string
  url: string
  video: boolean
  /** «Клиент · 14:05» */
  caption: string
}

/**
 * Фото и видео переписки на весь экран: стрелки и ←/→ листают, Esc закрывает,
 * на телефоне — свайп влево/вправо. «Открыть оригинал» — в новой вкладке.
 */
export default function Lightbox({ items, index, onIndex, onClose }: {
  items: LightboxItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const item = items[index]
  const touch = useRef<{ x: number; y: number } | null>(null)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < items.length - 1 && onIndex(index + 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // Список поменялся (сообщение удалили) — не выходим за край.
  useEffect(() => {
    if (!items.length) onClose()
    else if (index > items.length - 1) onIndex(items.length - 1)
  }, [items.length, index, onClose, onIndex])

  if (!item) return null
  const src = apiUrl(item.url) || ''

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Просмотр фото"
      onTouchStart={e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
      onTouchEnd={e => {
        const start = touch.current
        touch.current = null
        if (!start) return
        const dx = e.changedTouches[0].clientX - start.x
        const dy = e.changedTouches[0].clientY - start.y
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else prev() }
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose()
      }}>
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-white/80">
        <span className="min-w-0 flex-1 truncate">{item.caption}</span>
        {items.length > 1 && <span className="tabular-nums text-white/60">{index + 1} / {items.length}</span>}
        <a href={src} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 hover:bg-white/10" title="Открыть оригинал" aria-label="Открыть оригинал">
          <ExternalLink size={18} />
        </a>
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        {item.video
          ? <video key={item.id} src={src} controls autoPlay className="max-h-full max-w-full rounded-lg" />
          : <img key={item.id} src={src} alt="" className="max-h-full max-w-full select-none rounded-lg object-contain" draggable={false} />}
        {index > 0 && (
          <button type="button" onClick={prev} className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:block" aria-label="Предыдущее">
            <ChevronLeft size={22} />
          </button>
        )}
        {index < items.length - 1 && (
          <button type="button" onClick={next} className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:block" aria-label="Следующее">
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
