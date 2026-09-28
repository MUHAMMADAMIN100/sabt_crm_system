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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Plus, RotateCcw } from 'lucide-react'
import { employeesApi, tasksApi, contentPlanApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
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
  const qc = useQueryClient()
  const narrow = useNarrow(900)
  const [offset, setOffset] = useState(0)
  /** Кому и на какой день выдаём — открывается «плюсом» в клетке. */
  const [issue, setIssue] = useState<{ userId: string; date: string } | null>(null)
  const [repeating, setRepeating] = useState(false)

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

  async function repeatLastWeek() {
    if (repeating) return
    setRepeating(true)
    try {
      const res = await tasksApi.repeatWeek(from)
      const n = Number(res?.created) || 0
      toast.success(n > 0
        ? `Перенесено задач: ${n}`
        : 'Переносить нечего — на прошлой неделе задач нет или они уже скопированы')
      qc.invalidateQueries({ queryKey: ['week-tasks'] })
    } catch {
      toast.error('Не удалось повторить неделю')
    } finally {
      setRepeating(false)
    }
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
      <button onClick={repeatLastWeek} disabled={repeating}
        title="Скопировать задачи прошлой недели на эту"
        className="min-h-[44px] px-3 rounded-xl border border-surface-200 dark:border-surface-700 text-[13px] font-semibold text-surface-600 dark:text-surface-300 inline-flex items-center gap-2 disabled:opacity-50">
        <RotateCcw size={15} />
        {repeating ? 'Копирую…' : 'Повторить прошлую неделю'}
      </button>
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
                  <button type="button" onClick={() => setIssue({ userId: e.userId, date: today })}
                    className="w-full min-h-[44px] rounded-xl border border-dashed border-surface-300 dark:border-surface-600
                               text-[13px] font-semibold text-primary-600 dark:text-primary-400">
                    + Выдать задачу
                  </button>
                </div>
              )
            })}
          </div>
        ))}
        {legend}
        {issue && (
          <IssueTask who={issue} days={days} employees={employees}
            onClose={() => setIssue(null)}
            onDone={() => { setIssue(null); qc.invalidateQueries({ queryKey: ['week-tasks'] }) }} />
        )}
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
                      <div key={d} className={clsx('group relative px-1.5 py-1.5 border-b border-r border-surface-100 dark:border-surface-700 flex flex-col gap-1 min-w-0',
                        i >= 5 && 'bg-surface-50 dark:bg-surface-800/50')}>
                        {(byPerson.get(e.userId)?.get(d) ?? []).map(chip)}
                        <button type="button" onClick={() => setIssue({ userId: e.userId, date: d })}
                          title="Выдать задачу на этот день"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                                     self-start mt-auto w-7 h-7 rounded-lg border border-dashed
                                     border-surface-300 dark:border-surface-600 text-surface-400
                                     flex items-center justify-center">
                          <Plus size={14} />
                        </button>
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

      {issue && (
        <IssueTask who={issue} days={days} employees={employees}
          onClose={() => setIssue(null)}
          onDone={() => { setIssue(null); qc.invalidateQueries({ queryKey: ['week-tasks'] }) }} />
      )}
    </div>
  )
}

/**
 * Выдача задачи из сетки. Открывается «плюсом» в клетке, поэтому человек и
 * день уже выбраны — их можно поменять, но чаще менять не нужно.
 *
 * Нескольким сразу: одна и та же задача («обзвон базы», «отчёт») часто
 * выдаётся отделу целиком, и заводить её по одному — лишняя работа.
 */
function IssueTask({ who, days, employees, onClose, onDone }: {
  who: { userId: string; date: string }
  days: string[]
  employees: any[]
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(who.date)
  const [ids, setIds] = useState<string[]>([who.userId])
  const [repeat, setRepeat] = useState(false)
  const [busy, setBusy] = useState(false)

  const people = useMemo(
    () => (Array.isArray(employees) ? employees : []).filter((e: any) => e.status === 'active' && e.userId),
    [employees],
  )
  const toggle = (id: string) => setIds(v => (v.includes(id) ? v.filter(x => x !== id) : [...v, id]))

  async function save() {
    const name = title.trim()
    if (!name || !ids.length || busy) return
    setBusy(true)
    try {
      // По задаче на человека: у каждого свой статус, и в сетке видно, кто
      // сделал, а кто нет. Одна задача на всех такой картины не даёт.
      await Promise.all(ids.map(id => tasksApi.create({
        title: name,
        assigneeId: id,
        deadline: date,
        fromFounder: true,
        repeatWeekly: repeat,
      })))
      toast.success(ids.length > 1 ? `Выдано ${ids.length} сотрудникам` : 'Задача выдана')
      onDone()
    } catch {
      toast.error('Не удалось выдать задачу')
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Выдать задачу" size="md">
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-[12px] font-semibold text-surface-500">Что сделать</span>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
            placeholder="Например, обзвонить базу по холодным лидам"
            className="input min-h-[48px]" />
        </label>

        <div className="space-y-1.5">
          <span className="text-[12px] font-semibold text-surface-500">Когда</span>
          <div className="flex gap-1.5">
            {days.map(d => (
              <button key={d} type="button" onClick={() => setDate(d)}
                className={clsx('flex-1 min-h-[48px] rounded-xl border flex flex-col items-center justify-center gap-0.5',
                  d === date
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                    : 'border-surface-200 dark:border-surface-700 text-surface-500')}>
                <span className="text-[10px]">{WD[(new Date(d + 'T00:00:00').getDay() + 6) % 7].toLowerCase()}</span>
                <b className="text-[14px]">{Number(d.slice(8))}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-[12px] font-semibold text-surface-500">Кому · выбрано {ids.length}</span>
          <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
            {people.map((e: any) => {
              const on = ids.includes(e.userId)
              return (
                <button key={e.id} type="button" onClick={() => toggle(e.userId)}
                  className={clsx('inline-flex items-center gap-2 min-h-[44px] px-3 rounded-full border text-[13px] font-semibold',
                    on
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                      : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300')}>
                  <i className="w-5 h-5 rounded-lg bg-surface-200 dark:bg-surface-700 not-italic text-[9px] font-bold flex items-center justify-center">
                    {initials(e.fullName)}
                  </i>
                  {String(e.fullName || '').split(' ')[0]}
                </button>
              )
            })}
          </div>
        </div>

        <label className="flex items-center gap-3 min-h-[48px] px-3 rounded-xl border border-primary-500/30 bg-primary-50/60 dark:bg-primary-500/10">
          <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)}
            className="w-5 h-5 accent-primary-600" />
          <span className="flex flex-col">
            <b className="text-[13.5px]">Повторять каждую неделю</b>
            <span className="text-[11.5px] text-surface-500">копия появится в тот же день следующей недели</span>
          </span>
        </label>

        <div className="flex gap-2">
          <button onClick={save} disabled={!title.trim() || !ids.length || busy}
            className="btn-primary flex-1 min-h-[48px] disabled:opacity-50">
            {busy ? 'Выдаю…' : ids.length > 1 ? `Выдать ${ids.length} сотрудникам` : 'Выдать'}
          </button>
          <button onClick={onClose} className="btn-secondary min-h-[48px] px-5">Отмена</button>
        </div>
      </div>
    </Modal>
  )
}
