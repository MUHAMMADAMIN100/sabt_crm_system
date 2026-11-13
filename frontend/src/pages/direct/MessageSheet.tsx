import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Copy, CornerUpLeft, Heart, Trash2 } from 'lucide-react'
import type { DirectMessage } from '@/services/direct.api'
import { quoteOf } from './Composer'
import { clockTime } from './directTime'

/**
 * Меню долгого нажатия на телефоне, как в Instagram: фон затемняется,
 * сообщение остаётся на своём месте, над ним ❤️, под ним действия.
 * Instagram даёт через API только ❤️ — других реакций нет.
 */
export default function MessageSheet({ m, rect, canHeart, canQuote, canDelete, onHeart, onReply, onCopy, onDelete, onClose }: {
  m: DirectMessage
  rect: DOMRect
  canHeart: boolean
  canQuote: boolean
  canDelete: boolean
  onHeart: () => void
  onReply: () => void
  onCopy: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const mine = m.direction === 'out'
  const items: { key: string; label: string; icon: ReactNode; run: () => void; danger?: boolean }[] = []
  if (canQuote) items.push({ key: 'reply', label: 'Ответить', icon: <CornerUpLeft size={18} />, run: onReply })
  if (m.text) items.push({ key: 'copy', label: 'Копировать', icon: <Copy size={18} />, run: onCopy })
  if (canDelete) items.push({ key: 'delete', label: 'Удалить заметку', icon: <Trash2 size={18} />, run: onDelete, danger: true })

  // Сообщение — там, где было; всё вместе не выходит за экран.
  const vh = window.innerHeight
  const bubbleH = Math.min(rect.height, 260)
  const heartH = canHeart ? 60 : 0
  const menuH = items.length ? items.length * 48 + 12 : 0
  let top = rect.top - heartH
  top = Math.min(top, vh - 12 - heartH - bubbleH - menuH)
  top = Math.max(12, top)
  const side = mine ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/55 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Действия с сообщением"
      onClick={onClose}>
      <div className={clsx('absolute flex max-w-[86vw] flex-col gap-2', mine ? 'items-end' : 'items-start')} style={{ top, ...side }}
        onClick={e => e.stopPropagation()}>
        {canHeart && (
          <button type="button" onClick={() => { onHeart(); onClose() }}
            className="flex h-12 items-center gap-2 rounded-full bg-white px-4 text-[15px] font-medium text-surface-800 shadow-modal dark:bg-surface-800 dark:text-surface-100"
            aria-label={m.ourReaction ? 'Убрать ❤️' : 'Поставить ❤️'}>
            <Heart size={22} className="text-pink-600" fill={m.ourReaction ? 'currentColor' : 'none'} />
            {m.ourReaction ? 'Убрать' : ''}
          </button>
        )}
        <div className={clsx('max-h-[260px] overflow-hidden rounded-[20px] px-3.5 py-2 text-[15px] leading-snug shadow-modal',
          mine ? 'bg-primary-600 text-white' : 'bg-surface-100 text-surface-900 dark:bg-surface-700 dark:text-surface-50')}
          style={{ maxWidth: Math.max(rect.width, 120) }}>
          <p className="line-clamp-[9] whitespace-pre-wrap break-words">{m.text || quoteOf(m)}</p>
          <p className={clsx('mt-1 text-right text-[11px]', mine ? 'text-white/70' : 'text-surface-400')}>{clockTime(m.sentAt)}</p>
        </div>
        {items.length > 0 && (
          <div className="w-56 overflow-hidden rounded-2xl bg-white py-1.5 shadow-modal dark:bg-surface-800" role="menu">
            {items.map(i => (
              <button key={i.key} type="button" role="menuitem" onClick={() => { i.run(); onClose() }}
                className={clsx('flex h-12 w-full items-center justify-between px-4 text-[15px]',
                  i.danger ? 'text-red-600 dark:text-red-400' : 'text-surface-900 dark:text-surface-100', 'active:bg-surface-100 dark:active:bg-surface-700')}>
                {i.label}
                {i.icon}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
