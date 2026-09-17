// Кабинет производства — видеограф, монтажёр, дизайнер.
//
// Один компонент на три роли намеренно: показываем не «задачи роли», а то,
// что назначено ЛИЧНО человеку (content_plan_items.assigneeId). Поэтому
// «Видеограф / Монтажёр» второй ролью видит и съёмки, и монтаж в одном
// списке — ярлык у каждой карточки свой, и разделять кабинеты не нужно.
//
// Строение повторяет кабинет СММ-специалиста: цифры дня, мини-месяц,
// модальное окно дня, просрочка. Но ячейка календаря другая: у этих людей
// задача всегда одного вида, и точки по типам ничего не говорят. Вместо них
// тепловая карта — чем больше работы в дне, тем насыщеннее ячейка; день,
// где всё сдано, помечен галочкой.
import { useMemo, useState, useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday,
  addMonths, format, subDays, differenceInCalendarDays,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Camera, Scissors, Palette, Film, Image as ImageIcon,
  ChevronLeft, ChevronRight, AlertTriangle, Check, CalendarDays, X,
} from 'lucide-react'
import clsx from 'clsx'
import { contentPlanApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

const dk = (d: Date) => format(d, 'yyyy-MM-dd')
const WEEK = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

type Item = {
  id: string; projectId: string; projectName: string
  stage: 'shoot' | 'edit' | 'design' | null
  topic: string | null; status: string; date: string
  time: string | null; durationMin: number | null
  contentType?: string | null
  parentId: string | null; parentTopic: string | null; parentType: string | null
  parentDate: string | null; scriptText: string | null
}

/** Ярлык, иконка и цвет по этапу. Карточка без этапа — это публикация,
 *  назначенная лично (пока такого не бывает, но пусть не ломается). */
// rgb — для тепловой заливки ячейки (насыщенность считается от числа задач,
// поэтому цвет задаётся инлайном, а не классом).
const STAGE = {
  shoot:  { label: 'Съёмка', Icon: Camera,   cls: 'text-lime-600 dark:text-lime-400 bg-lime-500/12',          rgb: '132,204,22' },
  edit:   { label: 'Монтаж', Icon: Scissors, cls: 'text-violet-500 dark:text-violet-400 bg-violet-500/12',    rgb: '139,92,246' },
  design: { label: 'Дизайн', Icon: Palette,  cls: 'text-fuchsia-500 dark:text-fuchsia-400 bg-fuchsia-500/12', rgb: '217,70,239' },
} as const

type Meta = { label: string; Icon: any; cls: string; rgb: string }
function meta(it: Item): Meta {
  if (it.stage && STAGE[it.stage]) return STAGE[it.stage]
  return it.contentType === 'reel'
    ? { label: 'Рилс', Icon: Film, cls: 'text-blue-500 dark:text-blue-400 bg-blue-500/12', rgb: '59,130,246' }
    : { label: 'Макет', Icon: ImageIcon, cls: 'text-amber-500 dark:text-amber-400 bg-amber-500/12', rgb: '245,158,11' }
}

/** Заливка дня: цвет — преобладающий этап, насыщенность — от объёма.
 *  У «Видеографа / Монтажёра» день со съёмкой и монтажом красится в тот
 *  цвет, которого больше. Потолок 45%, чтобы число оставалось читаемым. */
function heatStyle(list: Item[]): CSSProperties | undefined {
  if (!list.length) return undefined
  const count = new Map<string, number>()
  for (const it of list) count.set(meta(it).rgb, (count.get(meta(it).rgb) || 0) + 1)
  const rgb = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const alpha = Math.min(0.45, 0.10 + list.length * 0.06)
  return { background: `rgba(${rgb},${alpha.toFixed(2)})` }
}
/** Название: у карточки подготовки оно у родителя («Reels #4»), у своей — своё. */
const titleOf = (it: Item) =>
  (it.parentTopic && it.parentTopic.trim()) || (it.topic && it.topic.trim()) || 'Без названия'
const isDone = (it: Item) => it.status === 'published'
const isCancelled = (it: Item) => it.status === 'cancelled'
const shortDay = (d?: string | null) => (d ? format(new Date(d + 'T00:00:00'), 'd MMM', { locale: ru }) : '')

function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10, h = n % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few
  return many
}

export default function ProductionDashboard() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [cursor, setCursor] = useState(() => new Date())
  const [sel, setSel] = useState(() => new Date())
  const [dayOpen, setDayOpen] = useState(false)
  const closeDay = () => setDayOpen(false)
  // Escape закрывает окно дня — как везде в системе.
  useEffect(() => {
    if (!dayOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDay() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dayOpen])

  const from = dk(startOfMonth(cursor))
  const to = dk(endOfMonth(cursor))
  const selKey = dk(sel)
  const todayKey = dk(new Date())

  const { data } = useQuery({ queryKey: ['my-work', from, to], queryFn: () => contentPlanApi.myWork(from, to) })
  // Просрочку ищем шире месяца: задача могла повиснуть в прошлом.
  const overdueFrom = useMemo(() => dk(subDays(new Date(), 90)), [])
  const { data: pastData } = useQuery({
    queryKey: ['my-work-overdue', overdueFrom, todayKey],
    queryFn: () => contentPlanApi.myWork(overdueFrom, todayKey),
  })

  const items: Item[] = data?.items ?? []
  const byDay = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const it of items) if (it.date) (m[it.date] ||= []).push(it)
    return m
  }, [items])

  const overdue = useMemo(() => {
    const list = (pastData?.items ?? []) as Item[]
    return list
      .filter(it => it.date && it.date < todayKey && !isDone(it) && !isCancelled(it))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [pastData, todayKey])
  const overdueByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of overdue) m[it.date] = (m[it.date] || 0) + 1
    return m
  }, [overdue])

  const todayItems = byDay[todayKey] || []
  const todayLeft = todayItems.filter(it => !isDone(it) && !isCancelled(it)).length
  const monthDone = items.filter(isDone).length

  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => contentPlanApi.myWorkDone(v.id, v.done),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-work'] })
      qc.invalidateQueries({ queryKey: ['my-work-overdue'] })
    },
  })

  const days = eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) })
  const pad = (getDay(startOfMonth(cursor)) + 6) % 7
  const goMonth = (n: number) => setCursor(c => addMonths(c, n))
  const selItems = (byDay[selKey] || []).slice().sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))

  return (
    <div className="space-y-4">
      {/* Сводка дня */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold">Сегодня</h1>
            <p className="text-[12.5px] text-surface-500 dark:text-surface-400">
              {todayLeft > 0
                ? `Осталось: ${todayLeft} ${plural(todayLeft, 'задача', 'задачи', 'задач')}`
                : todayItems.length > 0 ? 'Всё на сегодня сделано' : 'На сегодня задач нет'}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Tile value={String(overdue.length)} label="просрочено" tone={overdue.length > 0 ? 'bad' : undefined} />
            <Tile value={String(monthDone)} label={`сдано за ${format(cursor, 'LLLL', { locale: ru })}`} tone={monthDone > 0 ? 'ok' : undefined} />
            <Tile value={String(todayItems.length)} label="задач сегодня" />
          </div>
        </div>
      </div>

      {/* Мини-месяц */}
      <div className="card">
        <div className="flex items-center justify-center gap-4 mb-3">
          <button onClick={() => goMonth(-1)} className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronLeft size={16} /></button>
          <b className="text-sm font-bold capitalize min-w-[130px] text-center">{format(cursor, 'LLLL yyyy', { locale: ru })}</b>
          <button onClick={() => goMonth(1)} className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK.map(w => <div key={w} className="text-center text-[9.5px] font-bold uppercase text-surface-400 dark:text-surface-500 pb-1">{w}</div>)}
          {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} />)}
          {days.map(d => {
            const key = dk(d)
            const list = byDay[key] || []
            const late = overdueByDay[key] || 0
            const t = isToday(d)
            const allDone = list.length > 0 && list.every(it => isDone(it) || isCancelled(it))
            return (
              <button
                key={key}
                onClick={() => { setSel(d); setDayOpen(true) }}
                style={heatStyle(list)}
                className={clsx(
                  'min-h-[58px] rounded-xl border p-1.5 flex flex-col text-left transition',
                  // Сегодня — рамка с ореолом; выбранный день не подсвечиваем: его
                  // показывает открытое окно.
                  !list.length && 'bg-surface-50 dark:bg-surface-800/40',
                  t ? 'border-primary-500 ring-[3px] ring-primary-500/20'
                    : late > 0 ? 'border-red-300 dark:border-red-800/70'
                    : 'border-surface-100 dark:border-surface-700/60 hover:border-surface-300 dark:hover:border-surface-600',
                )}
              >
                <span className={clsx('text-[11px] font-bold text-right leading-none', t ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400 dark:text-surface-500')}>{format(d, 'd')}</span>
                {/* Всё сдано — галочка; иначе сколько задач в дне. Пустой день пуст. */}
                {list.length > 0 && (
                  allDone
                    ? <Check size={16} strokeWidth={3} className="mt-auto text-emerald-500 dark:text-emerald-400" />
                    : <span className="mt-auto text-[17px] font-bold tabular-nums leading-none text-surface-700 dark:text-surface-100">{list.length}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Окно дня — снизу на телефоне, по центру на компьютере; как у СММ. */}
      {dayOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeDay} />
          <div role="dialog" aria-label="Задачи дня"
            className="relative w-full sm:max-w-xl max-h-[88vh] sm:max-h-[85vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] sm:rounded-2xl sm:border border-surface-200 dark:border-surface-700 shadow-2xl">
            <div className="sm:hidden pt-2 pb-1"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
            <div className="flex items-baseline gap-2.5 px-4 sm:px-5 pt-3 sm:pt-4 pb-3">
              <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 first-letter:uppercase">
                {isToday(sel) ? 'Сегодня' : format(sel, 'd MMMM, EEEE', { locale: ru })}
              </h2>
              <span className="text-xs text-surface-400 dark:text-surface-500">
                {selItems.filter(isDone).length}/{selItems.length} {plural(selItems.length, 'задача', 'задачи', 'задач')}
              </span>
              <button onClick={closeDay} title="Закрыть"
                className="ml-auto w-8 h-8 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 flex items-center justify-center self-center"><X size={15} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 sm:px-5 py-2 pb-[max(14px,env(safe-area-inset-bottom))]">
              {selItems.length === 0 ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-6">На этот день задач нет</p>
              ) : (
                <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {selItems.map(it => <Row key={it.id} it={it} onToggle={() => toggle.mutate({ id: it.id, done: !isDone(it) })} />)}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Просроченное */}
      {overdue.length > 0 && (
        <div className="card border-red-200/70 dark:border-red-900/40">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={15} /> Просрочено · {overdue.length}
          </h2>
          <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
            {overdue.map(it => (
              <Row key={it.id} it={it} late={Math.max(1, differenceInCalendarDays(new Date(todayKey + 'T00:00:00'), new Date(it.date + 'T00:00:00')))}
                onToggle={() => toggle.mutate({ id: it.id, done: true })} />
            ))}
          </div>
        </div>
      )}

      {user?.name && <p className="text-[11px] text-surface-400 text-center pb-2">Показаны задачи, назначенные лично вам</p>}
    </div>
  )
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-xl bg-surface-50 dark:bg-surface-800/40 border border-surface-100 dark:border-surface-700/60 px-3 py-2 min-w-[92px]">
      <b className={clsx('block text-[17px] font-bold tabular-nums leading-none',
        tone === 'bad' ? 'text-red-500 dark:text-red-400' : tone === 'ok' ? 'text-emerald-500 dark:text-emerald-400' : '')}>{value}</b>
      <span className="block text-[10px] text-surface-500 dark:text-surface-400 mt-1">{label}</span>
    </div>
  )
}

function Row({ it, onToggle, late }: { it: Item; onToggle: () => void; late?: number }) {
  const m = meta(it)
  const done = isDone(it)
  return (
    <div className="py-2.5 flex items-start gap-3">
      <button
        type="button"
        onClick={onToggle}
        title={done ? 'Снять отметку' : 'Отметить готово'}
        className={clsx('w-[18px] h-[18px] rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition',
          done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-surface-300 dark:border-surface-600 hover:border-emerald-500')}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={clsx('text-[13.5px] font-semibold truncate', done && 'line-through text-surface-400 dark:text-surface-500')}>
          {titleOf(it)}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] text-surface-500 dark:text-surface-400">
          <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold text-[9.5px] uppercase tracking-wide', m.cls)}>
            <m.Icon size={10} /> {m.label}
          </span>
          <span className="truncate">{it.projectName}</span>
          {it.parentDate && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={11} /> выход {shortDay(it.parentDate)}
            </span>
          )}
          {late ? <span className="text-red-500 dark:text-red-400 font-medium">{late} {plural(late, 'день', 'дня', 'дней')}</span> : null}
        </div>
      </div>
      {it.time && <span className="text-[11px] tabular-nums text-surface-500 dark:text-surface-400 shrink-0 mt-0.5">{it.time}</span>}
    </div>
  )
}
