// Короткая сводка заявки от продаж (15.11.2026) — в окнах создания проекта
// SMM и разработки, когда проект создаётся по заявке: что продали, кто
// передал, когда первая оплата и что проект свяжется с лидом.
import { Link as LinkIcon } from 'lucide-react'
import type { Handoff } from '@/types/sales'
import { dayLabel, handoffAmount } from './salesFormat'

export default function HandoffSummary({ handoff }: { handoff: Handoff }) {
  const rows: Array<[string, string]> = [
    ['Продукт', handoff.product || '—'],
    ['Сумма', handoffAmount(handoff.amount, handoff.direction)],
    ['Первая оплата', dayLabel(handoff.firstPaymentAt)],
  ]
  if (handoff.manager?.name) rows.push(['Менеджер', handoff.manager.name])
  return (
    <section aria-label="Заявка от продаж"
      className="rounded-xl border border-primary-200 dark:border-primary-800/60 bg-primary-50/60 dark:bg-primary-900/15 px-3.5 py-3 text-[13px]">
      <p className="flex items-center gap-1.5 font-semibold text-surface-900 dark:text-surface-100">
        <LinkIcon size={14} className="text-primary-600 dark:text-primary-300 shrink-0" aria-hidden="true" />
        Заявка от продаж: {handoff.leadName}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-surface-500 dark:text-surface-400">{k}</dt>
            <dd className="text-surface-800 dark:text-surface-200 tabular-nums break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12px] text-surface-500 dark:text-surface-400">
        Контакты клиента из заявки сохранятся в проекте, а проект свяжется с лидом.
      </p>
    </section>
  )
}
