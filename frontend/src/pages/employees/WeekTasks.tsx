// «Задачи недели» — пятый вид на странице «Сотрудники»: кто чем занят на
// этой неделе. Только для основателя и админа; сотрудники свои задачи видят
// у себя в панели, как и раньше — их панели не меняются.
//
// В сетке ВСЯ нагрузка человека, из двух источников:
//   • контент-план — рилсы, посты, съёмка, монтаж, дизайн (синяя полоска),
//   • задачи, выданные руководством (фиолетовая полоска).
// Если показывать только выданное, сетка врёт: SMM-специалист с восемью
// рилсами выглядит незагруженным.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { employeesApi, tasksApi, contentPlanApi } from '@/services/api.service'
import useNarrow from '@/hooks/useNarrow'

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

/** Понедельник недели, в которую попадает дата. */
function monday(d: Date): Date {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}

const initials = (name?: string | null) => {
  const p = String(name || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

/** Этап подготовки словом — в чипе иначе не понять, что за карточка. */
const PREP: Record<string, string> = { shoot: 'Съёмка', edit: 'Монтаж', design: 'Дизайн' }

type Item = {
  id: string
  date: string
  title: string
  /** 'plan' — из контент-плана, 'task' — выдана руководством. */
  src: 'plan' | 'task'
  state: 'done' | 'late' | 'open'
  to?: string
}

export default function WeekTasks() {
  const navigate = useNavigate()
  const narrow = useNarrow(900)
  const [offset, setOffset] = useState(0)

  const start = useMemo(() => {
    const d = monday(new Date())
    d.setDate(d.getDate() + offset * 7)
    return d
  }, [offset])
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i); return iso(d)
    }),
    [start],
  )
  const from = days[0]
  const to = days[6]
  const today = iso(new Date())

  const { data: employees = [] } = useQuery<any[]>({ queryKey: ['employees'], queryFn: () => employeesApi.list() })
  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ['week-tasks', from, to],
    queryFn: () => tasksApi.list({ deadlineFrom: from, deadlineBefore: to }),
  })
  const { data: cal } = useQuery<any>({
    queryKey: ['week-plan', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
  })

  // ── Раскладываем обе ленты по людям и дням ─────────────────────────
  const { byPerson, pool } = useMemo(() => {
    const map = new Map<string, Map<string, Item[]>>()
    const put = (userId: string, it: Item) => {
      if (!map.has(userId)) map.set(userId, new Map())
      const d = map.get(userId)!
      if (!d.has(it.date)) d.set(it.date, [])
      d.get(it.date)!.push(it)
    }
    const unassigned: Item[] = []

    for (const t of (Array.isArray(tasks) ? tasks : [])) {
      if (t.status === 'cancelled') continue
      const date = String(t.deadline || '').slice(0, 10)
      if (!date || date < from || date > to) continue
      const done = t.status === 'done'
      const it: Item = {
        id: `t:${t.id}`, date, src: 'task',
        title: t.title || 'Задача',
        state: done ? 'done' : date < today ? 'late' : 'open',
        to: `/tasks/${t.id}`,
      }
      if (t.assigneeId) put(t.assigneeId, it)
      else unassigned.push(it)
    }

    for (const e of ((cal?.events ?? []) as any[])) {
      const date = String(e.date || '').slice(0, 10)
      if (!date || date < from || date > to || !e.assigneeId) continue
      const done = e.status === 'done' || e.status === 'published'
      const stage = e.prepStage ? PREP[e.prepStage] || '' : ''
      const name = e.title || e.topic || (e.kind === 'shoot' ? 'Съёмка' : 'Публикация')
      put(e.assigneeId, {
        id: `p:${e.id}`, date, src: 'plan',
        title: stage ? `${stage} · ${name}` : name,
        state: done ? 'done' : date < today ? 'late' : 'open',
      })
    }
    return { byPerson: map, pool: unassigned }
  }, [tasks, cal, from, to, today])

  // ── Люди по отделам, как в оргструктуре ────────────────────────────
  const groups = useMemo(() => {
    const active = (Array.isArray(employees) ? employees : []).filter((e: any) => e.status === 'active' && e.userId)
    const dep = (role?: string | null) => {
      if (['smm_specialist', 'smm_director', 'designer', 'targetologist'].includes(role || '')) return 'SMM'
      if (['videographer', 'video_editor'].includes(role || '')) return 'Видеография'
      if (['developer', 'pm_dev', 'dev_director'].includes(role || '')) return 'Разработка'
      if (['sales_manager_smm', 'sales_manager_dev'].includes(role || '')) return 'Продажи'
      return 'Прочие'
    }
    const order = ['SMM', 'Видеография', 'Разработка', 'Продажи', 'Прочие']
    const out = new Map<string, any[]>()
    for (const e of active) {
      const key = dep(e.user?.role)
      if (!out.has(key)) out.set(key, [])
      out.get(key)!.push(e)
    }
    return order.filter(k => out.has(k)).map(k => ({ dep: k, people: out.get(k)! }))
  }, [employees])

  const statsOf = (userId: string) => {
    const byDay = byPerson.get(userId)
    let all = 0, done = 0, plan = 0, task = 0
    if (byDay) {
      for (const list of byDay.values()) {
        for (const it of list) {
          all += 1
          if (it.state === 'done') done += 1
          if (it.src === 'task') task += 1; else plan += 1
        }
      }
    }
    return { all, done, plan, task }
  }

  const label = `${start.getDate()} — ${new Date(start.getTime() + 6 * 864e5).getDate()} ${MON[new Date(start.getTime() + 6 * 864e5).getMonth()]}`

  const nav = (
    <div className="flex items-center gap-2">
      <button onClick={() => setOffset(o => o - 1)} aria-label="Прошлая неделя"
        className="w-11 h-11 rounded-xl border border-surface-200 dark:border-surface-700 flex items-center justify-center text-surface-500">
        <ChevronLeft size={18} />
      </button>
      <span className="min-w-[164px] text-center text-[15px] font-bold">{label}</span>
      <button onClick={() => setOffset(o => o + 1)} aria-label="Следующая неделя"
        className="w-11 h-11 rounded-xl border border-surface-200 dark:border-surface-700 flex items-center justify-center text-surface-500">
        <ChevronRight size={18} />
      </button>
      {offset !== 0 && (
        <button onClick={() => setOffset(0)}
          className="min-h-[44px] px-3 rounded-xl border border-surface-200 dark:border-surface-700 text-[13px] font-semibold text-surface-600 dark:text-surface-300">
          Эта неделя
        </button>
      )}
    </div>
  )

  const chip = (it: Item) => (
    <button key={it.id} type="button" onClick={() => it.to && navigate(it.to)}
      title={it.title}
      className={clsx(
        'w-full flex items-center gap-1.5 px-1.5 py-1 rounded-lg border text-left',
        it.state === 'done' ? 'border-green-500/30 bg-green-500/10'
          : it.state === 'late' ? 'border-red-500/30 bg-red-500/10'
            : 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60',
      )}>
      <i className={clsx('w-[3px] self-stretch rounded-sm shrink-0', it.src === 'task' ? 'bg-primary-500' : 'bg-sky-500')} />
      <span className={clsx('min-w-0 truncate text-[11px] leading-tight',
        it.state === 'done' ? 'line-through text-green-700 dark:text-green-400'
          : it.state === 'late' ? 'text-red-700 dark:text-red-400'
            : 'text-surface-700 dark:text-surface-200')}>{it.title}</span>
    </button>
  )

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-surface-500 dark:text-surface-400">
      <span className="inline-flex items-center gap-1.5"><i className="w-[3px] h-3 rounded-sm bg-sky-500" />из контент-плана</span>
      <span className="inline-flex items-center gap-1.5"><i className="w-[3px] h-3 rounded-sm bg-primary-500" />выдана вами</span>
      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-green-500/40" />сделано</span>
      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-red-500/40" />просрочено</span>
    </div>
  )

  // ── Телефон: список людей с полоской недели ────────────────────────
  if (narrow) {
    return (
      <div className="space-y-4">
        {nav}
        {groups.map(g => (
          <div key={g.dep} className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400">{g.dep}</div>
            {g.people.map((e: any) => {
              const s = statsOf(e.userId)
              return (
                <div key={e.id} className="card p-3 space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-[12px] font-bold shrink-0">{initials(e.fullName)}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[13.5px] font-semibold truncate">{e.fullName}</b>
                      <span className="block text-[11.5px] text-surface-500 truncate">{e.position || '—'}</span>
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">
                      {s.done}<span className="text-surface-400">/{s.all}</span>
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {days.map((d, i) => {
                      const list = byPerson.get(e.userId)?.get(d) ?? []
                      const late = list.some(x => x.state === 'late')
                      const allDone = list.length > 0 && list.every(x => x.state === 'done')
                      return (
                        <span key={d} className="flex-1 flex flex-col items-center gap-1">
                          <span className={clsx('w-full h-4 rounded border',
                            late ? 'bg-red-500/30 border-red-500/45'
                              : allDone ? 'bg-green-500/30 border-green-500/45'
                                : list.length ? 'bg-surface-200 dark:bg-surface-700 border-surface-300 dark:border-surface-600'
                                  : 'border-surface-200 dark:border-surface-800')} />
                          <span className={clsx('text-[9px]', d === today ? 'text-primary-500 font-bold' : 'text-surface-400')}>{WD[i].toLowerCase()}</span>
                        </span>
                      )
                    })}
                  </div>
                  <div className="text-[11px] text-surface-500">{s.plan} план · {s.task} выдано</div>
                </div>
              )
            })}
          </div>
        ))}
        {legend}
      </div>
    )
  }

  // ── Компьютер: сетка «люди × дни» ──────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">{nav}</div>

      {pool.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-surface-400">Не распределено</span>
            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11.5px] font-bold tabular-nums">{pool.length}</span>
            <span className="text-[12px] text-surface-500">задачи без исполнителя</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pool.map(it => (
              <button key={it.id} type="button" onClick={() => it.to && navigate(it.to)}
                className="px-2.5 py-1.5 rounded-xl border border-dashed border-surface-300 dark:border-surface-600 text-[12px] font-medium">
                {it.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="grid" style={{ gridTemplateColumns: '232px repeat(7, minmax(0, 1fr)) 92px' }}>
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-surface-400 border-b border-surface-100 dark:border-surface-700">Сотрудник</div>
          {days.map((d, i) => (
            <div key={d} className={clsx('px-2 py-2 border-b border-surface-100 dark:border-surface-700',
              i >= 5 && 'bg-surface-50 dark:bg-surface-800/50')}>
              <span className={clsx('text-[11px] font-bold uppercase tracking-wide', d === today ? 'text-primary-500' : 'text-surface-400')}>{WD[i]}</span>
              <span className={clsx('ml-1.5 text-[11px] tabular-nums', d === today ? 'text-primary-500' : 'text-surface-400')}>{Number(d.slice(8))}</span>
            </div>
          ))}
          <div className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-surface-400 border-b border-surface-100 dark:border-surface-700">Итог</div>

          {groups.map(g => (
            <div key={g.dep} className="contents">
              <div className="col-span-9 px-3 py-1.5 bg-surface-50 dark:bg-surface-800/60 border-b border-surface-100 dark:border-surface-700
                              text-[10.5px] font-bold uppercase tracking-wide text-surface-400">{g.dep}</div>
              {g.people.map((e: any) => {
                const s = statsOf(e.userId)
                return (
                  <div key={e.id} className="contents">
                    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-r border-surface-100 dark:border-surface-700 min-h-[72px]">
                      <span className="w-8 h-8 rounded-[10px] bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-[11px] font-bold shrink-0">{initials(e.fullName)}</span>
                      <span className="min-w-0">
                        <b className="block text-[12.5px] font-semibold truncate">{e.fullName}</b>
                        <span className="block text-[10.5px] text-surface-500 truncate">{e.position || '—'}</span>
                      </span>
                    </div>
                    {days.map((d, i) => (
                      <div key={d} className={clsx('px-1.5 py-1.5 border-b border-r border-surface-100 dark:border-surface-700 flex flex-col gap-1 min-w-0',
                        i >= 5 && 'bg-surface-50 dark:bg-surface-800/50')}>
                        {(byPerson.get(e.userId)?.get(d) ?? []).map(chip)}
                      </div>
                    ))}
                    <div className="flex flex-col items-end justify-center gap-1 px-2 py-2 border-b border-surface-100 dark:border-surface-700">
                      <span className={clsx('text-[13px] font-semibold tabular-nums',
                        s.all > 0 && s.done === s.all ? 'text-green-600 dark:text-green-400' : 'text-surface-700 dark:text-surface-200')}>
                        {s.done}<span className="text-surface-400">/{s.all}</span>
                      </span>
                      <span className="flex gap-0.5 w-full h-1">
                        <i className="rounded-sm bg-sky-500" style={{ flex: s.plan || 0.001 }} />
                        <i className="rounded-sm bg-primary-500" style={{ flex: s.task || 0.001 }} />
                      </span>
                      <span className="text-[9.5px] text-surface-400">{s.plan} план · {s.task} выд.</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {legend}
    </div>
  )
}
