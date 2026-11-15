import clsx from 'clsx'
import { stageMeta } from '@/lib/salesStages'

/** Бейдж этапа воронки (15.11.2026): цвет и подпись — из salesStages, чтобы
 *  «Встреча» выглядела одинаково на Панели, в Клиентах и в карточке.
 *  Устаревшие статусы показываются как этап, в который их перенесли. */
export default function StageBadge({ status, className }: { status: string; className?: string }) {
  const meta = stageMeta(status)
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4', meta.badge, className)}>
      {meta.label}
    </span>
  )
}
