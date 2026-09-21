// Табель рабочих часов: команда × дни месяца, клик по строке — карточка
// сотрудника с его календарём, итогами и отрезками смен.
//
// Живёт рядом с лентой активности (вкладка «Активность и смены» в
// «Сотрудниках»): смены — это про людей. Видят только основатель, сооснователь
// и админ — доступ закрыт и на сервере.
import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Clock, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { workShiftsApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'

type Seg = { from: string; to: string | null; reason: string | null; minutes: number }
type Person = {
  id: string; name: string; role: string; avatar: string | null
  days: Record<string, number>
  segments: Record<string, Seg[]>
  lateDays: number[]
  autoDays: number[]
  workedDays: number
  totalMinutes: number
  avgMinutes: number
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

/** «7 ч 35 мин», «45 мин», «—». */
function fmt(min: number): string {
  if (!min) return '—'
  const h = Math.floor(min / 60), m = min % 60
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`
}
/** Компактно для ячейки табеля: «7.5» часа или «45м». */
function short(min: number): string {
  if (!min) return '·'
  if (min < 60) return `${min}м`
  const h = min / 60
  return (Math.round(h * 10) / 10).toFixed(1).replace('.0', '')
}
/** Насыщенность ячейки по отработанному: чем больше часов, тем темнее. */
function cellTone(min: number): string {
  if (!min) return 'bg-surface-50 dark:bg-surface-800/40 border-surface-100 dark:border-surface-700/60 text-surface-300 dark:text-surface-600'
  if (min >= 480) return 'bg-emerald-500/40 border-emerald-500 text-emerald-700 dark:text-emerald-200'
  if (min >= 300) return 'bg-emerald-500/24 border-emerald-500/50 text-emerald-700 dark:text-emerald-300'
  return 'bg-emerald-500/12 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
}
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()
function avColor(id: string) {
  let h = 0
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const colors = ['#c2410c', '#7c3aed', '#0e7490', '#b45309', '#be185d', '#1d8f5f', '#4338ca', '#b91c1c']
  return colors[h % colors.length]
}
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export default function ShiftsTimesheet() {
  const [cursor, setCursor] = useState(() => new Date())
  const [openId, setOpenId] = useState<string | null>(null)
  const ym = ymOf(cursor)

  const { data, isLoading } = useQuery({
    queryKey: ['work-shifts-month', ym],
    queryFn: () => workShiftsApi.month(ym),
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  })

  const items: Person[] = data?.items ?? []
  const daysInMonth: number = data?.daysInMonth ?? 30
  const todayNum = data?.today?.slice(0, 7) === ym ? Number(data.today.slice(8, 10)) : 0
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])
  const person = items.find(p => p.id === openId) || null

  const goMonth = (n: number) => setCursor(c => new Date(c.getFullYear(), c.getMonth() + n, 1))

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl mb-5">
      <div className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
        <Clock size={15} className="text-emerald-500 shrink-0" />
        <b className="text-sm font-bold">Табель рабочих часов</b>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => goMonth(-1)} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center justify-center" aria-label="Предыдущий месяц"><ChevronLeft size={14} /></button>
          <b className="text-[12.5px] font-bold capitalize min-w-[120px] text-center">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </b>
          <button onClick={() => goMonth(1)} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center justify-center" aria-label="Следующий месяц"><ChevronRight size={14} /></button>
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800 overflow-x-auto">
        {isLoading && !items.length ? (
          <p className="px-4 py-6 text-sm text-gray-400">Загружаем табель…</p>
        ) : !items.length ? (
          <p className="px-4 py-6 text-sm text-gray-400">За этот месяц смен нет.</p>
        ) : (
          <table className="border-separate border-spacing-0 min-w-[760px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[9px] font-extrabold uppercase tracking-wide text-gray-400 px-4 py-2 sticky left-0 bg-white dark:bg-gray-900 z-10">Сотрудник</th>
                {days.map(d => (
                  <th key={d} className={'text-[9px] font-extrabold py-2 ' + (d === todayNum ? 'text-emerald-500' : 'text-gray-400')}>{d}</th>
                ))}
                <th className="text-right text-[9px] font-extrabold uppercase tracking-wide text-gray-400 px-4 py-2">Итого</th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} onClick={() => setOpenId(p.id)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="px-4 py-1.5 sticky left-0 bg-white dark:bg-gray-900 z-10">
                    <span className="flex items-center gap-2 min-w-[150px]">
                      <span className="w-6 h-6 rounded-full grid place-items-center text-white font-bold text-[8px] shrink-0"
                        style={{ background: avColor(p.id) }}>{initials(p.name)}</span>
                      <span className="min-w-0">
                        <b className="block text-[11.5px] font-semibold leading-tight truncate max-w-[150px]">{p.name}</b>
                        <span className="block text-[9.5px] text-gray-500 truncate max-w-[150px]">{getRoleLabel(p.role)}</span>
                      </span>
                    </span>
                  </td>
                  {days.map(d => {
                    const min = p.days?.[d] ?? 0
                    const late = p.lateDays?.includes(d)
                    return (
                      <td key={d} className="text-center">
                        <span title={min ? `${d} число · ${fmt(min)}${late ? ' · опоздание' : ''}` : undefined}
                          className={'w-[26px] h-[26px] mx-auto my-[1px] rounded-md grid place-items-center text-[9.5px] font-bold tabular-nums border '
                            + cellTone(min) + (late ? ' ring-1 ring-amber-500' : '')}>
                          {short(min)}
                        </span>
                      </td>
                    )
                  })}
                  <td className="px-4 py-1.5 text-right whitespace-nowrap">
                    <b className="text-[12px] font-bold tabular-nums">{fmt(p.totalMinutes)}</b>
                    <span className="block text-[9.5px] text-gray-400 tabular-nums">
                      {p.workedDays} дн · ~{fmt(p.avgMinutes)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
        Нажмите на сотрудника — откроется его месяц с отрезками смен. Жёлтая обводка — приход позже {data?.lateAfter ?? '09:30'} (рабочий день с {data?.workStart ?? '09:00'}).
      </p>

      {person && createPortal(
        <PersonCard person={person} ym={ym} daysInMonth={daysInMonth}
          monthLabel={`${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`}
          onClose={() => setOpenId(null)} />,
        document.body,
      )}
    </div>
  )
}

/** Карточка сотрудника: календарь месяца, итоги и отрезки смен по дням. */
function PersonCard({ person, daysInMonth, monthLabel, onClose }: {
  person: Person; ym: string; daysInMonth: number; monthLabel: string; onClose: () => void
}) {
  const WEEK = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const withShifts = days.filter(d => (person.segments?.[d]?.length ?? 0) > 0).sort((a, b) => b - a)

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-label={`Смены — ${person.name}`}
        className="relative w-full sm:max-w-3xl max-h-[88vh] flex flex-col bg-white dark:bg-gray-900 rounded-t-[22px] sm:rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl">
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <span className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-[11px] shrink-0"
            style={{ background: avColor(person.id) }}>{initials(person.name)}</span>
          <span className="min-w-0">
            <b className="block text-[15px] font-bold leading-tight truncate">{person.name}</b>
            <span className="block text-[11.5px] text-gray-500 truncate">{getRoleLabel(person.role)} · {monthLabel}</span>
          </span>
          <button onClick={onClose} title="Закрыть"
            className="ml-auto w-8 h-8 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center justify-center"><X size={15} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <div className="grid grid-cols-7 gap-1">
              {WEEK.map(w => <div key={w} className="text-center text-[8.5px] font-bold uppercase text-gray-400 pb-1">{w}</div>)}
              {days.map(d => {
                const min = person.days?.[d] ?? 0
                const late = person.lateDays?.includes(d)
                return (
                  <div key={d} className={'min-h-[44px] rounded-lg border p-1 flex flex-col ' + cellTone(min) + (late ? ' ring-1 ring-amber-500' : '')}>
                    <span className="text-[9px] tabular-nums text-right opacity-70">{d}</span>
                    <span className="mt-auto text-[10.5px] font-bold tabular-nums">{min ? short(min) : ''}</span>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400 mb-2">Смены по дням</p>
              {withShifts.length === 0 ? (
                <p className="text-[13px] text-gray-400">В этом месяце смен не было.</p>
              ) : withShifts.map(d => (
                <div key={d} className="flex gap-3 py-1.5 border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <span className="text-[11.5px] tabular-nums text-gray-500 w-[52px] shrink-0">{d} числа</span>
                  <span className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                    {person.segments[d].map((sg, i) => (
                      <span key={i} className={'text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums '
                        + (sg.reason === 'auto' ? 'bg-red-500/12 text-red-600 dark:text-red-400'
                          : sg.reason === 'pause' ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400')}>
                        {sg.from} — {sg.to ?? 'сейчас'}
                        {sg.reason === 'auto' && ' · закрыта автоматически'}
                      </span>
                    ))}
                  </span>
                  <b className="text-[11.5px] font-bold tabular-nums shrink-0">{fmt(person.days?.[d] ?? 0)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 content-start">
            <Tile value={fmt(person.totalMinutes)} label={`всего за ${monthLabel.split(' ')[0]}`} />
            <Tile value={fmt(person.avgMinutes)} label="в среднем за рабочий день" />
            <Tile value={String(person.workedDays)} label="рабочих дней" />
            <Tile value={String(person.lateDays?.length ?? 0)} label="опозданий" tone={person.lateDays?.length ? 'amber' : undefined} />
            <Tile value={String(person.autoDays?.length ?? 0)} label="смен закрыто автоматически" tone={person.autoDays?.length ? 'red' : undefined} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'amber' | 'red' }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2">
      <b className={'block text-[16px] font-bold tabular-nums leading-tight '
        + (tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'red' ? 'text-red-600 dark:text-red-400' : '')}>{value}</b>
      <span className="block text-[10px] text-gray-500 mt-0.5">{label}</span>
    </div>
  )
}
