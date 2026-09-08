import { CalendarRange, Film, Image as ImageIcon } from 'lucide-react'

/** Карточка SMM-проекта — общий вид для сетки «Проекты» и для схемы нагрузки. */
export type SmmCard = {
  id: string; name: string; color: string
  day: number | null; reels: number; posts: number; norm: number; left: number
}

// Единый контейнер карточки (рамка/фон/паддинг) — чтобы в сетке и в схеме
// карточки выглядели одинаково.
export const CARD_CLS = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition'

/** Внутренность карточки (без внешнего контейнера) — цвет-точка, имя, норма/остаток,
 *  бейджи цикла и норм рилсов/постов. */
export function SmmProjectCardBox({ c }: { c: SmmCard }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
        <span className="text-[15px] font-bold truncate">{c.name}</span>
        <span className="ml-auto text-[12px] font-bold tabular-nums shrink-0" style={{ color: c.color }}>
          {c.norm > 0 ? `${c.norm}/${c.left}` : '—'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg"
          style={c.day ? { background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color } : { background: 'rgba(128,128,128,0.12)', color: 'rgb(156,163,175)' }}>
          <CalendarRange size={13} /> {c.day ? `цикл с ${c.day}-го` : 'цикл не задан'}
        </span>
        {c.norm > 0 && <>
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg" style={{ background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color }}><Film size={13} /> {c.reels}</span>
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg" style={{ background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color }}><ImageIcon size={13} /> {c.posts}</span>
        </>}
      </div>
    </>
  )
}
