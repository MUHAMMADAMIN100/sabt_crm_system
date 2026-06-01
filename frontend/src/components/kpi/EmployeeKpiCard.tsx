import { useQuery } from '@tanstack/react-query'
import { kpiApi } from '@/services/api.service'
import {
  TrendingUp, Building2, Phone, Mail, Calendar,
  CheckSquare, Clock, Target, Activity, Camera, Briefcase,
} from 'lucide-react'
import clsx from 'clsx'

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

/** Иконка для каждого ключа метрики — универсальные + sales-префикс. */
const KEY_ICON: Record<string, any> = {
  tasks_done: CheckSquare,
  hours_logged: Clock,
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
  /** Период (опционально, по умолчанию — текущий месяц). */
  from?: string
  to?: string
  /** Предзагруженный KPI — позволяет переиспользовать карточку для bulk-данных. */
  kpi?: UserKpi | null
}

/**
 * Reusable KPI-карточка любого сотрудника (Wave 13).
 *  - compact: PercentRing + чипы каждой метрики value/target.
 *  - full: PercentRing 72px + прогресс-бары для каждой метрики.
 */
export default function EmployeeKpiCard({
  userId, compact, from, to, kpi: preloadedKpi,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['kpi-user', userId, from, to],
    queryFn: () => kpiApi.user(userId, { from, to }),
    enabled: !!userId && !preloadedKpi,
    staleTime: 30_000,
  })

  const kpi: UserKpi | null = preloadedKpi ?? data
  if (!preloadedKpi && isLoading) {
    return <div className="text-xs text-surface-400 animate-pulse">Загрузка KPI…</div>
  }
  if (!kpi) return null

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <PercentRing percent={kpi.overallPercent} size={48} />
        <div className="flex flex-wrap gap-1.5">
          {kpi.items.map(it => {
            const Icon = KEY_ICON[it.key] || TrendingUp
            return (
              <div
                key={it.key}
                title={`${it.label}: ${formatValue(it)} / ${it.target}${it.key === 'deadline_rate' ? '%' : ''} (${it.percent}%)`}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium',
                  it.done
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : it.percent >= 50
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
                )}
              >
                <Icon size={11} />
                <span className="tabular-nums">{formatValue(it)}/{it.target}{it.key === 'deadline_rate' ? '%' : ''}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Full mode
  return (
    <div className="space-y-3">
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
      <div className="space-y-2">
        {kpi.items.map(it => {
          const Icon = KEY_ICON[it.key] || TrendingUp
          return (
            <div key={it.key} className="space-y-1">
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
