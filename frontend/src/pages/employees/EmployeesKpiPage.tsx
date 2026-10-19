// «Сотрудники → KPI» (макет владельца 19.10.2026, вариант Б): рейтинг
// списком — сверху лучшие, сразу видно, кто отстаёт. Раньше KPI стоял на
// каждой карточке списка сотрудников; теперь здесь, с тем же периодом
// «Сегодня / Неделя / Месяц / Прошлый месяц». Подробности — в карточке
// сотрудника по клику.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { employeesApi, kpiApi } from '@/services/api.service'
import { Avatar, PageLoader, EmptyState } from '@/components/ui'
import { KPI_PERIOD_LABELS, kpiPeriodRange, type KpiPeriod } from '@/components/kpi/EmployeeKpiCard'

type Row = { userId: string; empId: string | null; name: string; position: string; avatar?: string; percent: number | null }

const tone = (p: number) => (p >= 80 ? 'green' : p >= 50 ? 'amber' : 'red')
const BAR: Record<string, string> = { green: 'bg-green-500', amber: 'bg-amber-400', red: 'bg-red-500' }
const TEXT: Record<string, string> = {
  green: 'text-green-600 dark:text-green-400',
  amber: 'text-amber-500 dark:text-amber-400',
  red: 'text-red-500 dark:text-red-400',
}

export default function EmployeesKpiPage() {
  const [period, setPeriod] = useState<KpiPeriod>('month')
  const range = kpiPeriodRange(period)
  const { data: kpi, isLoading } = useQuery({
    queryKey: ['kpi-all', range.from, range.to],
    queryFn: () => kpiApi.all(range),
  })
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  const rows = useMemo<Row[]>(() => {
    const byUser = new Map<string, any>(((employees as any[]) || []).filter(e => e.userId).map(e => [e.userId, e]))
    const list: Row[] = ((kpi as any[]) || []).map(k => {
      const e = byUser.get(k.userId)
      return {
        userId: k.userId,
        empId: e?.id || null,
        name: e?.fullName || e?.user?.name || 'Сотрудник',
        position: e?.position || '',
        avatar: e?.avatar || undefined,
        percent: k.noData ? null : Number(k.overallPercent) || 0,
      }
    })
    // Сверху лучшие; без оценки за период — в конце, по имени.
    return list.sort((a, b) =>
      (a.percent === null ? 1 : 0) - (b.percent === null ? 1 : 0)
      || (b.percent ?? 0) - (a.percent ?? 0)
      || a.name.localeCompare(b.name, 'ru'))
  }, [kpi, employees])

  const rated = rows.filter(r => r.percent !== null) as Array<Row & { percent: number }>
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.percent, 0) / rated.length) : null
  const full = rated.filter(r => r.percent >= 100).length
  const low = rated.filter(r => r.percent < 50).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-auto">KPI сотрудников</h1>
        <div className="flex flex-wrap gap-1.5">
          {(['today', 'week', 'month', 'prev_month'] as KpiPeriod[]).map(p => (
            <button key={p} type="button" onClick={() => setPeriod(p)}
              className={clsx('h-9 lg:h-[30px] px-3 rounded-lg text-[12.5px] font-semibold transition-colors',
                period === p ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700/70 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700')}>
              {KPI_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <PageLoader /> : !rows.length ? <EmptyState title="KPI пока не считается ни у кого" /> : (
        <>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
            <div className="card !px-4 !py-3">
              <div className="text-xl sm:text-[22px] font-extrabold tabular-nums text-surface-900 dark:text-surface-100">{avg === null ? '—' : `${avg} %`}</div>
              <div className="text-xs text-surface-400 dark:text-surface-500">средний KPI команды</div>
            </div>
            <div className="card !px-4 !py-3 !border-green-500/35">
              <div className="text-xl sm:text-[22px] font-extrabold tabular-nums text-green-600 dark:text-green-400">{full}</div>
              <div className="text-xs text-surface-400 dark:text-surface-500">выполнили план (100 %)</div>
            </div>
            <div className="card !px-4 !py-3 !border-red-500/35">
              <div className="text-xl sm:text-[22px] font-extrabold tabular-nums text-red-500 dark:text-red-400">{low}</div>
              <div className="text-xs text-surface-400 dark:text-surface-500">ниже 50 %</div>
            </div>
          </div>

          <section className="card !p-0 overflow-hidden">
            <div className="hidden lg:grid grid-cols-[44px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_64px] gap-4 px-[18px] py-2.5 text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">
              <span className="text-center">#</span><span>Сотрудник</span><span>Должность</span><span>Выполнение</span><span className="text-right">KPI</span>
            </div>
            {rows.map((r, i) => {
              const t = r.percent === null ? null : tone(r.percent)
              const body = (
                <>
                  <span className={clsx('text-[13px] font-bold text-center tabular-nums', i === 0 && t ? 'text-amber-500 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500')}>
                    {r.percent === null ? '—' : i + 1}
                  </span>
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={r.name} src={r.avatar} size={32} />
                    <span className="flex flex-col min-w-0">
                      <b className={clsx('text-sm font-semibold truncate', r.percent === null ? 'text-surface-500 dark:text-surface-400' : 'text-surface-900 dark:text-surface-100')}>{r.name}</b>
                      <span className="lg:hidden text-xs text-surface-400 dark:text-surface-500 truncate">{r.position}</span>
                    </span>
                  </span>
                  <span className="hidden lg:block text-sm text-surface-500 dark:text-surface-400 truncate">{r.position}</span>
                  {t ? (
                    <div className="col-span-3 lg:col-span-1 order-last lg:order-none h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                      <div className={clsx('h-full rounded-full', BAR[t])} style={{ width: `${Math.min(100, r.percent!)}%` }} />
                    </div>
                  ) : (
                    <span className="hidden lg:block text-[12.5px] text-surface-400 dark:text-surface-500">за период оценки нет</span>
                  )}
                  <b className={clsx('text-right text-sm font-bold tabular-nums', t ? TEXT[t] : 'text-surface-400 dark:text-surface-500')}>
                    {r.percent === null ? '—' : `${r.percent} %`}
                  </b>
                </>
              )
              const cls = 'grid grid-cols-[32px_minmax(0,1fr)_56px] lg:grid-cols-[44px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_64px] items-center gap-x-4 gap-y-2 px-4 lg:px-[18px] py-3 lg:py-2.5 border-t border-surface-100 dark:border-surface-700/60'
              return r.empId
                ? <Link key={r.userId} to={`/employees/${r.empId}`} className={clsx(cls, 'hover:bg-surface-100/60 dark:hover:bg-surface-700/40 transition-colors')}>{body}</Link>
                : <div key={r.userId} className={cls}>{body}</div>
            })}
          </section>
        </>
      )}
    </div>
  )
}
