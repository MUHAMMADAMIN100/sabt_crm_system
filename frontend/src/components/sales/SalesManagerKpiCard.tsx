import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { TrendingUp, Building2, Phone, Mail, Calendar } from 'lucide-react'
import clsx from 'clsx'

/** KPI-метрика — одна строка/чип. */
interface KpiItem {
  key: string
  label: string
  target: number
  value: number
  percent: number
  done: boolean
}

interface KpiResponse {
  periodFrom: string
  periodTo: string
  overallPercent: number
  items: KpiItem[]
}

/** Иконка под каждый ключ метрики. */
const KEY_ICON: Record<string, any> = {
  funnel_progress: TrendingUp,
  new_companies: Building2,
  cold_calls: Phone,
  personal_emails: Mail,
  meetings: Calendar,
}

/** Цвет прогресс-кольца в зависимости от % выполнения. */
function colorByPercent(p: number): string {
  if (p >= 100) return 'text-emerald-500'
  if (p >= 70) return 'text-lime-500'
  if (p >= 40) return 'text-amber-500'
  return 'text-red-500'
}

/** Маленькое круговое прогресс-кольцо для overall%. */
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

interface Props {
  /** ID юзера (МП) чей KPI показывать. */
  userId: string
  /** Компактный режим — для карточки сотрудника / виджета дашборда. */
  compact?: boolean
  /** Период (опционально, по умолчанию — текущий месяц). */
  from?: string
  to?: string
  /** Уже загруженные данные — позволяет переиспользовать compact для bulk-данных
   *  без отдельного запроса. Если передано — userId/from/to игнорируются. */
  kpi?: KpiResponse | null
}

/**
 * Reusable KPI-карточка менеджера продаж.
 *  - compact: одна строка с круговым % + 5 чипов метрик.
 *  - full: список метрик с прогресс-баром у каждой + большой overall%.
 *
 * Источник данных: `GET /clients/kpi/user/:userId` (или переданный `kpi` prop).
 * Если у юзера нет доступа (API возвращает null) — компонент не рендерится.
 */
export default function SalesManagerKpiCard({
  userId, compact, from, to, kpi: preloadedKpi,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['kpi-of-user', userId, from, to],
    queryFn: () => clientsApi.kpiOfUser(userId, { from, to }),
    enabled: !!userId && !preloadedKpi,
    staleTime: 30_000,
  })

  const kpi: KpiResponse | null = preloadedKpi ?? data
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
                title={`${it.label}: ${it.value} / ${it.target} (${it.percent}%)`}
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
                <span className="tabular-nums">{it.value}/{it.target}</span>
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
                  <b className={clsx('font-bold', colorByPercent(it.percent))}>{it.value}</b>
                  {' / '}{it.target}
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
