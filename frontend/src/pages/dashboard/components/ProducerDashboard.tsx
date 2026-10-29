import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, addWeeks, format, isSameDay, startOfWeek } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Send } from 'lucide-react'
import clsx from 'clsx'
import { producerApi, type ProducerShoot } from '@/services/api.service'

/** Панель продюсера (29.10.2026): съёмки всех SMM-проектов на неделю —
 *  только посмотреть. Продюсер почти не заходит в CRM: съёмки приходят ему
 *  в Telegram в 18:00 накануне и по субботам, поэтому кнопок здесь нет. */
export default function ProducerDashboard() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const from = format(weekStart, 'yyyy-MM-dd')
  const to = format(addDays(weekStart, 6), 'yyyy-MM-dd')

  const { data, isLoading } = useQuery({
    queryKey: ['producer-shoots', from, to],
    queryFn: () => producerApi.shoots(from, to),
  })
  const items: ProducerShoot[] = data?.items || []

  // Неделя у нас пн–сб; воскресенье показываем, только если в него съёмка.
  const days = useMemo(() => {
    const all = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const sunday = format(all[6], 'yyyy-MM-dd')
    return items.some(s => s.date === sunday) ? all : all.slice(0, 6)
  }, [weekStart, items])

  const last = days[days.length - 1]
  const range = weekStart.getMonth() === last.getMonth()
    ? `${format(weekStart, 'd')}–${format(last, 'd MMMM', { locale: ru })}`
    : `${format(weekStart, 'd MMMM', { locale: ru })} – ${format(last, 'd MMMM', { locale: ru })}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Панель</h1>
          <span className="text-sm text-surface-500 dark:text-surface-400">съёмки по всем SMM-проектам</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Прошлая неделя" onClick={() => setWeekStart(w => addWeeks(w, -1))}
            className="w-10 h-10 grid place-items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] text-center text-sm font-semibold text-surface-900 dark:text-surface-50">{range}</span>
          <button type="button" aria-label="Следующая неделя" onClick={() => setWeekStart(w => addWeeks(w, 1))}
            className="w-10 h-10 grid place-items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-3.5 py-2.5 text-sm text-surface-600 dark:text-surface-300">
        <Send size={16} className="shrink-0 text-teal-500 dark:text-teal-300" />
        Всё это приходит в Telegram — накануне и раз в неделю. Заходить сюда не обязательно, отмечать ничего не нужно.
      </div>

      <div className={clsx('grid gap-3 grid-cols-1 sm:grid-cols-2', days.length === 7 ? 'lg:grid-cols-7' : 'lg:grid-cols-6')}>
        {days.map(day => {
          const iso = format(day, 'yyyy-MM-dd')
          const today = isSameDay(day, new Date())
          const list = items.filter(s => s.date === iso)
          return (
            <div key={iso} className={clsx('rounded-2xl border p-3 flex flex-col gap-2.5 min-h-[140px]',
              today ? 'border-primary-500/60 bg-primary-500/5' : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900')}>
              <div className="flex items-baseline justify-between px-0.5 text-[13px] text-surface-500 dark:text-surface-400">
                <span className={clsx(today && 'font-semibold text-primary-600 dark:text-primary-400')}>
                  {format(day, 'EEEEEE', { locale: ru }).replace(/^./, c => c.toUpperCase())}{today ? ' · сегодня' : ''}
                </span>
                <b className="text-base text-surface-900 dark:text-surface-50">{format(day, 'd')}</b>
              </div>
              {isLoading ? (
                <span className="h-16 rounded-xl bg-surface-100 dark:bg-surface-800 animate-pulse" />
              ) : list.length === 0 ? (
                <span className="px-0.5 text-[13px] text-surface-400">Съёмок нет</span>
              ) : list.map(s => (
                <div key={s.id} className={clsx('rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2.5 flex flex-col gap-0.5', s.done && 'opacity-55')}>
                  {s.time && <span className="text-[13px] font-bold tabular-nums text-primary-600 dark:text-primary-400">{s.time}</span>}
                  <b className="text-sm font-semibold text-surface-900 dark:text-surface-50">{s.projectName}</b>
                  <span className="text-[12.5px] leading-snug text-surface-500 dark:text-surface-400">
                    {s.title ? `«${s.title}»` : 'Без названия'} · {s.videographer || 'видеограф не назначен'}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
