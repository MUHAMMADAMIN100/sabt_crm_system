import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { apiUrl } from '@/services/direct.api'

/** Фото собеседника из Instagram; нет фото или не загрузилось — инициалы. */
export default function ContactAvatar({ label, picture, size = 40, className }: {
  label: string; picture: string | null; size?: number; className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [picture])
  const src = apiUrl(picture)
  const initials = label.replace(/^@/, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
  return (
    <span
      className={clsx('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-200 font-semibold select-none', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {src && !failed
        ? <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        : initials}
    </span>
  )
}
