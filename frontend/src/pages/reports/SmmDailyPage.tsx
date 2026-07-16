// Ежедневные отчёты СММ — автоотчёт для основателя. Ничего не заполняется
// руками: активность каждого сотрудника собирается из доски проектов
// (движение карточек), историй и задач. Видит только основатель.
import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { kpiApi } from '@/services/api.service'
import { PageLoader, EmptyState, Avatar } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { getCombinedRoleLabel } from '@/lib/permissions'
import {
  ClipboardList, ChevronLeft, ChevronRight, ChevronDown, Trello, Image as ImageIcon,
  CheckSquare, RotateCcw, Clock, Moon, RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'

interface DailyItem {
  at: string
  kind: 'stage' | 'return' | 'task' | 'story'
  text: string
  project: string | null
  onTime: boolean | null
  /** Минуты «в работе»: от получения (этап/назначение) до продвижения вперёд. */
  spentMinutes: number | null
}
interface DailyEmployee {
  id: string; name: string; avatar: string | null
  role: string; secondaryRole: string | null
  stagesDone: number; returns: number; storiesTotal: number; tasksDone: number; hours: number
  spentMinutes: number
  items: DailyItem[]
}
interface DailyReport {
  date: string
  employees: DailyEmployee[]
  totals: { stagesDone: number; storiesTotal: number; tasksDone: number; activeCount: number }
}

// «Сегодня» — по Душанбе (бизнес-зона отчёта), как на бэкенде, иначе при
// просмотре из другого пояса день по умолчанию не совпадал бы с отчётным.
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dushanbe' })

const shiftDay = (iso: string, delta: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return d.toLocaleDateString('en-CA')
}

const dayLabel = (iso: string) => {
  const s = new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Время события всегда по Душанбе — отчётный день считается в этой зоне,
// иначе при просмотре из другого пояса событ'я «уезжали» бы в соседний день.
const timeLabel = (at: string) =>
  new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' })

// «5 ч 20 м» / «45 м» из минут. Время календарное (ночь не вычитается).
const fmtDur = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  if (h > 0) return m > 0 ? `${h} ч ${m} м` : `${h} ч`
  return `${m} м`
}

const KIND_META: Record<DailyItem['kind'], { icon: any; cls: string }> = {
  stage:  { icon: Trello,     cls: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
  story:  { icon: ImageIcon,  cls: 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' },
  task:   { icon: CheckSquare, cls: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' },
  return: { icon: RotateCcw,  cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
}

export default function SmmDailyPage() {
  const [date, setDate] = useState(todayISO())
  const isToday = date === todayISO()

  const { data, isLoading, isError, isFetching, refetch } = useQuery<DailyReport>({
    queryKey: ['smm-daily', date],
    queryFn: () => kpiApi.smmDaily(date),
    // При листании дней держим прошлые данные — без вспышки полного лоадера.
    placeholderData: keepPreviousData,
  })

  const totals = data?.totals
  const employees = data?.employees || []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-primary-600" />
            <h1 className="page-title">Отчёты СММ</h1>
          </div>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            Автоматический ежедневный отчёт команды — собирается из доски проектов, историй и задач
          </p>
        </div>

        {/* Навигация по дням */}
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(shiftDay(date, -1))} title="Предыдущий день"
            className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700 text-surface-500">
            <ChevronLeft size={16} />
          </button>
          <div className="w-40"><DatePicker value={date} onChange={v => v && setDate(v)} clearable={false} allowFuture={false} /></div>
          <button onClick={() => setDate(shiftDay(date, 1))} disabled={date >= todayISO()} title="Следующий день"
            className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700 text-surface-500 disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronRight size={16} />
          </button>
          {!isToday && (
            <button onClick={() => setDate(todayISO())} className="btn-secondary text-xs">Сегодня</button>
          )}
        </div>
      </div>

      {isLoading ? <PageLoader /> : isError ? (
        <div className="card text-center py-10">
          <p className="text-sm text-surface-500 dark:text-surface-400 mb-3">Не удалось загрузить отчёт. Проверьте соединение и попробуйте ещё раз.</p>
          <button onClick={() => refetch()} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Повторить
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold text-surface-700 dark:text-surface-300 flex items-center gap-2">
            {dayLabel(date)}
            {isFetching && <RefreshCw size={12} className="animate-spin text-surface-400" />}
          </p>

          {/* Сводка дня по команде */}
          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Этапов доски', value: totals.stagesDone, icon: Trello },
                { label: 'Историй', value: totals.storiesTotal, icon: ImageIcon },
                { label: 'Задач', value: totals.tasksDone, icon: CheckSquare },
                { label: 'Активны', value: `${totals.activeCount} из ${employees.length}`, icon: Clock },
              ].map(s => (
                <div key={s.label} className="card flex items-center gap-3 py-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
                    <s.icon size={16} className="text-primary-600 dark:text-primary-400" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-surface-900 dark:text-surface-100 leading-tight">{s.value}</p>
                    <p className="text-[11px] text-surface-400">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {employees.length === 0 ? (
            <EmptyState title="Нет сотрудников СММ" description="В команде не найдено активных сотрудников СММ-ролей." />
          ) : (
            <div className="space-y-3">
              {employees.map(e => <EmployeeCard key={e.id} e={e} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EmployeeCard({ e }: { e: DailyEmployee }) {
  const idle = e.items.length === 0
  const [open, setOpen] = useState(true)

  const chips: { label: string; cls: string }[] = []
  if (e.stagesDone > 0) chips.push({ label: `Этапов: ${e.stagesDone}`, cls: 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' })
  if (e.storiesTotal > 0) chips.push({ label: `Историй: ${e.storiesTotal}`, cls: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400' })
  if (e.tasksDone > 0) chips.push({ label: `Задач: ${e.tasksDone}`, cls: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' })
  if (e.returns > 0) chips.push({ label: `Возвратов: ${e.returns}`, cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' })
  if (e.spentMinutes > 0) chips.push({ label: `⏱ ${fmtDur(e.spentMinutes)}`, cls: 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300' })

  return (
    <div className={clsx('card', idle && 'opacity-80')}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center gap-3 text-left">
        <Avatar name={e.name} src={e.avatar || undefined} size={38} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-surface-900 dark:text-surface-100 truncate">{e.name}</p>
          <p className="text-[11px] text-surface-400">{getCombinedRoleLabel(e.role, e.secondaryRole)}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {idle ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              <Moon size={11} /> Нет активности
            </span>
          ) : chips.map(c => (
            <span key={c.label} className={clsx('text-[11px] font-medium px-2 py-0.5 rounded-full', c.cls)}>{c.label}</span>
          ))}
          {e.hours > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 ml-1">
              <Clock size={11} /> {e.hours} ч
            </span>
          )}
          {!idle && (
            <ChevronDown size={14} className={clsx('text-surface-400 transition-transform ml-1', open && 'rotate-180')} />
          )}
        </div>
      </button>

      {open && !idle && (
        <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700/60 space-y-1.5">
          {e.items.map((it, i) => {
            const m = KIND_META[it.kind]
            const Icon = m.icon
            return (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <span className={clsx('w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5', m.cls)}>
                  <Icon size={12} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-surface-700 dark:text-surface-300">
                    {it.text}
                    {it.onTime === true && <span className="text-green-600 dark:text-green-400 text-xs ml-1.5">✓ в срок</span>}
                    {it.onTime === false && <span className="text-red-500 text-xs ml-1.5">позже срока</span>}
                    {it.spentMinutes != null && it.spentMinutes > 0 && (
                      <span className="text-xs text-surface-400 ml-1.5" title="От получения работы до продвижения вперёд (календарное время)">
                        ⏱ {fmtDur(it.spentMinutes)}
                      </span>
                    )}
                  </p>
                  {it.project && <p className="text-[11px] text-surface-400 truncate">{it.project}</p>}
                </div>
                <span className="text-[11px] text-surface-400 shrink-0 tabular-nums mt-1">
                  {it.kind === 'story' ? 'за день' : timeLabel(it.at)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
