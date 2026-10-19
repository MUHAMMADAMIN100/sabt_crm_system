// «Продажи за месяц» в профиле менеджера по продажам — только на телефоне,
// как зарплата (решение владельца 19.10.2026). Сумму на месяц ставит
// основатель на странице «Сотрудники», «получено» — оплаты клиентов
// менеджера по «Финансам». Без плана окошко не показываем.
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { salesPlanApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { paceTone } from '@/pages/employees/SalesPlanBox'
import { plural } from './ProfileStats'

const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev']
const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const sum = (n: number) => Math.round(n).toLocaleString('ru-RU')

export default function SalesPlanCard({ className }: { className?: string }) {
  const user = useAuthStore(s => s.user)
  const sales = [user?.role, (user as any)?.secondaryRole].some(r => !!r && SALES_ROLES.includes(r))
  const { data } = useQuery({ queryKey: ['me', 'sales-plan'], queryFn: salesPlanApi.mine, enabled: sales, staleTime: 5 * 60_000 })
  if (!data || !('received' in data) || !data.plan) return null

  const pct = Math.round((data.received / data.plan) * 100)
  const ok = paceTone(pct, data.day / data.daysInMonth) === 'ok'
  const left = Math.max(0, data.plan - data.received)
  return (
    <section className={clsx('card !px-4 !py-3.5 flex flex-col gap-2.5', className)}>
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-surface-900 dark:text-surface-100">Продажи · {MONTH[Number(data.ym.slice(5, 7)) - 1]}</h2>
        <span className={clsx('ml-auto text-[12.5px] font-bold rounded-[7px] px-2 py-0.5',
          ok ? 'text-green-600 dark:text-green-400 bg-green-500/15' : 'text-amber-600 dark:text-amber-400 bg-amber-500/15')}>{pct} %</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <b className="text-[26px] font-extrabold tabular-nums text-surface-900 dark:text-surface-100">{sum(data.received)}</b>
        <span className="text-[15px] text-surface-400 dark:text-surface-500 tabular-nums">/ {sum(data.plan)} с.</span>
      </div>
      <div className="h-[9px] rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
        <div className={clsx('h-full rounded-full', ok ? 'bg-green-500' : 'bg-amber-400')} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="flex text-[12.5px]">
        {left > 0
          ? <span className="text-surface-600 dark:text-surface-300"><b className="text-surface-900 dark:text-surface-100">{sum(left)} с.</b> до плана</span>
          : <span className="font-semibold text-green-600 dark:text-green-400">план выполнен</span>}
        <span className="ml-auto text-surface-400 dark:text-surface-500">
          {data.daysLeft > 0 ? `${data.daysLeft} ${plural(data.daysLeft, 'день', 'дня', 'дней')} до конца месяца` : 'последний день месяца'}
        </span>
      </div>
      <span className="text-xs text-surface-400 dark:text-surface-500">оплаты ваших клиентов</span>
    </section>
  )
}
