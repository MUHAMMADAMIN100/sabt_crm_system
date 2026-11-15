// Раздел «Продажи» (15.11.2026, docs/SALES_SPEC.md §5, §7): вкладки
// «Аналитика» (руководство), «Заявки» (руководство и руководители
// направлений — передачи в работу, создание проекта по заявке) и
// «Настройки» (нормы KPI и комиссия менеджеров). Вкладка — в адресе
// (?tab=analytics|handoffs|settings), поэтому ссылка из уведомления
// «/sales?tab=handoffs» открывает нужное сразу.
import { useRef, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { BarChart2, Inbox, Settings2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { canSeeSalesAnalytics, canSeeSalesHandoffs } from '@/lib/permissions'
import { useUrlState } from '@/lib/urlState'
import { EmptyState } from '@/components/ui'
import SalesAnalyticsTab from './SalesAnalyticsTab'
import SalesHandoffsTab from './SalesHandoffsTab'
import SalesSettingsTab from './SalesSettingsTab'
import { SALES_PERIODS, dushanbeDay, periodLabel, type SalesPeriod } from './salesFormat'

type SalesTab = 'analytics' | 'handoffs' | 'settings'

const TABS: Array<{ key: SalesTab; label: string; icon: typeof Inbox }> = [
  { key: 'analytics', label: 'Аналитика', icon: BarChart2 },
  { key: 'handoffs', label: 'Заявки', icon: Inbox },
  { key: 'settings', label: 'Настройки', icon: Settings2 },
]

export default function SalesPage() {
  const user = useAuthStore(s => s.user)
  const top = canSeeSalesAnalytics(user?.role, user?.secondaryRole)
  const visible = TABS.filter(t => (t.key === 'handoffs' ? canSeeSalesHandoffs(user?.role, user?.secondaryRole) : top))
  const keys = visible.map(t => t.key)
  const [tab, setTab] = useUrlState<SalesTab>('tab', keys[0] ?? 'handoffs', keys)
  // Период аналитики живёт в адресе — нужен и заголовку страницы.
  const [period] = useUrlState<SalesPeriod>('period', 'month', SALES_PERIODS)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  if (!visible.length) {
    return <EmptyState title="Раздел недоступен" description="Раздел «Продажи» открыт руководству и руководителям направлений." />
  }

  // Стрелки влево/вправо переключают вкладки (паттерн WAI-ARIA tabs).
  const onTabsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = keys.indexOf(tab)
    const next = keys[(i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length]
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  // Руководителю направления раздел — это только заявки.
  const title = tab === 'analytics' ? `Продажи · ${periodLabel(period, dushanbeDay())}`
    : visible.length === 1 ? 'Заявки от продаж' : 'Продажи'

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3">
        <h1 className="page-title">{title}</h1>
        {visible.length > 1 && (
          <div role="tablist" aria-label="Разделы продаж" onKeyDown={onTabsKey}
            className="flex gap-1 overflow-x-auto hide-scrollbar border-b border-surface-200 dark:border-surface-700">
            {visible.map(t => {
              const active = t.key === tab
              const Icon = t.icon
              return (
                <button key={t.key} type="button" role="tab" id={`sales-tab-${t.key}`}
                  ref={el => { tabRefs.current[t.key] = el }}
                  aria-selected={active} aria-controls={`sales-panel-${t.key}`} tabIndex={active ? 0 : -1}
                  onClick={() => setTab(t.key)}
                  className={clsx('inline-flex items-center gap-1.5 shrink-0 min-h-[44px] lg:min-h-[38px] px-3 -mb-px border-b-2 text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary-600 text-surface-900 dark:border-surface-100 dark:text-white'
                      : 'border-transparent text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200')}>
                  <Icon size={15} aria-hidden="true" />
                  {t.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div role={visible.length > 1 ? 'tabpanel' : undefined} id={`sales-panel-${tab}`}
        aria-labelledby={visible.length > 1 ? `sales-tab-${tab}` : undefined}>
        {tab === 'analytics' && <SalesAnalyticsTab />}
        {tab === 'handoffs' && <SalesHandoffsTab />}
        {tab === 'settings' && <SalesSettingsTab />}
      </div>
    </div>
  )
}
