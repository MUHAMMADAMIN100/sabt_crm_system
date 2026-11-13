/** Цвета меток «Директа». Без красного и зелёного: в CRM они значат ошибку
 *  и «готово». Ключи совпадают с LABEL_COLORS на сервере (direct.dto.ts). */
export const LABEL_COLORS: { key: string; name: string; dot: string; chip: string }[] = [
  { key: 'sky', name: 'Голубой', dot: 'bg-sky-500', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  { key: 'violet', name: 'Фиолетовый', dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300' },
  { key: 'amber', name: 'Жёлтый', dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  { key: 'pink', name: 'Розовый', dot: 'bg-pink-500', chip: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300' },
  { key: 'teal', name: 'Бирюзовый', dot: 'bg-teal-500', chip: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300' },
  { key: 'orange', name: 'Оранжевый', dot: 'bg-orange-500', chip: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  { key: 'indigo', name: 'Синий', dot: 'bg-indigo-500', chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300' },
  { key: 'slate', name: 'Серый', dot: 'bg-slate-500', chip: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' },
]

const BY_KEY = new Map(LABEL_COLORS.map(c => [c.key, c]))

export const labelColor = (key: string | null | undefined) => BY_KEY.get(key || '') ?? LABEL_COLORS[0]
