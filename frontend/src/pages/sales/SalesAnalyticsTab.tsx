// «Продажи → Аналитика» (15.11.2026, макет «Аналитика продаж»): период
// (месяц / квартал / год по Душанбе) и направление; плитки «Получено»,
// «Выиграно сделок», «Цикл сделки», «Ждём оплат»; воронка «сколько лидов
// дошло до этапа», причины проигрыша, таблицы по менеджерам и источникам.
// Данные — GET /sales/analytics (docs/SALES_SPEC.md §5). Проценты конверсии
// считаем здесь из количеств — одинаково для плиток, воронки и таблиц.
import { useMemo, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { salesApi } from '@/services/sales.api'
import { salesKeys } from '@/lib/salesQueries'
import { lostReasonLabel, stageMeta } from '@/lib/salesStages'
import { getRoleLabel } from '@/lib/permissions'
import { useUrlState } from '@/lib/urlState'
import { EmptyState, Skeleton } from '@/components/ui'
import type { SalesAnalytics } from '@/types/sales'
import {
  SALES_PERIODS, dushanbeDay, money, percentOf, periodRange, plural, type SalesPeriod,
} from './salesFormat'
import { ErrorCard, Segmented } from './salesUi'

type DirectionFilter = 'all' | 'smm' | 'development'
const DIRECTIONS: readonly DirectionFilter[] = ['all', 'smm', 'development']

const PERIOD_OPTIONS: Array<{ value: SalesPeriod; label: string }> = [
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
]
const DIRECTION_OPTIONS: Array<{ value: DirectionFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'smm', label: 'SMM' },
  { value: 'development', label: 'Разработка' },
]

/** KPI менеджера: ≥100 — норма, ≥70 — близко, иначе — отстаёт. */
function kpiTone(p: number): string {
  if (p >= 100) return 'text-green-600 dark:text-green-400'
  if (p >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export default function SalesAnalyticsTab() {
  const [period, setPeriod] = useUrlState<SalesPeriod>('period', 'month', SALES_PERIODS)
  const [direction, setDirection] = useUrlState<DirectionFilter>('dir', 'all', DIRECTIONS)
  const today = dushanbeDay()
  const range = useMemo(() => periodRange(period, today), [period, today])
  const params = useMemo(() => ({
    from: range.from,
    to: range.to,
    ...(direction !== 'all' ? { direction } : {}),
  }), [range, direction])

  const q = useQuery({
    queryKey: salesKeys.analytics(params),
    queryFn: () => salesApi.analytics(params),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Период" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        <Segmented label="Направление" options={DIRECTION_OPTIONS} value={direction} onChange={setDirection} />
        {q.isFetching && q.data && <span className="text-xs text-surface-400" role="status">Обновляем…</span>}
      </div>

      {q.isPending ? <AnalyticsSkeleton />
        : q.isError && !q.data ? <ErrorCard text="Не удалось загрузить аналитику продаж." onRetry={() => q.refetch()} />
        : q.data ? <AnalyticsBody data={q.data} />
        : null}
    </div>
  )
}

function AnalyticsBody({ data }: { data: SalesAnalytics }) {
  const t = data.totals
  const empty = !t.leads && !t.won && !data.byManager.length && !data.funnel.some(f => f.count > 0)
  const planPct = t.plan != null && t.plan > 0 && t.received != null ? percentOf(t.received, t.plan) : null

  return (
    <div className="space-y-4">
      <div className={clsx('grid grid-cols-1 xs:grid-cols-2 gap-3', t.expected != null ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        <Tile label="Получено" value={money(t.received)}
          sub={planPct != null && t.plan != null ? `${planPct} % от плана ${money(t.plan)}` : null} />
        <Tile label="Выиграно сделок" value={String(t.won)}
          sub={`из ${t.leads} ${plural(t.leads, 'нового лида', 'новых лидов', 'новых лидов')} · ${percentOf(t.won, t.leads)} %`} />
        <Tile label="Цикл сделки"
          value={t.cycleDaysMedian != null ? `${Math.round(t.cycleDaysMedian)} ${plural(Math.round(t.cycleDaysMedian), 'день', 'дня', 'дней')}` : '—'}
          sub="медиана: от создания лида до выигрыша" />
        {t.expected != null && <Tile label="Ждём оплат" value={money(t.expected)} sub="по выигранным сделкам" />}
      </div>

      {empty ? (
        <div className="card">
          <EmptyState title="За этот период данных нет" description="Новых лидов и сделок в выбранном периоде не было. Выберите другой период или направление." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Воронка: сколько лидов дошло до этапа">
              <Funnel rows={data.funnel} />
            </Section>
            <Section title="Почему проигрываем">
              <LostReasons rows={data.lostReasons} />
            </Section>
          </div>
          <Section title="По менеджерам">
            <ManagersTable rows={data.byManager} />
          </Section>
          <Section title="По источникам">
            <SourcesTable rows={data.bySource} />
          </Section>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="card flex flex-col gap-1 min-w-0">
      <span className="text-[13px] text-surface-500 dark:text-surface-400">{label}</span>
      <b className="text-xl sm:text-2xl font-bold tabular-nums text-surface-900 dark:text-surface-50 truncate">{value}</b>
      {sub && <span className="text-xs text-surface-500 dark:text-surface-400 tabular-nums">{sub}</span>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card min-w-0" aria-label={title}>
      <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100 mb-3">{title}</h2>
      {children}
    </section>
  )
}

/** Горизонтальные полосы в масштабе первого этапа. */
function Funnel({ rows }: { rows: SalesAnalytics['funnel'] }) {
  if (!rows.length) return <Muted>Лидов в периоде нет.</Muted>
  const base = rows[0]?.count || 0
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => {
        const meta = stageMeta(r.status)
        const prev = i > 0 ? rows[i - 1].count : null
        const width = base > 0 ? Math.max(r.count > 0 ? 2 : 0, Math.min(100, (r.count / base) * 100)) : 0
        return (
          <li key={r.status} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-medium text-surface-800 dark:text-surface-200">{meta.label}</span>
              <span className="tabular-nums text-surface-500 dark:text-surface-400">
                <b className="text-surface-900 dark:text-surface-100">{r.count}</b>
                {prev != null && <span> · {percentOf(r.count, prev)} % от предыдущего</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-100 dark:bg-surface-700/60 overflow-hidden" aria-hidden="true">
              <div className={clsx('h-full rounded-full', meta.bar)} style={{ width: `${width}%` }} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function LostReasons({ rows }: { rows: SalesAnalytics['lostReasons'] }) {
  const list = [...rows].filter(r => r.count > 0).sort((a, b) => b.count - a.count)
  if (!list.length) return <Muted>Проигранных сделок в периоде нет.</Muted>
  const max = list[0].count
  const total = list.reduce((s, r) => s + r.count, 0)
  return (
    <ul className="space-y-2.5">
      {list.map(r => (
        <li key={r.reason} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-medium text-surface-800 dark:text-surface-200">{lostReasonLabel(r.reason)}</span>
            <span className="tabular-nums text-surface-500 dark:text-surface-400">
              <b className="text-surface-900 dark:text-surface-100">{r.count}</b> · {percentOf(r.count, total)} %
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-100 dark:bg-surface-700/60 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-red-400" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const th = 'px-3 py-2 text-left whitespace-nowrap'
const thNum = 'px-3 py-2 text-right whitespace-nowrap'
const td = 'px-3 py-2.5 border-t border-surface-100 dark:border-surface-700/60'
const tdNum = `${td} text-right tabular-nums whitespace-nowrap`

function ManagersTable({ rows }: { rows: SalesAnalytics['byManager'] }) {
  if (!rows.length) return <Muted>Менеджеров с лидами в периоде нет.</Muted>
  return (
    <div className="overflow-x-auto -mx-3 sm:-mx-4">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Менеджер</th>
            <th scope="col" className={thNum}>Лиды</th>
            <th scope="col" className={thNum}>Встречи (состоялись)</th>
            <th scope="col" className={thNum}>Выиграно</th>
            <th scope="col" className={thNum}>Получено / план</th>
            <th scope="col" className={thNum}>KPI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.userId}>
              <th scope="row" className={clsx(td, 'text-left font-normal')}>
                <span className="block font-medium text-surface-900 dark:text-surface-100">{r.name}</span>
                <span className="block text-xs text-surface-500 dark:text-surface-400">{getRoleLabel(r.role)}</span>
              </th>
              <td className={tdNum}>{r.leads}</td>
              <td className={tdNum}>{r.meetingsHeld}</td>
              <td className={tdNum}>{r.won}</td>
              <td className={tdNum}>
                <span className="text-surface-900 dark:text-surface-100">{money(r.received)}</span>
                <span className="text-surface-400"> / {r.plan != null && r.plan > 0 ? money(r.plan) : 'нет плана'}</span>
              </td>
              <td className={clsx(tdNum, 'font-semibold', r.kpiPercent != null ? kpiTone(r.kpiPercent) : 'text-surface-400')}>
                {r.kpiPercent != null ? `${Math.round(r.kpiPercent)} %` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourcesTable({ rows }: { rows: SalesAnalytics['bySource'] }) {
  if (!rows.length) return <Muted>Источников в периоде нет.</Muted>
  const list = [...rows].sort((a, b) => b.leads - a.leads)
  return (
    <div className="overflow-x-auto -mx-3 sm:-mx-4">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Источник</th>
            <th scope="col" className={thNum}>Лиды</th>
            <th scope="col" className={thNum}>Выиграно</th>
            <th scope="col" className={thNum}>Конверсия</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={`${r.source}-${i}`}>
              <th scope="row" className={clsx(td, 'text-left font-medium text-surface-900 dark:text-surface-100')}>
                {r.source?.trim() || 'Не указан'}
              </th>
              <td className={tdNum}>{r.leads}</td>
              <td className={tdNum}>{r.won}</td>
              <td className={tdNum}>{percentOf(r.won, r.leads)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-surface-500 dark:text-surface-400 py-2">{children}</p>
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Загрузка аналитики">
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="card space-y-3">
            <Skeleton className="h-4 w-1/2" />
            {['w-full', 'w-4/5', 'w-3/5', 'w-2/5', 'w-1/5'].map(w => <Skeleton key={w} className={clsx('h-2.5', w)} />)}
          </div>
        ))}
      </div>
      <div className="card space-y-2">
        <Skeleton className="h-4 w-1/3" />
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    </div>
  )
}
