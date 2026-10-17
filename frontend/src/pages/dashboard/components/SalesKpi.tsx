// KPI менеджера по продажам — звонки, письма, встречи, новые компании.
// С новой «Панелью» (17.10.2026) владелец оставил его на виду: блок тот же,
// что был на старой панели, — план/факт за период, считается из CRM.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { DateRangePicker } from '@/components/ui/DatePicker'
import { useAuthStore } from '@/store/auth.store'
import { ProgressBar, CollapsibleSection } from '@/components/ui'
import clsx from 'clsx'
import KpiDetailsModal from '@/components/kpi/KpiDetailsModal'

export default function SalesKpi() {
  const userId = useAuthStore(s => s.user?.id)
  // Модалка с подробностями для нажатой метрики KPI.
  const [openedKpiItem, setOpenedKpiItem] = useState<{ key: string; label: string } | null>(null)

  // KPI плана МП — окно по умолчанию «сегодня», можно выбрать диапазон.
  const todayIso = new Date().toISOString().slice(0, 10)
  const [kpiFrom, setKpiFrom] = useState(todayIso)
  const [kpiTo, setKpiTo] = useState(todayIso)
  const { data: kpi } = useQuery({
    queryKey: ['sales-kpi', userId, kpiFrom, kpiTo],
    queryFn: () => clientsApi.kpi({ from: kpiFrom, to: kpiTo }),
    enabled: !!userId,
    refetchOnMount: 'always',
    staleTime: 30_000,
  })

  return (
    <>
      {/* Рендерим всегда (даже до получения данных), чтобы блок не пропадал,
          если /clients/kpi временно недоступен. Тогда показываем 0/цель. */}
      <CollapsibleSection
        id="sales-kpi"
        title={
          <div className="flex items-center justify-between w-full gap-3 flex-wrap">
            <h3 className="section-title">
              KPI менеджера {kpiFrom === kpiTo
                ? (kpiFrom === todayIso ? '— сегодня' : `— ${kpiFrom}`)
                : `— ${kpiFrom} … ${kpiTo}`}
            </h3>
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <div className="w-[260px]">
                <DateRangePicker
                  from={kpiFrom}
                  to={kpiTo}
                  onChange={(f, t) => { setKpiFrom(f || todayIso); setKpiTo(t || todayIso) }}
                  placeholder="Выберите период"
                />
              </div>
              <span className={clsx(
                'text-xs font-semibold tabular-nums shrink-0',
                (kpi?.overallPercent ?? 0) >= 100 ? 'text-green-600' :
                (kpi?.overallPercent ?? 0) >= 70  ? 'text-surface-600'   : 'text-red-600',
              )}>
                {kpi ? `${kpi.overallPercent}% от плана` : 'загрузка…'}
              </span>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(kpi?.items ?? [
            { key: 'new_companies',   label: 'Новые компании в базе', target: 15, value: 0, percent: 0, done: false },
            { key: 'cold_calls',      label: 'Холодные звонки',       target: 20, value: 0, percent: 0, done: false },
            { key: 'personal_emails', label: 'Персональные письма',   target: 10, value: 0, percent: 0, done: false },
            { key: 'meetings',        label: 'Встречи / созвоны',     target: 2,  value: 0, percent: 0, done: false },
          ]).map((it: any) => (
            <button
              key={it.key}
              type="button"
              onClick={() => setOpenedKpiItem({ key: it.key, label: it.label })}
              disabled={!kpi}
              title="Кликни чтобы посмотреть подробности"
              className={clsx(
                'text-left rounded-xl border p-3 space-y-1.5 transition-all',
                kpi && 'hover:shadow-md hover:-translate-y-0.5 hover:border-primary-300 dark:hover:border-primary-700 cursor-pointer',
                !kpi && 'opacity-60 cursor-not-allowed',
                it.done
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/40'
                  : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-surface-600 dark:text-surface-300">{it.label}</span>
                <span className="text-[10px] text-surface-400">цель {it.target}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={clsx(
                  'text-xl font-bold tabular-nums',
                  it.done ? 'text-green-600 dark:text-green-400' : 'text-surface-800 dark:text-surface-100',
                )}>
                  {it.value}
                </span>
                <span className="text-xs text-surface-400">/ {it.target}</span>
                {it.done && <span className="ml-auto text-[10px] font-semibold text-green-600">✓</span>}
              </div>
              <ProgressBar value={it.percent} />
            </button>
          ))}
        </div>
      </CollapsibleSection>

      {openedKpiItem && userId && (
        <KpiDetailsModal
          open
          onClose={() => setOpenedKpiItem(null)}
          userId={userId}
          metric={openedKpiItem.key}
          metricLabel={openedKpiItem.label}
          from={kpiFrom}
          to={kpiTo}
        />
      )}
    </>
  )
}
