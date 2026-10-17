// «Панель» менеджера по продажам (макет владельца 17.10.2026): устроена
// точь-в-точь как панель СММ-специалиста — шапка дня, календарь месяца,
// «Просрочено», окно дня и свои задачи, — но вместо рилсов и сторис в днях
// стоят деньги клиентов менеджера. Это то же, что владелец видит в
// «Финансы → Планирование»: ○ ждём, ● получено, красным — просрочено, с
// суммами. Оплату менеджер не отмечает — её записывают в «Финансах».
// Ниже — KPI звонков и встреч (владелец оставил его на виду).
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, Plus, Wallet, X } from 'lucide-react'
import { addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, getDay, isSameDay, isToday, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import { smmPaymentsApi, type SalesCalPay } from '@/services/api.service'
import { useOwnTasks, OwnDayTasks, OwnMark, OwnPopover, OwnBox, CellLines, CellPlus, PayDot, ownLines, type CellLine } from './OwnTasks'
import { Ring, Metric } from './DaySummary'
import SalesKpi from './SalesKpi'

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dk = (d: Date) => format(d, 'yyyy-MM-dd')
const asDate = (iso: string) => new Date(`${iso}T00:00:00`)
/** Сумма в сомони без копеек: «21 000». */
const money = (n: number) => Math.round(n).toLocaleString('ru-RU')
const shortDay = (iso: string) => format(asDate(iso), 'd MMM', { locale: ru })

/** Русское склонение по числу. */
function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, h = n % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few
  return many
}

const isPaid = (p: SalesCalPay) => p.state === 'paid'
const lineState = (p: SalesCalPay): CellLine['state'] => (isPaid(p) ? 'done' : p.state === 'late' ? 'late' : 'open')

/** За что оплата: «оплата за октябрь», «2-я часть», поступление без плана. */
function payWhat(p: SalesCalPay): string {
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

export default function SalesManagerDashboard() {
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(() => new Date())
  const [sel, setSel] = useState(() => new Date())
  const [dayOpen, setDayOpen] = useState(false)

  const from = dk(startOfMonth(cursor))
  const to = dk(endOfMonth(cursor))
  const selKey = dk(sel)
  const todayKey = dk(new Date())
  // Свои задачи менеджера — ставит себе сам, прямо в дне календаря.
  const own = useOwnTasks(todayKey)
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

  // Деньги месяца; просроченные сервер отдаёт всегда — для «Просрочено».
  const { data: cal } = useQuery({
    queryKey: ['sales-pay-calendar', from, to],
    queryFn: () => smmPaymentsApi.calendar(from, to),
    staleTime: 60_000,
  })
  const items = cal?.items || []

  const payByDay = useMemo(() => {
    const map: Record<string, SalesCalPay[]> = {}
    for (const p of items) if (p.date >= from && p.date <= to) (map[p.date] ||= []).push(p)
    for (const list of Object.values(map)) list.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.partNo - b.partNo)
    return map
  }, [items, from, to])

  // Просроченное: самые давние сверху.
  const overdue = useMemo(
    () => items.filter(p => p.state === 'late').sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ru')),
    [items],
  )

  // Цифры месяца для сводки: получено из ожидаемого и сколько клиентов оплатили.
  const month = useMemo(() => {
    const list = Object.values(payByDay).flat()
    const total = list.reduce((s, p) => s + p.amount, 0)
    const received = list.filter(isPaid).reduce((s, p) => s + p.amount, 0)
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

  // Выбранный день: оплаты и свои задачи — в одном счёте «дел».
  const selPays = payByDay[selKey] || []
  const ownSel = own.of(selKey)
  const dayTotal = selPays.length + ownSel.length
  const dayDone = selPays.filter(isPaid).length + ownSel.filter(t => t.done).length
  const paysLeft = selPays.filter(p => !isPaid(p)).length
  const tasksLeft = ownSel.filter(t => !t.done).length
  const summary = [
    paysLeft > 0 ? `${paysLeft} ${plural(paysLeft, 'оплата', 'оплаты', 'оплат')}` : null,
    tasksLeft > 0 ? `${tasksLeft} ${plural(tasksLeft, 'задача', 'задачи', 'задач')}` : null,
  ].filter(Boolean)

  // Телефон: суммы в ячейку не помещаются — тип точкой, объём её размером.
  const dotSize = (n: number) => (n >= 2 ? 'w-[7px] h-[7px]' : 'w-1.5 h-1.5')

  // Строки клетки на компьютере: оплаты дня (клиент и сумма), следом свои задачи.
  const cellLines = (key: string): CellLine[] => [
    ...(payByDay[key] || []).map((p): CellLine => ({ key: p.key, kind: 'pay', proj: p.name, text: money(p.amount), state: lineState(p) })),
    ...ownLines(own.of(key)),
  ]

  return (
    <div className="space-y-4">
      {/* Сводка дня — шапка как у СММ: слева кольцо и день, справа цифры.
          На телефоне цифры уходят вниз во всю ширину. */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Ring done={dayDone} total={dayTotal} unit="дел" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-extrabold text-surface-900 dark:text-surface-100 first-letter:uppercase leading-tight">
                {isToday(sel) ? 'Сегодня' : format(sel, 'EEEE, d MMMM', { locale: ru })}
              </h2>
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                {summary.length ? `Осталось: ${summary.join(' · ')}` : 'Всё закрыто — оплат и задач на этот день не осталось'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end sm:shrink-0">
            {overdue.length > 0 && <Metric value={String(overdue.length)} label="просрочено" tone="danger" />}
            <Metric
              value={`${money(month.received)}/${money(month.total)}`}
              label={`получено за ${format(cursor, 'LLLL', { locale: ru })}, с.`}
              bar={month.total > 0 ? Math.min(1, month.received / month.total) : 0}
            />
            <Metric value={String(month.clients)}
              label={`${plural(month.clients, 'клиент оплатил', 'клиента оплатили', 'клиентов оплатили')}`}
              tone={month.clients > 0 ? 'ok' : undefined} />
          </div>
        </div>
      </div>

      {/* Мини-месяц */}
      <div className="card">
        <div className="relative flex items-center justify-center gap-4 mb-3">
          <button onClick={() => goMonth(-1)} title="Прошлый месяц" className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronLeft size={16} /></button>
          <b className="text-sm font-bold capitalize min-w-[130px] text-center">{format(cursor, 'LLLL yyyy', { locale: ru })}</b>
          <button onClick={() => goMonth(1)} title="Следующий месяц" className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronRight size={16} /></button>
          {/* Своя задача на сегодня — в одно нажатие, не открывая день вручную. */}
          <button type="button" onClick={addOwnToday} title="Поставить себе задачу на сегодня"
            className="absolute right-0 top-0 h-8 px-2 sm:px-3 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 text-[12.5px] font-bold flex items-center gap-1.5">
            <Plus size={15} /><span className="hidden sm:inline">Своя задача</span>
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK.map(w => <div key={w} className="text-center text-[9.5px] font-bold uppercase text-surface-400 dark:text-surface-500 pb-1">{w}</div>)}
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
                data-own-cell={key}
                onClick={openDay}
                onKeyDown={ev => {
                  if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openDay() }
                }}
                className={clsx(
                  'group min-h-[66px] sm:min-h-[104px] rounded-xl border p-1.5 flex flex-col sm:gap-1 text-left transition cursor-pointer',
                  // Сегодня — акцентная рамка с ореолом, выбранный день —
                  // пунктирный контур внутри ячейки (как у СММ).
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
                  <span className={clsx('text-[11px] font-bold', t ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400 dark:text-surface-500')}>{format(d, 'd')}</span>
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
        <div className="hidden sm:flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 text-[11px] text-surface-400 dark:text-surface-500">
          <span className="inline-flex items-center gap-1.5"><PayDot state="open" /> ждём оплату</span>
          <span className="inline-flex items-center gap-1.5"><PayDot state="done" /> получено</span>
          <span className="inline-flex items-center gap-1.5"><OwnBox /> своя задача</span>
          <span><span className="font-medium text-red-500 dark:text-red-400">красным</span> — просрочено</span>
          <span>суммы в сомони</span>
        </div>
        <div className="sm:hidden mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px] text-surface-400 dark:text-surface-500">
          <span className="inline-flex items-center gap-1.5"><i className="w-[7px] h-[7px] rounded-full bg-blue-400" /> ждём оплату</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-[7px] h-[7px] rounded-full bg-green-400" /> получено</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-[7px] h-[7px] rounded-full bg-red-500" /> просрочено</span>
          <span className="inline-flex items-center gap-1.5"><OwnMark className="w-[7px] h-[7px]" /> своя задача</span>
        </div>
        <p className="sm:hidden mt-1.5 text-center text-[11.5px] text-surface-400 dark:text-surface-500">
          нажмите на день — оплаты дня и своя задача
        </p>
        {cal && cal.clients === 0 && (
          <p className="mt-2 text-center text-xs text-surface-400 dark:text-surface-500">
            Своих клиентов пока нет — деньги появятся, когда основатель назначит вас менеджером проекта.
          </p>
        )}
      </div>

      {/* Просроченное */}
      {overdue.length > 0 && (
        <div className="card border-red-200/70 dark:border-red-900/40">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-red-500 dark:text-red-400 mb-2">
            <AlertTriangle size={13} /> Просрочено · {overdue.length}
          </div>
          <div className="space-y-2">
            {overdue.map(p => (
              <PayRow key={p.key} p={p} onOpen={p.projectId ? () => openProject(p) : undefined}
                late={Math.max(1, differenceInCalendarDays(asDate(todayKey), asDate(p.date)))} />
            ))}
          </div>
        </div>
      )}

      <SalesKpi />

      {/* Детали дня — модальное окно, открывается кликом по дню в календаре */}
      {dayOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeDay} />
          <div role="dialog" aria-label="Оплаты и задачи дня"
            className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] sm:rounded-2xl sm:border border-surface-200 dark:border-surface-700 shadow-2xl">
            <div className="sm:hidden pt-2 pb-1"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
            <div className="flex items-baseline gap-2.5 px-4 sm:px-5 pt-3 sm:pt-4 pb-3">
              <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 first-letter:uppercase">
                {isToday(sel) ? 'Сегодня' : format(sel, 'd MMMM, EEEE', { locale: ru })}
              </h2>
              <span className="text-xs text-surface-400 dark:text-surface-500">{dayDone}/{dayTotal} дел</span>
              <button onClick={closeDay} title="Закрыть"
                className="ml-auto w-8 h-8 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 flex items-center justify-center self-center"><X size={15} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 sm:px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
              {selPays.length > 0 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">Оплаты</div>
                  <div className="space-y-2">
                    {selPays.map(p => (
                      <PayRow key={p.key} p={p} detailed onOpen={p.projectId ? () => { closeDay(); openProject(p) } : undefined}
                        late={p.state === 'late' ? Math.max(1, differenceInCalendarDays(asDate(todayKey), asDate(p.date))) : undefined} />
                    ))}
                  </div>
                  <p className="text-xs text-surface-400 dark:text-surface-500 mt-2 mb-5">
                    Оплату записывает основатель в «Финансах» — здесь она сама станет «получено».
                  </p>
                </>
              )}
              <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">Задачи</div>
              <OwnDayTasks dayKey={selKey} todayKey={todayKey} own={own} autoFocus={ownFocus} />
              {selPays.length === 0 && ownSel.length === 0 && (
                <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-6">На этот день оплат и задач нет</p>
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
    </div>
  )
}

/** Строка оплаты — в окне дня и в «Просрочено», по виду как строка задачи
 *  у СММ. Отметки нет: оплату записывают в «Финансах». */
function PayRow({ p, late, detailed, onOpen }: { p: SalesCalPay; late?: number; detailed?: boolean; onOpen?: () => void }) {
  const paid = isPaid(p)
  const state = p.state === 'late' ? (
    <span className="text-[11px] font-bold text-red-500 dark:text-red-400 shrink-0">
      <span className="hidden sm:inline">срок был {shortDay(p.date)} · </span>
      {late} {plural(late || 0, 'день', 'дня', 'дней')}
    </span>
  ) : p.state === 'today' ? <span className="text-[11px] font-bold text-amber-500 dark:text-amber-400 shrink-0">срок сегодня</span>
    : paid ? <span className="text-[11px] font-bold text-green-600 dark:text-green-400 shrink-0">получено</span>
    : <span className="text-[11px] font-semibold text-surface-400 dark:text-surface-500 shrink-0">ждём оплату</span>

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
          {!detailed && (
            <span className="text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-block text-amber-500 dark:text-amber-400 bg-amber-500/12">Оплата</span>
          )}
          <span className="text-[11px] text-surface-600 dark:text-surface-300 tabular-nums shrink-0">
            {money(p.amount)} с.{detailed ? <span className="hidden sm:inline"> · {payWhat(p)}</span> : null}
          </span>
          {state}
        </div>
      </div>
      {onOpen && (
        <button onClick={ev => { ev.stopPropagation(); onOpen() }} title="Открыть проект" aria-label="Открыть проект"
          className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-primary-600 hover:border-primary-400 flex items-center justify-center shrink-0 transition">
          <Info size={16} />
        </button>
      )}
    </div>
  )
}
