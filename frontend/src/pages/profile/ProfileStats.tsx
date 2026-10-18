// Аналитика личного профиля — вариант Б, коротко (макет владельца 17.10.2026):
// серии, эффективность месяца (та же, что в KPI команды), бонус, цели месяца
// и достижения. Подсказок нет — только цифры и короткие подписи.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  BarChart3, CalendarCheck, Check, CheckCheck, Clock, Flame, Gauge, Image as ImageIcon, ListChecks, Lock,
  ShieldCheck, Smartphone, Star, Trophy,
} from 'lucide-react'
import { meApi, goalsApi, type ProfileStats, type ProfileGoal, type ProfileAchievement } from '@/services/api.service'

type Stats = Extract<ProfileStats, { visible: true }>

/** Русское склонение по числу. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = Math.abs(n) % 10, h = Math.abs(n) % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few
  return many
}

const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTH_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю']
const monthOf = (ym: string) => MONTH[Number(ym.slice(5, 7)) - 1] || ''
const monthDat = (ym: string) => MONTH_DAT[Number(ym.slice(5, 7)) - 1] || ''

/** «1 г. 7 мес.» — стаж в компании. */
export function tenureText(months: number): string {
  const y = Math.floor(months / 12), m = months % 12
  if (!y && !m) return 'меньше месяца'
  return [y ? `${y} г.` : null, m ? `${m} мес.` : null].filter(Boolean).join(' ')
}

export function useProfileStats() {
  return useQuery({ queryKey: ['me', 'profile-stats'], queryFn: meApi.profileStats, staleTime: 5 * 60_000 })
}

const pctTone = (p: number) => (p >= 80 ? 'bg-green-500' : p >= 50 ? 'bg-amber-400' : 'bg-red-500')
const pctText = (p: number) => (p >= 80 ? '' : p >= 50 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400')

function Bar({ value, tone, className }: { value: number; tone: string; className?: string }) {
  return (
    <div className={clsx('h-[7px] rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden', className)}>
      <div className={clsx('h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

// ── Уровень: в шапке профиля ──
export function LevelBar({ stats, className }: { stats: Stats; className?: string }) {
  const { level, points, from, to } = stats.level
  const pct = to > from ? ((points - from) / (to - from)) * 100 : 100
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline">
        <b className="text-[14px] font-bold text-amber-500 dark:text-amber-400">Уровень {level}</b>
        <span className="ml-auto text-xs text-surface-400 dark:text-surface-500 tabular-nums">
          {points.toLocaleString('ru-RU')} / {to.toLocaleString('ru-RU')}
        </span>
      </div>
      <Bar value={pct} tone="bg-amber-400" className="h-2" />
    </div>
  )
}

/** Номер уровня у аватара. */
export function LevelBadge({ level }: { level: number }) {
  return (
    <span className="absolute -right-1.5 -bottom-1.5 min-w-[24px] h-6 px-1 rounded-full bg-amber-400 text-[#2a2010] text-xs font-bold flex items-center justify-center border-[3px] border-white dark:border-surface-800">
      {level}
    </span>
  )
}

// ── Тело профиля ──
export default function ProfileStatsBody({ stats }: { stats: Stats }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <Tiles stats={stats} />
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-12">
        <Efficiency stats={stats} />
        <Bonus stats={stats} />
      </div>
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Goals goals={stats.goals} />
        <Achievements list={stats.achievements} />
      </div>
    </div>
  )
}

function Tile({ icon, tone, value, label }: { icon: React.ReactNode; tone: string; value: string; label: string }) {
  return (
    <div className="card !p-2.5 sm:!px-[18px] sm:!py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 min-w-0">
      <span className={clsx('w-[30px] h-[30px] sm:w-[38px] sm:h-[38px] rounded-[9px] sm:rounded-[10px] flex items-center justify-center shrink-0', tone)}>{icon}</span>
      <div className="flex flex-col min-w-0">
        <b className="text-base sm:text-[19px] font-bold leading-tight text-surface-900 dark:text-surface-100 tabular-nums">{value}</b>
        <span className="text-xs sm:text-[12.5px] leading-tight text-surface-400 dark:text-surface-500">{label}</span>
      </div>
    </div>
  )
}

function Tiles({ stats }: { stats: Stats }) {
  const { unit, current, best, shiftsNoLate } = stats.streak
  const word = (n: number) => unit === 'days' ? plural(n, 'день', 'дня', 'дней')
    : unit === 'cards' ? plural(n, 'карточка', 'карточки', 'карточек')
    : plural(n, 'задача', 'задачи', 'задач')
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <Tile icon={<Flame size={18} />} tone="bg-orange-400/15 text-orange-400"
        value={`${current} ${word(current)}`} label={unit === 'days' ? 'серия сторис' : 'в срок подряд'} />
      <Tile icon={<Clock size={18} />} tone="bg-emerald-400/15 text-emerald-400"
        value={`${shiftsNoLate} ${plural(shiftsNoLate, 'смена', 'смены', 'смен')}`} label="без опозданий" />
      <Tile icon={<Trophy size={18} />} tone="bg-amber-400/15 text-amber-400"
        value={`${best} ${word(best)}`} label="рекорд серии" />
    </div>
  )
}

function EffRing({ percent, size }: { percent: number | null; size: number }) {
  const C = 2 * Math.PI * 50
  const p = percent ?? 0
  const tone = p >= 80 ? 'text-green-500' : p >= 50 ? 'text-amber-400' : 'text-red-500'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={percent === null ? 'Эффективность: оценки нет' : `Эффективность ${percent} процентов`}>
        <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="11" className="text-surface-200 dark:text-surface-700" />
        {percent !== null && p > 0 && (
          <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" className={tone}
            strokeDasharray={`${((C * Math.min(100, p)) / 100).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 60 60)" />
        )}
      </svg>
      <b className="absolute inset-0 flex items-center justify-center font-bold text-surface-900 dark:text-surface-100 text-[20px] sm:text-[25px] tabular-nums">
        {percent === null ? '—' : `${percent} %`}
      </b>
    </div>
  )
}

function Efficiency({ stats }: { stats: Stats }) {
  const { percent, delta, prevYm, items } = stats.efficiency
  const chip = delta === null ? null : (
    <span className={clsx('self-start text-xs sm:text-[12.5px] font-semibold rounded-[7px] px-2 py-0.5 whitespace-nowrap',
      delta > 0 ? 'text-green-600 dark:text-green-400 bg-green-500/15'
        : delta < 0 ? 'text-amber-600 dark:text-amber-400 bg-amber-500/15'
        : 'text-surface-500 dark:text-surface-400 bg-surface-100 dark:bg-surface-700/60')}>
      {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta)} % к {monthDat(prevYm)}
    </span>
  )
  return (
    <section className="card lg:col-span-8 !p-4 sm:!px-[22px] sm:!py-[18px] flex flex-col sm:flex-row sm:items-center gap-3.5 sm:gap-6">
      <div className="flex items-center gap-3.5">
        <span className="sm:hidden"><EffRing percent={percent} size={84} /></span>
        <span className="hidden sm:block"><EffRing percent={percent} size={104} /></span>
        <div className="sm:hidden flex flex-col gap-1.5">
          <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Эффективность</h2>
          <span className="text-xs text-surface-400 dark:text-surface-500">{monthOf(stats.ym)}</span>
          {chip}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="hidden sm:flex items-center gap-2.5">
          <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Эффективность · {monthOf(stats.ym)}</h2>
          {chip}
        </div>
        {items.length === 0 ? (
          <p className="text-[13px] text-surface-400 dark:text-surface-500">За этот месяц оценки пока нет</p>
        ) : (
          <div className="flex flex-col gap-3 sm:gap-2">
            {items.map(it => (
              <div key={it.key} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[170px_minmax(0,1fr)_120px] items-center gap-x-3.5 gap-y-1.5 text-[13px] sm:text-[13.5px]">
                <span className="text-surface-600 dark:text-surface-300 truncate">{it.label}</span>
                <span className="sm:order-3 text-right whitespace-nowrap tabular-nums">
                  <b className={clsx('font-bold', pctText(it.percent))}>{it.percent} %</b>
                  {it.key !== 'deadline_rate' && <span className="ml-1.5 text-xs text-surface-400 dark:text-surface-500">{it.value} / {it.target}</span>}
                </span>
                <Bar value={it.percent} tone={pctTone(it.percent)} className="col-span-2 sm:col-span-1 sm:order-2" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Bonus({ stats }: { stats: Stats }) {
  const { threshold, amount, percent } = stats.bonus
  const reached = percent !== null && percent >= threshold
  return (
    <section className="card lg:col-span-4 !p-4 sm:!px-[22px] sm:!py-[18px] flex flex-col gap-2.5 sm:gap-3 justify-center">
      <div className="flex items-baseline">
        <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Бонус</h2>
        <b className="ml-auto text-lg sm:text-xl font-bold text-amber-500 dark:text-amber-400 tabular-nums">+{amount.toLocaleString('ru-RU')} с.</b>
      </div>
      <div className="relative pt-1">
        <Bar value={percent ?? 0} tone={reached ? 'bg-green-500' : 'bg-green-500/80'} className="h-[9px]" />
        <span className="absolute top-0 w-0.5 h-[17px] bg-amber-400" style={{ left: `${threshold}%` }} />
      </div>
      <div className="flex text-[12.5px] sm:text-[13px]">
        <span className="text-surface-400 dark:text-surface-500 tabular-nums">{percent === null ? '—' : percent} % из {threshold} %</span>
        <span className={clsx('ml-auto font-semibold', reached ? 'text-green-600 dark:text-green-400' : 'text-amber-500 dark:text-amber-400')}>
          {reached ? 'бонус в этом месяце' : `ещё ${threshold - (percent ?? 0)} %`}
        </span>
      </div>
    </section>
  )
}

/** «15 / 30 дней», «88 %» — сколько есть у измеримой цели. */
function goalValue(g: ProfileGoal): string {
  const v = g.value ?? 0
  if (g.metric === 'stories_days') return `${v} / ${g.target} ${plural(g.target || 0, 'дня', 'дней', 'дней')}`
  if (g.metric === 'ontime_shifts') return `${v} / ${g.target} ${plural(g.target || 0, 'смены', 'смен', 'смен')}`
  return g.value === null ? '—' : `${v} %`
}

export function GoalRowView({ g, onToggle, children }: { g: ProfileGoal; onToggle?: () => void; children?: React.ReactNode }) {
  if (!g.metric) {
    return (
      <div className="flex items-center gap-2.5 text-[13px] sm:text-[13.5px] min-h-[40px]">
        <button type="button" onClick={onToggle} disabled={!onToggle}
          aria-label={g.done ? 'Снять отметку «выполнено»' : 'Отметить выполненной'}
          className={clsx('w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 transition',
            g.done ? 'bg-green-500 border-green-500 text-white' : 'border-surface-300 dark:border-surface-600 hover:border-green-500')}>
          {g.done && <Check size={13} strokeWidth={3} />}
        </button>
        <span className={clsx('flex-1 min-w-0', g.done ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-800 dark:text-surface-100')}>{g.title}</span>
        {g.done && <span className="text-green-600 dark:text-green-400 font-semibold shrink-0">выполнено</span>}
        {children}
      </div>
    )
  }
  const pct = g.target ? ((g.value ?? 0) / g.target) * 100 : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[13px] sm:text-[13.5px]">
        <span className="flex-1 min-w-0 text-surface-800 dark:text-surface-100">{g.title}</span>
        {g.reached
          ? <span className="text-green-600 dark:text-green-400 font-semibold shrink-0">выполнено</span>
          : <span className="text-xs text-surface-400 dark:text-surface-500 tabular-nums shrink-0">{goalValue(g)}</span>}
        {children}
      </div>
      <Bar value={g.reached ? 100 : pct} tone={g.reached ? 'bg-green-500' : 'bg-blue-400'} />
    </div>
  )
}

function Goals({ goals }: { goals: ProfileGoal[] }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: (g: ProfileGoal) => goalsApi.update(g.id, { done: !g.done }),
    onMutate: (g) => {
      qc.setQueryData<ProfileStats>(['me', 'profile-stats'], (old) => old && old.visible
        ? { ...old, goals: old.goals.map(x => (x.id === g.id ? { ...x, done: !g.done, reached: !g.done } : x)) }
        : old)
    },
    onError: (e: any) => { toast.error(e?.response?.data?.message || 'Не получилось отметить'); qc.invalidateQueries({ queryKey: ['me', 'profile-stats'] }) },
    onSuccess: (data: any) => { if (data?.visible) qc.setQueryData(['me', 'profile-stats'], data) },
  })
  const done = goals.filter(g => g.reached).length
  return (
    <section className="card !p-4 sm:!px-[22px] sm:!py-[18px] flex flex-col gap-3.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Цели месяца</h2>
        {goals.length > 0 && <span className="text-xs text-surface-400 dark:text-surface-500">{done} из {goals.length}</span>}
      </div>
      {goals.length === 0
        ? <p className="text-[13px] text-surface-400 dark:text-surface-500">Целей на этот месяц нет</p>
        : goals.map(g => <GoalRowView key={g.id} g={g} onToggle={g.metric ? undefined : () => toggle.mutate(g)} />)}
    </section>
  )
}

const ACH_ICON: Record<string, any> = {
  no_late_month: Clock, year1: Star, year2: Star, best_month: BarChart3, eff95: Gauge, three_months: CalendarCheck,
  ontime10: ListChecks, ontime30: ListChecks, no_overdue_month: ShieldCheck, stories_month: Smartphone,
  stories_streak30: Flame, stories1000: ImageIcon, content50: CheckCheck, content100: CheckCheck, tasks50: CheckCheck, tasks100: CheckCheck,
}
const ACH_TONE = [
  'text-emerald-400 bg-emerald-400/15', 'text-violet-400 bg-violet-400/15', 'text-blue-300 bg-blue-400/15', 'text-amber-400 bg-amber-400/15',
]

function Achievements({ list }: { list: ProfileAchievement[] }) {
  const [open, setOpen] = useState(false)
  const unlocked = list.filter(a => a.unlocked)
  const locked = list.filter(a => !a.unlocked)
  return (
    <section className="card !p-4 sm:!px-[22px] sm:!py-[18px] flex flex-col gap-3.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">Достижения</h2>
        <span className="text-xs text-surface-400 dark:text-surface-500">{unlocked.length} из {list.length}</span>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-x-2 gap-y-3.5">
        {unlocked.map((a, i) => {
          const Icon = ACH_ICON[a.key] || Star
          return (
            <div key={a.key} className="flex flex-col items-center gap-1.5 text-center">
              <span className={clsx('w-[46px] h-[46px] sm:w-12 sm:h-12 rounded-full border-2 border-current flex items-center justify-center', ACH_TONE[i % ACH_TONE.length])}>
                <Icon size={20} />
              </span>
              <b className="text-xs font-semibold leading-tight text-surface-800 dark:text-surface-100">{a.title}</b>
            </div>
          )
        })}
        {locked.length > 0 && (
          <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
            aria-label={open ? 'Скрыть закрытые достижения' : `Ещё ${locked.length} закрытых достижений`}
            className="flex flex-col items-center gap-1.5 text-center text-surface-400 dark:text-surface-500">
            <span className="w-[46px] h-[46px] sm:w-12 sm:h-12 rounded-full border-2 border-dashed border-surface-300 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 flex items-center justify-center text-sm font-bold text-surface-500 dark:text-surface-300">
              {open ? '−' : `+${locked.length}`}
            </span>
            <span className="text-xs font-semibold leading-tight">{open ? 'скрыть' : 'ещё'}</span>
          </button>
        )}
      </div>
      {open && locked.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1 border-t border-surface-100 dark:border-surface-700/60">
          {locked.map(a => (
            <div key={a.key} className="flex items-center gap-2.5 pt-2.5 min-w-0">
              <span className="w-9 h-9 rounded-full border-2 border-dashed border-surface-300 dark:border-surface-600 text-surface-400 dark:text-surface-500 flex items-center justify-center shrink-0"><Lock size={15} /></span>
              <div className="min-w-0 flex-1 flex flex-col gap-1">
                <span className="text-xs font-semibold leading-tight text-surface-600 dark:text-surface-300">{a.title}</span>
                {a.progress && (
                  <>
                    <Bar value={(a.progress.value / a.progress.target) * 100} tone="bg-surface-400" className="h-1" />
                    <span className="text-[11px] text-surface-400 dark:text-surface-500 tabular-nums">{a.progress.value} из {a.progress.target}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
