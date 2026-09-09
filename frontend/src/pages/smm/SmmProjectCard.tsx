import { CalendarRange, Film, Image as ImageIcon } from 'lucide-react'

/** Карточка SMM-проекта — общий вид для сетки «Проекты» и для схемы нагрузки. */
export type SmmCard = {
  id: string; name: string; color: string
  day: number | null; reels: number; posts: number; norm: number; left: number
  // Успеваемость по плану (опубликовано рилсов+постов / норма цикла), 0–100 или
  // null, если норма контента не задана. Мирроит «Выполнение плана» проекта.
  pct: number | null
}

// Порог цвета успеваемости: ≥80 зелёный, ≥50 жёлтый, иначе красный.
export function pctTextCls(pct: number): string {
  if (pct >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-500 dark:text-red-400'
}
function pctBarCls(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

// Компактная мини-карточка (для схемы нагрузки): имя + % успеваемости, мелкая
// мета (цикл · рилсы/посты) и тонкая полоска прогресса.
export const MINI_CLS = 'rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/50 px-3 py-2.5'

export function SmmProjectMiniBox({ c }: { c: SmmCard }) {
  const meta = [
    c.day ? `цикл с ${c.day}-го` : 'цикл не задан',
    c.norm > 0 ? `${c.reels} рилс · ${c.posts} пост` : '',
  ].filter(Boolean).join(' · ')
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
        <span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100 truncate flex-1">{c.name}</span>
        {c.pct != null
          ? <span className={'text-[12px] font-extrabold tabular-nums shrink-0 ' + pctTextCls(c.pct)}>{c.pct}%</span>
          : <span className="text-[11px] font-semibold text-gray-400 shrink-0">—</span>}
      </div>
      <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1 truncate">{meta}</div>
      {c.pct != null && (
        <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-1.5">
          <div className={'h-full rounded-full ' + pctBarCls(c.pct)} style={{ width: `${c.pct}%` }} />
        </div>
      )}
    </>
  )
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
