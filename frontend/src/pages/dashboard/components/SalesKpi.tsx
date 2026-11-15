// KPI менеджера по продажам — карточка «KPI сегодня» в правой колонке экрана
// «Сегодня» (Продажи, этап 2, 15.11.2026). Пять строк «факт / норма» с
// полосой; у каждой (i) с правилом счёта — менеджер видел цифры, но не знал,
// за что они растут. Период по-прежнему можно выбрать, по нажатию на строку —
// записи, из которых сложилась цифра (KpiDetailsModal).
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import { clientsApi } from '@/services/api.service'
import { DateRangePicker } from '@/components/ui/DatePicker'
import { useAuthStore } from '@/store/auth.store'
import KpiDetailsModal from '@/components/kpi/KpiDetailsModal'
import { SALES_KPI_LABEL, SALES_KPI_ORDER, SALES_KPI_RULE, salesKpiKey } from '@/components/kpi/salesKpiRules'

type KpiItem = { key: string; label: string; target: number; value: number; percent: number; done: boolean }

const asDate = (iso: string) => new Date(`${iso}T00:00:00`)

/** «сегодня», «12 ноября», «10–15 ноября», «28 октября – 3 ноября»:
 *  раньше в шапке стояли голые «2026-11-10 … 2026-11-15». */
export function humanRange(from: string, to: string, todayIso: string): string {
  if (from === to) return from === todayIso ? 'сегодня' : format(asDate(from), 'd MMMM', { locale: ru })
  const f = asDate(from), t = asDate(to)
  const sameYear = f.getFullYear() === t.getFullYear()
  const yearTail = sameYear && f.getFullYear() === new Date().getFullYear() ? '' : ` ${t.getFullYear()}`
  if (sameYear && f.getMonth() === t.getMonth()) return `${format(f, 'd')}–${format(t, 'd MMMM', { locale: ru })}${yearTail}`
  return `${format(f, sameYear ? 'd MMMM' : 'd MMMM yyyy', { locale: ru })} – ${format(t, 'd MMMM', { locale: ru })}${yearTail}`
}

/** Цвет полосы и цифры: норма выполнена — зелёный, близко — нейтральный, мало — красный. */
function tone(percent: number, done: boolean) {
  if (done || percent >= 100) return { bar: 'bg-green-500', text: 'text-green-600 dark:text-green-400' }
  if (percent >= 70) return { bar: 'bg-primary-500', text: 'text-surface-900 dark:text-surface-100' }
  return { bar: 'bg-red-400', text: 'text-surface-900 dark:text-surface-100' }
}

export default function SalesKpi({ className }: { className?: string }) {
  const userId = useAuthStore(s => s.user?.id)
  const uid = useId()
  const [opened, setOpened] = useState<{ key: string; label: string } | null>(null)
  // Какое правило раскрыто кнопкой (i) — по одному за раз.
  const [ruleOpen, setRuleOpen] = useState<string | null>(null)

  // «Сегодня» — по Душанбе, как считает сервер (UTC-дата до 05:00 — вчера).
  // Ключ запроса тот же, что у KpiCelebrationWatcher: один кэш на двоих.
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date())
  const [from, setFrom] = useState(todayIso)
  const [to, setTo] = useState(todayIso)
  const { data: kpi, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['sales-kpi', userId, from, to],
    queryFn: () => clientsApi.kpi({ from, to }),
    enabled: !!userId,
    refetchOnMount: 'always',
    staleTime: 30_000,
  })

  // Строки — в постоянном порядке; подписи свои, короткие («Звонки», а не
  // «Холодные звонки» из старого ответа сервера).
  const items: KpiItem[] = (() => {
    const raw: KpiItem[] = Array.isArray(kpi?.items) ? kpi.items : []
    const byKey = new Map(raw.map(it => [salesKpiKey(it.key) ?? it.key, it]))
    const known = SALES_KPI_ORDER.map(k => {
      const it = byKey.get(k)
      return it ? { ...it, key: k, label: SALES_KPI_LABEL[k] } : null
    }).filter(Boolean) as KpiItem[]
    // Метрики, которых фронт ещё не знает, не теряем — ставим в конец.
    const extra = raw.filter(it => !salesKpiKey(it.key))
    return [...known, ...extra]
  })()

  const title = `KPI ${humanRange(from, to, todayIso)}`
  const overall = Number(kpi?.overallPercent ?? 0)

  return (
    <section className={clsx('card', className)} aria-labelledby={`${uid}-title`}>
      <div className="flex items-center gap-2 mb-2.5">
        <h2 id={`${uid}-title`} className="text-[15px] font-bold text-surface-900 dark:text-surface-100 first-letter:uppercase">
          {title}
        </h2>
        {kpi && (
          kpi.restDay ? (
            // Выходной (воскресенье, отпуск): нормы нет — не красный 0 %.
            <span className="ml-auto text-xs font-medium text-surface-500 dark:text-surface-400">выходной</span>
          ) : (
            <span className={clsx('ml-auto text-xs font-bold tabular-nums rounded-md px-2 py-0.5',
              overall >= 100 ? 'text-green-700 dark:text-green-300 bg-green-500/15'
                : overall >= 70 ? 'text-surface-600 dark:text-surface-300 bg-surface-500/10'
                : 'text-red-600 dark:text-red-300 bg-red-500/10')}>
              {overall}% нормы
            </span>
          )
        )}
      </div>

      <DateRangePicker
        from={from}
        to={to}
        onChange={(f, t) => { setFrom(f || todayIso); setTo(t || todayIso) }}
        placeholder="Выберите период"
      />

      <div className={clsx('mt-3 transition-opacity', isFetching && !isLoading && 'opacity-70')} aria-busy={isFetching}>
        {isLoading ? (
          <ul className="space-y-3" aria-label="Загрузка KPI">
            {SALES_KPI_ORDER.map(k => (
              <li key={k} className="space-y-1.5">
                <div className="flex justify-between"><span className="skeleton h-3.5 w-32" /><span className="skeleton h-3.5 w-10" /></div>
                <span className="skeleton block h-1.5 w-full" />
              </li>
            ))}
          </ul>
        ) : isError || !kpi ? (
          // Раньше при ошибке шапка вечно писала «загрузка…».
          <div className="rounded-xl border border-dashed border-surface-300 dark:border-surface-600 px-3 py-4 text-center">
            <p className="text-[13px] text-surface-600 dark:text-surface-300">Нет данных KPI</p>
            <button type="button" onClick={() => refetch()} className="btn-secondary mt-2 max-sm:min-h-[44px]">
              <RotateCcw size={14} /> Повторить
            </button>
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map(it => {
              const k = salesKpiKey(it.key)
              const rule = k ? SALES_KPI_RULE[k] : null
              const t = tone(it.percent, it.done)
              const ruleId = `${uid}-rule-${it.key}`
              return (
                <li key={it.key}>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setOpened({ key: it.key, label: it.label })}
                      title="Записи, из которых сложилась цифра"
                      className="flex-1 min-w-0 text-left rounded-lg px-1.5 py-1.5 max-sm:min-h-[44px] hover:bg-surface-100 dark:hover:bg-surface-700/50 transition-colors">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] text-surface-700 dark:text-surface-200 truncate">{it.label}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-[13px]">
                          <b className={clsx('font-bold', t.text)}>{it.value}</b>
                          <span className="text-surface-500 dark:text-surface-400"> / {it.target}</span>
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                        <span className={clsx('block h-full rounded-full transition-[width] duration-500', t.bar)}
                          style={{ width: `${Math.min(100, Math.max(0, it.percent))}%` }} />
                      </span>
                    </button>
                    {rule && (
                      <button type="button" onClick={() => setRuleOpen(v => (v === it.key ? null : it.key))}
                        aria-expanded={ruleOpen === it.key} aria-controls={ruleId}
                        aria-label={`Как считается: ${it.label}`} title="Как считается"
                        className={clsx('shrink-0 w-8 h-8 max-sm:w-11 max-sm:h-11 rounded-lg flex items-center justify-center transition-colors',
                          ruleOpen === it.key
                            ? 'text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30'
                            : 'text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700/50')}>
                        <Info size={15} />
                      </button>
                    )}
                  </div>
                  {rule && ruleOpen === it.key && (
                    <p id={ruleId} className="mx-1.5 mb-1.5 rounded-lg bg-surface-100 dark:bg-surface-900/60 px-2.5 py-2 text-[12px] leading-snug text-surface-600 dark:text-surface-300">
                      {rule}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="mt-2.5 text-[11.5px] leading-snug text-surface-500 dark:text-surface-400">
        Встречи считаются после отметки «Состоялась»: назначенная встреча в KPI ещё не идёт.
      </p>

      {opened && userId && (
        <KpiDetailsModal
          open
          onClose={() => setOpened(null)}
          userId={userId}
          metric={opened.key}
          metricLabel={opened.label}
          from={from}
          to={to}
        />
      )}
    </section>
  )
}
