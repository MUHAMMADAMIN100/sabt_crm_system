// «Календарь оплат» менеджера по продажам — месяц с деньгами его клиентов и
// своими задачами (макет владельца 17.10.2026, как панель СММ-специалиста).
// То же, что владелец видит в «Финансы → Планирование»: ○ ждём, ● получено,
// красным — просрочено, с суммами. Оплату менеджер не отмечает — её
// записывают в «Финансах».
//
// 15.11.2026 (Продажи, этап 2): вынесен из «Панели» в отдельный блок под
// кнопкой «Календарь оплат» на экране «Сегодня» — главным стал список дел,
// а месяц остаётся под рукой целиком: клетки, окно дня, свои задачи.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Info, Plus, Wallet, X } from 'lucide-react'
import { addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, getDay, isSameDay, isToday, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import { smmPaymentsApi, type SalesCalPay } from '@/services/api.service'
import { OwnDayTasks, OwnMark, OwnPopover, OwnBox, CellLines, CellPlus, PayDot, ownLines, type CellLine, type OwnTasksApi } from './OwnTasks'
import { Metric } from './DaySummary'
import { useHistoryOverlay } from '@/lib/navMemory'

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const dk = (d: Date) => format(d, 'yyyy-MM-dd')
export const asDate = (iso: string) => new Date(`${iso}T00:00:00`)
/** Сумма в сомони без копеек: «21 000». null — сумма скрыта сервером (нет
 *  доступа к деньгам этого клиента, 15.11.2026). */
export const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'))
const shortDay = (iso: string) => format(asDate(iso), 'd MMM', { locale: ru })

/** Русское склонение по числу. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = Math.abs(n) % 10, h = Math.abs(n) % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few
  return many
}

export const isPaid = (p: SalesCalPay) => p.state === 'paid'
const lineState = (p: SalesCalPay): CellLine['state'] => (isPaid(p) ? 'done' : p.state === 'late' ? 'late' : 'open')

/** За что оплата: «оплата за октябрь», «2-я часть», поступление без плана. */
export function payWhat(p: SalesCalPay): string {
  if (p.source === 'tx') return 'поступление'
  const month = format(asDate(`${p.ym}-01`), 'LLLL', { locale: ru })
  if (p.source === 'forecast') return `по тарифу за ${month}`
  return `оплата за ${month}${p.partNo === 2 ? ' · 2-я часть' : ''}`
}

const TILE: Record<SalesCalPay['state'], string> = {
  late: 'text-red-500 dark:text-red-400 bg-red-500/12',
  today: 'text-amber-500 dark:text-amber-400 bg-amber-500/12',
  wait: 'text-blue-500 dark:text-blue-400 bg-blue-500/12',
  paid: 'text-green-600 dark:text-green-400 bg-green-500/12',
}

/** Деньги месяца. Ключ общий с «Сегодня»: тот же запрос не идёт дважды. */
export const payCalendarKey = (from: string, to: string) => ['sales-pay-calendar', from, to] as const

export default function SalesPayCalendar({ own, todayKey, id }: {
  own: OwnTasksApi
  todayKey: string
  /** id блока — к нему прокручивает ссылка «Календарь оплат». */
  id?: string
}) {
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(() => new Date())
  const [sel, setSel] = useState(() => new Date())
  const [dayOpen, setDayOpen] = useState(false)

  const from = dk(startOfMonth(cursor))
  const to = dk(endOfMonth(cursor))
  const selKey = dk(sel)
  // Окошко своих задач у клетки дня (компьютер) и курсор в строке ввода,
  // когда день открыт кнопкой «+ Своя задача» (телефон).
  const [ownPop, setOwnPop] = useState<{ day: string; el: HTMLElement } | null>(null)
  const [ownFocus, setOwnFocus] = useState(false)
  const addOwnToday = (ev: { currentTarget: HTMLElement }) => {
    const now = new Date()
    setCursor(now); setSel(now)
    if (window.matchMedia('(max-width: 639px)').matches) { setOwnFocus(true); setDayOpen(true); return }
    // Окошко — прямо под нажатой кнопкой, а не у клетки на другом конце экрана.
    setOwnPop({ day: dk(now), el: ev.currentTarget })
  }

  // Деньги месяца; просроченные сервер отдаёт всегда. Смена месяца не
  // обнуляет экран (08.11.2026): пока грузится новый, держим прошлый, а
  // календарь и цифры месяца бледнеют.
  const qc = useQueryClient()
  const { data: cal, isPlaceholderData: stale } = useQuery({
    queryKey: payCalendarKey(from, to),
    queryFn: () => smmPaymentsApi.calendar(from, to),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  // Наведение на стрелку — соседний месяц грузим заранее: к нажатию он готов.
  const prefetchMonth = (delta: number) => {
    const c = addMonths(cursor, delta)
    const f = dk(startOfMonth(c)), t = dk(endOfMonth(c))
    qc.prefetchQuery({ queryKey: payCalendarKey(f, t), queryFn: () => smmPaymentsApi.calendar(f, t), staleTime: 60_000 })
  }
  const items = cal?.items || []

  const payByDay = useMemo(() => {
    const map: Record<string, SalesCalPay[]> = {}
    for (const p of items) if (p.date >= from && p.date <= to) (map[p.date] ||= []).push(p)
    for (const list of Object.values(map)) list.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.partNo - b.partNo)
    return map
  }, [items, from, to])

  // Цифры месяца: получено из ожидаемого и сколько клиентов оплатили.
  const month = useMemo(() => {
    const list = Object.values(payByDay).flat()
    const total = list.reduce((s, p) => s + (p.amount ?? 0), 0)
    const received = list.filter(isPaid).reduce((s, p) => s + (p.amount ?? 0), 0)
    const clients = new Set(list.filter(isPaid).map(p => p.clientId)).size
    return { total, received, clients }
  }, [payByDay])

  // Смена месяца: курсор + выбранный день (сегодня, если месяц текущий).
  const goMonth = (delta: number) => {
    const nc = addMonths(cursor, delta)
    setCursor(nc)
    const now = new Date()
    setSel(nc.getMonth() === now.getMonth() && nc.getFullYear() === now.getFullYear() ? now : startOfMonth(nc))
  }

  const closeDay = () => { setDayOpen(false); setOwnFocus(false) }

  // «Назад» закрывает окно дня (08.11.2026). Ушли из окна дальше (в проект,
  // в задачу) — при возврате оно снова открыто на том же дне.
  useHistoryOverlay('day', dayOpen ? dk(sel) : null, v => {
    if (v) { const d = new Date(`${v}T00:00:00`); setSel(d); setCursor(d); setDayOpen(true) }
    else { setDayOpen(false); setOwnFocus(false) }
  })

  // Окно дня: Esc закрывает, страница под окном не листается.
  useEffect(() => {
    if (!dayOpen) return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setDayOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [dayOpen])

  const openProject = (p: SalesCalPay) => { if (p.projectId) navigate(`/smm/projects/${p.projectId}`) }

  // ── Мини-календарь ──
  const monthStart = startOfMonth(cursor)
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(cursor) })
  const pad = (getDay(monthStart) + 6) % 7

  const selPays = payByDay[selKey] || []
  const ownSel = own.of(selKey)
  const dayTotal = selPays.length + ownSel.length
  const dayDone = selPays.filter(isPaid).length + ownSel.filter(t => t.done).length

  // Телефон: суммы в ячейку не помещаются — тип точкой, объём её размером.
  const dotSize = (n: number) => (n >= 2 ? 'w-[7px] h-[7px]' : 'w-1.5 h-1.5')

  // Строки клетки на компьютере: оплаты дня (клиент и сумма), следом свои задачи.
  const cellLines = (key: string): CellLine[] => [
    ...(payByDay[key] || []).map((p): CellLine => ({ key: p.key, kind: 'pay', proj: p.name, text: money(p.amount), state: lineState(p) })),
    ...ownLines(own.of(key)),
  ]

  return (
    <section id={id} className="card scroll-mt-4" aria-label="Календарь оплат">
      {/* Цифры месяца — как в прежней шапке «Панели». */}
      <div className={clsx('flex flex-wrap gap-2 mb-3 transition-opacity', stale && 'opacity-60')}>
        <Metric
          value={`${money(month.received)}/${money(month.total)}`}
          label={`получено за ${format(cursor, 'LLLL', { locale: ru })}, с.`}
          bar={month.total > 0 ? Math.min(1, month.received / month.total) : 0}
        />
        <Metric value={String(month.clients)}
          label={plural(month.clients, 'клиент оплатил', 'клиента оплатили', 'клиентов оплатили')}
          tone={month.clients > 0 ? 'ok' : undefined} />
      </div>

      {/* На телефоне месяц со стрелками — слева: по центру правая стрелка
          уходила под кнопку «+» (320 px). */}
      <div className="relative flex items-center justify-start sm:justify-center gap-2 sm:gap-4 mb-3">
        <button type="button" onClick={() => goMonth(-1)} onPointerEnter={() => prefetchMonth(-1)} onFocus={() => prefetchMonth(-1)} title="Прошлый месяц" aria-label="Прошлый месяц" className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronLeft size={16} /></button>
        <b className="text-sm font-bold capitalize min-w-[110px] sm:min-w-[130px] text-center">{format(cursor, 'LLLL yyyy', { locale: ru })}</b>
        <button type="button" onClick={() => goMonth(1)} onPointerEnter={() => prefetchMonth(1)} onFocus={() => prefetchMonth(1)} title="Следующий месяц" aria-label="Следующий месяц" className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronRight size={16} /></button>
        {/* Своя задача на сегодня — в одно нажатие, не открывая день вручную. */}
        <button type="button" onClick={addOwnToday} title="Поставить себе задачу на сегодня" aria-label="Своя задача на сегодня"
          className="absolute right-0 top-0 h-11 sm:h-8 min-w-[44px] sm:min-w-[36px] justify-center px-2 sm:px-3 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 text-[12.5px] font-bold flex items-center gap-1.5">
          <Plus size={15} /><span className="hidden sm:inline">Своя задача</span>
        </button>
      </div>
      {/* Оплаты здесь только смотрят (отмечают в «Финансах»), поэтому пока
          грузится месяц, хватает бледности — нажатия не запрещаем. */}
      <div className={clsx('grid grid-cols-7 gap-1.5 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
        {WEEK.map(w => <div key={w} className="text-center text-[11px] font-bold uppercase text-surface-500 dark:text-surface-400 pb-1">{w}</div>)}
        {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} />)}
        {days.map(d => {
          const key = dk(d)
          const pays = payByDay[key] || []
          const late = pays.filter(p => p.state === 'late').length
          const waiting = pays.filter(p => p.state === 'wait' || p.state === 'today').length
          const paid = pays.filter(isPaid).length
          const ownDay = own.of(key)
          const ownLeft = ownDay.filter(t => !t.done).length
          // День, где всё получено и сделано, — зелёная галочка у числа.
          const allDone = (pays.length > 0 || ownDay.length > 0) && ownLeft === 0 && pays.every(isPaid)
          const isSel = isSameDay(d, sel)
          const t = isToday(d)
          const openDay = () => { setSel(d); setOwnFocus(false); setDayOpen(true) }
          // Клетка — не <button>: внутри неё своя кнопка «+», а кнопку в
          // кнопку вкладывать нельзя.
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`${format(d, 'd MMMM', { locale: ru })}: оплаты и задачи дня`}
              data-own-cell={key}
              onClick={openDay}
              onKeyDown={ev => {
                if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openDay() }
              }}
              className={clsx(
                'group min-h-[66px] sm:min-h-[104px] rounded-xl border p-1.5 flex flex-col sm:gap-1 text-left transition cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                isSel ? 'bg-surface-100 dark:bg-surface-800/70' : 'bg-surface-50 dark:bg-surface-800/40',
                t ? 'border-primary-500 ring-[3px] ring-primary-500/20'
                  : late > 0 ? 'border-red-300 dark:border-red-800/70'
                  : 'border-surface-100 dark:border-surface-700/60 hover:border-surface-300 dark:hover:border-surface-600',
                isSel && 'outline-dashed outline-2 outline-offset-[-3px] outline-surface-400 dark:outline-surface-500',
              )}
            >
              <span className="flex items-center justify-between leading-none">
                <span className="flex items-center gap-1">
                  {key >= todayKey && (
                    <CellPlus today={t} label={`Поставить себе задачу на ${format(d, 'd MMMM', { locale: ru })}`}
                      onClick={ev => setOwnPop({ day: key, el: ev.currentTarget })} />
                  )}
                  {allDone && <Check size={11} strokeWidth={3} className="text-emerald-500 dark:text-emerald-400" />}
                </span>
                <span className={clsx('text-[11px] font-bold', t ? 'text-primary-600 dark:text-primary-400' : 'text-surface-500 dark:text-surface-400')}>{format(d, 'd')}</span>
              </span>

              {/* Телефон: точка на состояние, размер по числу оплат. */}
              <span className="sm:hidden mt-auto w-full">
                <span className="flex items-center gap-[3px] h-2">
                  {late > 0 && <i className={clsx('rounded-full bg-red-500 shrink-0', dotSize(late))} />}
                  {waiting > 0 && <i className={clsx('rounded-full bg-blue-400 shrink-0', dotSize(waiting))} />}
                  {paid > 0 && <i className={clsx('rounded-full bg-green-400 shrink-0', dotSize(paid))} />}
                  {ownDay.length > 0 && <OwnMark done={ownLeft === 0} className={dotSize(ownDay.length)} />}
                </span>
              </span>

              {/* Компьютер: клиент и сумма, следом свои задачи. */}
              <CellLines lines={cellLines(key)} />
            </div>
          )
        })}
      </div>
      {/* Что значат метки в клетках. */}
      <div className="hidden sm:flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 text-[11px] text-surface-500 dark:text-surface-400">
        <span className="inline-flex items-center gap-1.5"><PayDot state="open" /> ждём оплату</span>
        <span className="inline-flex items-center gap-1.5"><PayDot state="done" /> получено</span>
        <span className="inline-flex items-center gap-1.5"><OwnBox /> своя задача</span>
        <span><span className="font-medium text-red-500 dark:text-red-400">красным</span> — просрочено</span>
        <span>суммы в сомони</span>
      </div>
      <div className="sm:hidden mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px] text-surface-500 dark:text-surface-400">
        <span className="inline-flex items-center gap-1.5"><i className="w-[7px] h-[7px] rounded-full bg-blue-400" /> ждём оплату</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-[7px] h-[7px] rounded-full bg-green-400" /> получено</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-[7px] h-[7px] rounded-full bg-red-500" /> просрочено</span>
        <span className="inline-flex items-center gap-1.5"><OwnMark className="w-[7px] h-[7px]" /> своя задача</span>
      </div>
      <p className="sm:hidden mt-1.5 text-center text-[11.5px] text-surface-500 dark:text-surface-400">
        нажмите на день — оплаты дня и своя задача
      </p>
      {cal && cal.clients === 0 && (
        <p className="mt-2 text-center text-xs text-surface-500 dark:text-surface-400">
          Своих клиентов пока нет — деньги появятся, когда основатель назначит вас менеджером проекта.
        </p>
      )}

      {/* Окно дня — по нажатию на день в календаре. */}
      {dayOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeDay} />
          <div role="dialog" aria-modal="true" aria-label="Оплаты и задачи дня"
            className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] sm:rounded-2xl sm:border border-surface-200 dark:border-surface-700 shadow-2xl">
            <div className="sm:hidden pt-2 pb-1"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
            <div className="flex items-baseline gap-2.5 px-4 sm:px-5 pt-3 sm:pt-4 pb-3">
              <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 first-letter:uppercase">
                {isToday(sel) ? 'Сегодня' : format(sel, 'd MMMM, EEEE', { locale: ru })}
              </h2>
              <span className="text-xs text-surface-500 dark:text-surface-400">{dayDone}/{dayTotal} дел</span>
              <button type="button" onClick={closeDay} title="Закрыть" aria-label="Закрыть"
                className="ml-auto w-11 h-11 sm:w-8 sm:h-8 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 flex items-center justify-center self-center"><X size={15} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 sm:px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
              {selPays.length > 0 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Оплаты</div>
                  <div className="space-y-2">
                    {selPays.map(p => (
                      <PayRow key={p.key} p={p} detailed onOpen={p.projectId ? () => { closeDay(); openProject(p) } : undefined}
                        late={p.state === 'late' ? Math.max(1, differenceInCalendarDays(asDate(todayKey), asDate(p.date))) : undefined} />
                    ))}
                  </div>
                  <p className="text-xs text-surface-500 dark:text-surface-400 mt-2 mb-5">
                    Оплату записывает основатель в «Финансах» — здесь она сама станет «получено».
                  </p>
                </>
              )}
              <div className="text-[11px] font-bold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Задачи</div>
              <OwnDayTasks dayKey={selKey} todayKey={todayKey} own={own} autoFocus={ownFocus} />
              {selPays.length === 0 && ownSel.length === 0 && (
                <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-6">На этот день оплат и задач нет</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Окошко своих задач у клетки дня — только на компьютере. */}
      {ownPop && (
        <OwnPopover anchor={ownPop.el} dayKey={ownPop.day} todayKey={todayKey} own={own} onClose={() => setOwnPop(null)} />
      )}
    </section>
  )
}

/** Строка оплаты в окне дня. Отметки нет: оплату записывают в «Финансах». */
function PayRow({ p, late, detailed, onOpen }: { p: SalesCalPay; late?: number; detailed?: boolean; onOpen?: () => void }) {
  const paid = isPaid(p)
  const state = p.state === 'late' ? (
    <span className="text-[11px] font-bold text-red-500 dark:text-red-400 shrink-0">
      <span className="hidden sm:inline">срок был {shortDay(p.date)} · </span>
      {late} {plural(late || 0, 'день', 'дня', 'дней')}
    </span>
  ) : p.state === 'today' ? <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 shrink-0">срок сегодня</span>
    : paid ? <span className="text-[11px] font-bold text-green-600 dark:text-green-400 shrink-0">получено</span>
    : <span className="text-[11px] font-semibold text-surface-500 dark:text-surface-400 shrink-0">ждём оплату</span>

  return (
    <div onClick={onOpen} className={clsx('relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition',
      onOpen && 'cursor-pointer hover:border-surface-300 dark:hover:border-surface-600',
      p.state === 'late' ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200/70 dark:border-red-900/40'
        : paid ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
        : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
      <div className={clsx('w-8 h-8 rounded-lg shrink-0 flex items-center justify-center', TILE[p.state])}><Wallet size={16} /></div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-[13.5px] font-semibold truncate text-surface-900 dark:text-surface-100">{p.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-nowrap overflow-hidden">
          <span className="text-[11px] text-surface-600 dark:text-surface-300 tabular-nums shrink-0">
            {p.amount == null ? '—' : `${money(p.amount)} с.`}{detailed ? <span className="hidden sm:inline"> · {payWhat(p)}</span> : null}
          </span>
          {state}
        </div>
      </div>
      {onOpen && (
        <button type="button" onClick={ev => { ev.stopPropagation(); onOpen() }} title="Открыть проект" aria-label="Открыть проект"
          className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-primary-600 hover:border-primary-400 flex items-center justify-center shrink-0 transition">
          <Info size={16} />
        </button>
      )}
    </div>
  )
}
