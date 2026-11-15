// «План продаж · месяц» менеджера по продажам. Сумму на месяц ставит
// основатель на странице «Сотрудники → План продаж», «получено» — оплаты
// клиентов менеджера по «Финансам».
//
// 15.11.2026 (Продажи, этап 2): карточка видна и на компьютере — она стоит в
// правой колонке «Сегодня» (макет «Роль менеджера продаж»), а не только в
// профиле на телефоне. Это собственный план менеджера, а не зарплата, поэтому
// правило «деньги только на телефоне» на неё больше не распространяется.
// Добавлены строка комиссии (если основатель её задал) и «История» за
// 6 прошлых месяцев (SALES_SPEC §6).
import { useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import { salesPlanApi, type SalesPlanHistoryRow } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { hasAnyRole } from '@/lib/permissions'
import { paceTone } from '@/pages/employees/SalesPlanPage'
import { plural } from './ProfileStats'

const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev']
const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const sum = (n: number) => Math.round(n).toLocaleString('ru-RU')
const monthOf = (ym: string) => MONTH[Number(ym.slice(5, 7)) - 1] || ''

/** Рабочих дней до конца месяца, включая сегодняшний: пн–сб, как считает KPI
 *  (воскресенье — выходной). Отпуск и табель здесь не учитываем. */
export function workdaysLeft(ym: string, day: number, daysInMonth: number): number {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1
  let n = 0
  for (let d = Math.max(1, day); d <= daysInMonth; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() !== 0) n++
  return n
}

/** Процент комиссии: «5», «2,5». */
const pctText = (p: number) => (Math.round(p * 10) / 10).toLocaleString('ru-RU')

export default function SalesPlanCard({ className, alwaysShow }: {
  className?: string
  /** Показывать и без плана (с подсказкой), и пока грузится — для «Сегодня»,
   *  где у карточки своё место в колонке. В профиле без плана её нет. */
  alwaysShow?: boolean
}) {
  const user = useAuthStore(s => s.user)
  const sales = hasAnyRole(user?.role, user?.secondaryRole, SALES_ROLES)
  const uid = useId()
  const [historyOpen, setHistoryOpen] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['me', 'sales-plan'], queryFn: salesPlanApi.mine, enabled: sales, staleTime: 5 * 60_000,
  })
  if (!sales) return null

  const shell = (children: ReactNode) => (
    <section className={clsx('card !px-4 !py-3.5 flex flex-col gap-2.5', className)} aria-labelledby={`${uid}-title`}>
      {children}
    </section>
  )
  const heading = (ym: string | null, badge?: ReactNode) => (
    <div className="flex items-center gap-2">
      <h2 id={`${uid}-title`} className="text-[15px] font-bold text-surface-900 dark:text-surface-100">
        План продаж{ym ? ` · ${monthOf(ym)}` : ''}
      </h2>
      {badge}
    </div>
  )

  if (!data) {
    if (!alwaysShow) return null
    if (isLoading) return shell(<>
      {heading(null)}
      <span className="skeleton block h-7 w-40" />
      <span className="skeleton block h-[9px] w-full" />
      <span className="skeleton block h-3.5 w-48" />
    </>)
    if (isError) return shell(<>
      {heading(null)}
      <p className="text-[13px] text-surface-600 dark:text-surface-300">Нет данных о плане</p>
      <button type="button" onClick={() => refetch()} className="btn-secondary self-start max-sm:min-h-[44px]">
        <RotateCcw size={14} /> Повторить
      </button>
    </>)
    return null
  }

  const commissionLine = data.commissionPercent != null && (
    <p className="text-[13px] text-surface-600 dark:text-surface-300">
      Комиссия {pctText(data.commissionPercent)}%
      {data.commissionAmount != null && <> · <b className="font-semibold text-surface-900 dark:text-surface-100 tabular-nums">{sum(data.commissionAmount)} с.</b></>}
    </p>
  )
  const history = Array.isArray(data.history) ? data.history : []
  const historyBlock = history.length > 0 && (
    <div className="border-t border-surface-200 dark:border-surface-700 pt-1.5">
      <button type="button" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen} aria-controls={`${uid}-history`}
        className="w-full flex items-center gap-2 rounded-lg py-1.5 max-sm:min-h-[44px] text-[13px] font-semibold text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-white">
        История · {history.length} {plural(history.length, 'месяц', 'месяца', 'месяцев')}
        <ChevronDown size={15} className={clsx('ml-auto text-surface-400 transition-transform', historyOpen && 'rotate-180')} />
      </button>
      {historyOpen && <HistoryList id={`${uid}-history`} rows={history} />}
    </div>
  )

  // Плана на месяц нет: в профиле карточки нет, на «Сегодня» — подсказка.
  if (!('received' in data) || !data.plan) {
    if (!alwaysShow) return null
    return shell(<>
      {heading(data.ym)}
      <p className="text-[13px] text-surface-600 dark:text-surface-300">
        План на {monthOf(data.ym)} ещё не поставлен — его ставит основатель.
      </p>
      {commissionLine}
      {historyBlock}
    </>)
  }

  const pct = Math.round((data.received / data.plan) * 100)
  const ok = paceTone(pct, data.day / data.daysInMonth) === 'ok'
  const left = Math.max(0, data.plan - data.received)
  const wd = workdaysLeft(data.ym, data.day, data.daysInMonth)
  return shell(<>
    {heading(data.ym,
      <span className={clsx('ml-auto text-[12.5px] font-bold rounded-[7px] px-2 py-0.5 tabular-nums',
        ok ? 'text-green-700 dark:text-green-300 bg-green-500/15' : 'text-amber-700 dark:text-amber-300 bg-amber-500/15')}>{pct}%</span>,
    )}
    <div className="flex items-baseline gap-1.5">
      <b className="text-[26px] leading-none font-extrabold tabular-nums text-surface-900 dark:text-surface-100">{sum(data.received)}</b>
      <span className="text-[15px] text-surface-500 dark:text-surface-400 tabular-nums">/ {sum(data.plan)} с.</span>
    </div>
    <div className="h-[9px] rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden" role="progressbar"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} aria-label="Выполнение плана">
      <div className={clsx('h-full rounded-full', ok ? 'bg-green-500' : 'bg-amber-400')} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
    <p className="text-[13px] text-surface-600 dark:text-surface-300">
      {left > 0
        ? <><b className="font-semibold text-surface-900 dark:text-surface-100 tabular-nums">{sum(left)} с.</b> до плана</>
        : <span className="font-semibold text-green-600 dark:text-green-400">План выполнен</span>}
      {' · '}
      {wd > 0 ? `${wd} ${plural(wd, 'рабочий день', 'рабочих дня', 'рабочих дней')}` : 'рабочих дней не осталось'}
    </p>
    {commissionLine}
    <span className="text-xs text-surface-500 dark:text-surface-400">оплаты ваших клиентов по «Финансам»</span>
    {historyBlock}
  </>)
}

/** «История»: месяц, получено из плана, процент. Свежий месяц сверху. */
function HistoryList({ id, rows }: { id: string; rows: SalesPlanHistoryRow[] }) {
  const sorted = [...rows].sort((a, b) => b.ym.localeCompare(a.ym))
  const thisYear = String(new Date().getFullYear())
  return (
    <ul id={id} className="mt-1 space-y-2">
      {sorted.map(r => {
        const pct = r.plan ? Math.round((r.received / r.plan) * 100) : null
        return (
          <li key={r.ym} className="text-[12.5px]">
            <div className="flex items-baseline gap-2">
              <span className="text-surface-700 dark:text-surface-200 first-letter:uppercase">
                {monthOf(r.ym)}{r.ym.slice(0, 4) !== thisYear ? ` ${r.ym.slice(0, 4)}` : ''}
              </span>
              <span className="ml-auto tabular-nums text-surface-600 dark:text-surface-300">
                {sum(r.received)}{r.plan ? ` / ${sum(r.plan)}` : ''} с.
              </span>
              <span className={clsx('min-w-[44px] text-right tabular-nums font-semibold',
                pct == null ? 'text-surface-500 dark:text-surface-400'
                  : pct >= 100 ? 'text-green-600 dark:text-green-400' : 'text-surface-700 dark:text-surface-200')}>
                {pct == null ? 'без плана' : `${pct}%`}
              </span>
            </div>
            {pct != null && (
              <div className="mt-1 h-1 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                <div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-green-500' : 'bg-primary-500')} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
