import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { kpiApi } from '@/services/api.service'
import KpiDetailsModal from './KpiDetailsModal'
import {
  TrendingUp, Building2, Phone, Mail, Calendar,
  Target, Activity, Camera, Briefcase,
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'
import clsx from 'clsx'

/** Период для KPI-карточки. Совпадает по ключам с виджетом на дашборде. */
export type KpiPeriod = 'today' | 'week' | 'month' | 'prev_month'

export const KPI_PERIOD_LABELS: Record<KpiPeriod, string> = {
  today:      'Сегодня',
  week:       'Неделя',
  month:      'Месяц',
  prev_month: 'Прошлый месяц',
}

/** Конвертация периода в from/to (yyyy-MM-dd). Экспортируется чтобы родитель
 *  с одним общим переключателем периода мог сразу передавать from/to всем
 *  KPI-карточкам без копипасты этой логики. */
export function kpiPeriodRange(p: KpiPeriod): { from: string; to: string } {
  const now = new Date()
  if (p === 'today') {
    const d = format(now, 'yyyy-MM-dd')
    return { from: d, to: d }
  }
  if (p === 'week') {
    return {
      from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      to:   format(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    }
  }
  if (p === 'prev_month') {
    const prev = subMonths(now, 1)
    return {
      from: format(startOfMonth(prev), 'yyyy-MM-dd'),
      to:   format(endOfMonth(prev),   'yyyy-MM-dd'),
    }
  }
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to:   format(endOfMonth(now),   'yyyy-MM-dd'),
  }
}

/** Универсальная KPI-метрика. */
export interface KpiItem {
  key: string
  label: string
  target: number
  value: number
  percent: number
  done: boolean
}

export interface UserKpi {
  userId: string
  role: string
  periodFrom: string
  periodTo: string
  overallPercent: number
  items: KpiItem[]
}

/** Иконка для каждого ключа метрики. tasks_done и hours_logged выпилены
 *  в Wave 14 — оставлены fallback'ом на случай старых клиентов в очереди. */
const KEY_ICON: Record<string, any> = {
  deadline_rate: Target,
  activity_days: Activity,
  stories_posted: Camera,
  projects_managed: Briefcase,
  sales_funnel_progress: TrendingUp,
  sales_new_companies: Building2,
  sales_cold_calls: Phone,
  sales_personal_emails: Mail,
  sales_meetings: Calendar,
}

function colorByPercent(p: number): string {
  if (p >= 100) return 'text-emerald-500'
  if (p >= 70) return 'text-lime-500'
  if (p >= 40) return 'text-amber-500'
  return 'text-red-500'
}

function PercentRing({ percent, size = 56 }: { percent: number; size?: number }) {
  const stroke = 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          className="stroke-surface-200 dark:stroke-surface-700" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          className={clsx('transition-[stroke-dashoffset]', colorByPercent(percent))}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} stroke="currentColor" />
      </svg>
      <div className={clsx(
        'absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums',
        colorByPercent(percent),
      )}>
        {percent}%
      </div>
    </div>
  )
}

/** Форматирование значения для чипа — десятичные у часов, % у дедлайн-метрики. */
function formatValue(item: KpiItem): string {
  if (item.key === 'deadline_rate') return `${item.value}%`
  if (item.key === 'hours_logged') return `${item.value}ч`
  return String(item.value)
}

interface Props {
  /** ID юзера. */
  userId: string
  /** Компактный режим — для карточек / виджета дашборда. */
  compact?: boolean
  /** Внешний период (если родитель управляет фильтром). */
  period?: KpiPeriod
  /** Прямой from/to (если нужно вручную, минуя enum). Имеет приоритет над `period`. */
  from?: string
  to?: string
  /** Показать ли встроенный переключатель периода (только для full mode). */
  showPeriodSelector?: boolean
  /** Предзагруженный KPI — позволяет переиспользовать карточку для bulk-данных. */
  kpi?: UserKpi | null
}

/**
 * Reusable KPI-карточка любого сотрудника (Wave 13/14).
 *  - compact: PercentRing + чипы каждой метрики value/target.
 *  - full: PercentRing 72px + прогресс-бары для каждой метрики.
 *  - showPeriodSelector в full mode добавляет встроенный chip-переключатель.
 */
export default function EmployeeKpiCard({
  userId, compact, period: externalPeriod, from, to,
  showPeriodSelector, kpi: preloadedKpi,
}: Props) {
  // Внутренний state переключателя — используется когда родитель не передал
  // ни period, ни from/to, но запросил showPeriodSelector.
  const [internalPeriod, setInternalPeriod] = useState<KpiPeriod>('month')

  // Resolve final from/to: from/to > externalPeriod > internalPeriod (если selector)
  let effectiveFrom = from
  let effectiveTo = to
  if (!effectiveFrom && !effectiveTo) {
    const range = kpiPeriodRange(externalPeriod ?? internalPeriod)
    effectiveFrom = range.from
    effectiveTo = range.to
  }

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-user', userId, effectiveFrom, effectiveTo],
    queryFn: () => kpiApi.user(userId, { from: effectiveFrom, to: effectiveTo }),
    enabled: !!userId && !preloadedKpi,
    staleTime: 30_000,
  })

  // Стейт открытой модалки с детализацией метрики.
  const [openedMetric, setOpenedMetric] = useState<KpiItem | null>(null)

  const kpi: UserKpi | null = preloadedKpi ?? data
  if (!preloadedKpi && isLoading) {
    return <div className="text-xs text-surface-400 animate-pulse">Загрузка KPI…</div>
  }
  if (!kpi) return null

  const detailsModal = openedMetric && (
    <KpiDetailsModal
      open
      onClose={() => setOpenedMetric(null)}
      userId={userId}
      metric={openedMetric.key}
      metricLabel={openedMetric.label}
      from={effectiveFrom}
      to={effectiveTo}
    />
  )

  if (compact) {
    return (
      <>
        <div className="flex items-center gap-3 flex-wrap">
          <PercentRing percent={kpi.overallPercent} size={48} />
          <div className="flex flex-wrap gap-1.5">
            {kpi.items.map(it => {
              const Icon = KEY_ICON[it.key] || TrendingUp
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpenedMetric(it) }}
                  title={`${it.label}: ${formatValue(it)} / ${it.target}${it.key === 'deadline_rate' ? '%' : ''} (${it.percent}%) — кликни для подробностей`}
                  className={clsx(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer',
                    it.done
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50'
                      : it.percent >= 50
                        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50'
                        : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600',
                  )}
                >
                  <Icon size={11} />
                  <span className="tabular-nums">{formatValue(it)}/{it.target}{it.key === 'deadline_rate' ? '%' : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
        {detailsModal}
      </>
    )
  }

  // Full mode
  // Активный период для подсветки в selector'е (если selector внутренний).
  const activePeriod = externalPeriod ?? internalPeriod
  return (
    <>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <PercentRing percent={kpi.overallPercent} size={72} />
          <div>
            <p className="text-sm font-semibold text-surface-700 dark:text-surface-200">
              Выполнение KPI за период
            </p>
            <p className="text-xs text-surface-400 dark:text-surface-500">
              {new Date(kpi.periodFrom).toLocaleDateString('ru-RU')}{' — '}
              {new Date(kpi.periodTo).toLocaleDateString('ru-RU')}
            </p>
          </div>
        </div>
        {showPeriodSelector && (
          <div className="flex gap-1">
            {(['today', 'week', 'month', 'prev_month'] as KpiPeriod[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setInternalPeriod(p)}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  activePeriod === p
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
                )}
              >
                {KPI_PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        {kpi.items.map(it => {
          const Icon = KEY_ICON[it.key] || TrendingUp
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setOpenedMetric(it)}
              title="Кликни чтобы посмотреть подробности"
              className="w-full text-left space-y-1 p-1 -mx-1 rounded-md hover:bg-surface-50 dark:hover:bg-surface-700/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-surface-700 dark:text-surface-200">
                  <Icon size={13} className={colorByPercent(it.percent)} />
                  {it.label}
                </span>
                <span className="tabular-nums text-surface-500 dark:text-surface-400">
                  <b className={clsx('font-bold', colorByPercent(it.percent))}>{formatValue(it)}</b>
                  {' / '}{it.target}{it.key === 'deadline_rate' ? '%' : ''}
                  <span className="ml-2 text-[10px]">({it.percent}%)</span>
                </span>
              </div>
              <div className="h-1.5 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full transition-[width] duration-300',
                    it.done
                      ? 'bg-emerald-500'
                      : it.percent >= 70 ? 'bg-lime-500'
                      : it.percent >= 40 ? 'bg-amber-500'
                      : 'bg-red-500',
                  )}
                  style={{ width: `${Math.min(100, it.percent)}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>
    </div>
    {detailsModal}
    </>
  )
}
