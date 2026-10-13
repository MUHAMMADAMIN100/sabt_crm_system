// «Оплаты клиентов» на панели менеджера по продажам (решение владельца
// 12.10.2026, вариант А): по каким SMM-проектам и когда клиент должен
// заплатить. Только проекты, где менеджер ответственный, и только проект,
// день и состояние — сумм здесь нет. Сроки приходят из «Финансов»: оплату
// записывает владелец, менеджер ничего не отмечает.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import { smmPaymentsApi, type ClientPayItem } from '@/services/api.service'

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5)
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}
const longDay = (iso: string) => format(new Date(`${iso}T00:00:00`), 'd MMMM', { locale: ru })

/** Состояние оплаты словами: «просрочено 3 дня», «сегодня», «через 2 дня»,
 *  «оплачено 10 октября». Общее для панели и карточки проекта. */
export function payStateText(it: Pick<ClientPayItem, 'state' | 'date' | 'paidAt'>, today: string): string {
  if (it.state === 'paid') return `оплачено ${longDay(it.paidAt || it.date)}`
  if (it.state === 'today') return 'сегодня'
  const n = Math.abs(dayDiff(it.date, today))
  if (it.state === 'late') return `просрочено ${n} ${plural(n, 'день', 'дня', 'дней')}`
  return n === 1 ? 'завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}`
}

const TILE: Record<ClientPayItem['state'], string> = {
  late: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  today: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  wait: 'bg-surface-100 text-surface-800 dark:bg-surface-700/60 dark:text-surface-100',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
}
const STATE: Record<ClientPayItem['state'], string> = {
  late: 'font-semibold text-red-600 dark:text-red-300',
  today: 'font-semibold text-amber-700 dark:text-amber-400',
  wait: 'text-surface-500 dark:text-surface-400',
  paid: 'font-semibold text-emerald-600 dark:text-emerald-400',
}

export default function ClientPayments() {
  const { data } = useQuery({ queryKey: ['smm-payments-mine'], queryFn: smmPaymentsApi.mine, staleTime: 60_000 })
  // Нет своих SMM-проектов — блок менеджеру не нужен.
  if (!data || !data.projects) return null
  const { items, unlinked, today } = data

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-[15px] font-bold">Оплаты клиентов</h3>
        <span className="text-xs text-surface-500 dark:text-surface-400">
          мои SMM-проекты · {data.projects}
        </span>
        <span className="ml-auto text-xs text-surface-500 dark:text-surface-400">сегодня {longDay(today)}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-[13px] text-surface-500 dark:text-surface-400">Ближайших оплат нет</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(it => (
            <Link key={it.key} to={`/smm/projects/${it.projectId}`}
              className={clsx('flex-1 basis-[300px] min-w-0 flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                it.state === 'late'
                  ? 'bg-red-50/60 dark:bg-red-900/15 border-red-200 dark:border-red-800/70 hover:border-red-300 dark:hover:border-red-700'
                  : 'bg-surface-50 dark:bg-surface-900/40 border-surface-100 dark:border-surface-700/60 hover:border-surface-300 dark:hover:border-surface-600')}>
              <span className={clsx('w-12 h-[52px] rounded-lg shrink-0 flex flex-col items-center justify-center gap-[3px]', TILE[it.state])}>
                <b className="text-[19px] font-bold leading-none tabular-nums">{Number(it.date.slice(8, 10))}</b>
                <span className="text-[10px] font-semibold uppercase leading-none">{MON[Number(it.date.slice(5, 7)) - 1]}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-semibold truncate text-surface-900 dark:text-surface-100">{it.projectName}</span>
                  {it.partNo === 2 && <span className="text-[11.5px] text-surface-400 dark:text-surface-500 shrink-0">2-я часть</span>}
                </span>
                <span className={clsx('mt-0.5 flex items-center gap-1 text-[12.5px]', STATE[it.state])}>
                  {it.state === 'paid' && <Check size={13} strokeWidth={3} className="shrink-0" />}
                  {payStateText(it, today)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {unlinked.length > 0 && (
        <p className="text-xs text-surface-500 dark:text-surface-400">
          Срок оплаты не найден в «Финансах»: {unlinked.map(u => u.projectName).join(', ')}
        </p>
      )}
    </div>
  )
}
