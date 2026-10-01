// «Задачи недели» — пятый вид на странице «Сотрудники»: кто чем занят на
// этой неделе. Только для основателя и админа; сотрудники свои задачи видят
// у себя в панели, как и раньше — их панели не меняются.
//
// В сетке ВСЯ нагрузка человека, из двух источников:
//   • контент-план — рилсы, посты, съёмка, монтаж, дизайн (синяя полоска),
//   • задачи, выданные руководством (полоска цвета акцента).
// Если показывать только выданное, сетка врёт: SMM-специалист с восемью
// рилсами выглядит незагруженным.
//
// Перетаскивание (было в утверждённом дизайне — «перетащите на человека и
// день»):
//   • задачу — любому сотруднику и на любой день;
//   • карточку подготовки — на другой день или человеку той же роли:
//     съёмку видеографу, монтаж монтажёру, дизайн дизайнеру;
//   • публикацию — только на другой день: исполнитель у неё от проекта;
//   • сделанное не двигается.
// Куда нельзя, клетки гаснут сразу при захвате — не надо угадывать.
//
// Вид (утверждён 01.10.2026): у задачи значок этапа и проект; сделанное
// свёрнуто в «✓ N готово»; сегодня выделено колонкой; в шапке дня — сколько
// задач и просрочено; справа «Нагрузка»; фильтр «Все · С просрочкой ·
// Свободны» и поиск; клик по карточке контент-плана — окошко с действиями;
// «Не распределено» закреплено сверху; выходные уже; отделы сворачиваются.
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import {
  Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Scissors, Search, Send, Video,
} from 'lucide-react'
import { employeesApi, tasksApi, contentPlanApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import useNarrow from '@/hooks/useNarrow'

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** В клетке видно до трёх задач, остальное — под «ещё N». */
const DAY_LIMIT = 3
/** Сетка: сотрудник · пять будней · выходные уже · нагрузка. */
const COLS = '232px repeat(5, minmax(0, 1fr)) repeat(2, minmax(0, 0.62fr)) 118px'

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

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

/** «1 октября» из 'YYYY-MM-DD'. */
const dayText = (d?: string | null) => (d ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1] || ''}` : '')

/** Этап подготовки словом — в чипе иначе не понять, что за карточка. */
const PREP: Record<string, string> = { shoot: 'Съёмка', edit: 'Монтаж', design: 'Дизайн' }
const PREP_ICON: Record<string, any> = { shoot: Video, edit: Scissors, design: Pencil }
/** Кому по роли можно отдать карточку этого этапа. */
const STAGE_ROLE: Record<string, string> = { shoot: 'videographer', edit: 'video_editor', design: 'designer' }
const STAGE_WHO: Record<string, string> = { shoot: 'видеографу', edit: 'монтажёру', design: 'дизайнеру' }

type Item = {
  id: string
  date: string
  title: string
  /** 'plan' — из контент-плана, 'task' — выдана руководством. */
  src: 'plan' | 'task'
  state: 'done' | 'late' | 'open'
  to?: string
  /** Как двигать: задача, карточка подготовки или публикация. */
  kind: 'task' | 'prep' | 'pub'
  /** id задачи или карточки контент-плана. */
  refId: string
  /** Кто исполнитель сейчас (null — никто). */
  ownerId: string | null
  stage?: string
  /** Все исполнители задачи по порядку: при переносе меняем одного. */
  team?: string[]
  /** Проект — чей это клиент. */
  project?: string | null
  /** Дата выхода публикации, к которой готовится карточка. */
  outDate?: string | null
}

/** Текст ошибки сервера — чтобы сказать, почему не получилось. */
const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message
  return Array.isArray(m) ? m.join(', ') : (typeof m === 'string' && m) || fallback
}

export default function WeekTasks() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const narrow = useNarrow(900)
  const [offset, setOffset] = useState(0)
  /** Кому и на какой день выдаём — открывается «плюсом» в клетке. */
  const [issue, setIssue] = useState<{ userId: string; date: string } | null>(null)
  const [repeating, setRepeating] = useState(false)
  // Перетаскивание: что тащим и над какой клеткой (`userId|дата`).
  const [drag, setDrag] = useState<Item | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Оптимистичный перенос: чип сразу стоит на новом месте, пока сервер
  // не ответит; при ошибке возвращается обратно.
  const [moved, setMoved] = useState<Record<string, { userId: string; date: string }>>({})
  // Кого показать и поиск по имени.
  const [filter, setFilter] = useState<'all' | 'late' | 'free'>('all')
  const [query, setQuery] = useState('')
  // Свёрнутые отделы и раскрытые клетки («ещё N», «✓ N готово»).
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const [openCell, setOpenCell] = useState<Record<string, boolean>>({})
  // Окошко карточки контент-плана: что открыто и где.
  const [pop, setPop] = useState<{ it: Item; x: number; y: number } | null>(null)
  const [acting, setActing] = useState(false)

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

  // Окошко закрывается по Esc и при прокрутке — иначе висит не у своей карточки.
  useEffect(() => {
    if (!pop) return
    const close = () => setPop(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pop])

  // ── Раскладываем обе ленты по людям и дням ─────────────────────────
  const { byPerson, pool } = useMemo(() => {
    const map = new Map<string, Map<string, Item[]>>()
    const unassigned: Item[] = []
    const place = (it: Item) => {
      const o = moved[it.id]
      if (o) { it.ownerId = o.userId; it.date = o.date }
      if (!it.ownerId) { unassigned.push(it); return }
      if (!map.has(it.ownerId)) map.set(it.ownerId, new Map())
      const d = map.get(it.ownerId)!
      if (!d.has(it.date)) d.set(it.date, [])
      d.get(it.date)!.push(it)
    }

    for (const t of (Array.isArray(tasks) ? tasks : [])) {
      if (t.status === 'cancelled') continue
      const date = String(t.deadline || '').slice(0, 10)
      if (!date || date < from || date > to) continue
      const done = t.status === 'done'
      place({
        id: `t:${t.id}`, date, src: 'task', kind: 'task', refId: t.id,
        title: t.title || 'Задача',
        state: done ? 'done' : date < today ? 'late' : 'open',
        to: `/tasks/${t.id}`,
        ownerId: t.assigneeId || null,
        team: (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => a.userId).filter(Boolean),
        project: t.project?.name || null,
      })
    }

    for (const e of ((cal?.events ?? []) as any[])) {
      const date = String(e.date || '').slice(0, 10)
      if (!date || date < from || date > to || !e.itemId) continue
      const prep = !!e.prepStage
      // Публикация без исполнителя — это норма (ведёт проект целиком), в
      // «Не распределено» её не несём. Карточка подготовки без исполнителя —
      // это дыра: съёмку или монтаж никто не сделает.
      if (!e.assigneeId && !prep) continue
      const done = e.status === 'done' || e.status === 'published'
      const stage = prep ? PREP[e.prepStage] || '' : ''
      const name = e.title || e.topic || (e.kind === 'shoot' ? 'Съёмка' : 'Публикация')
      place({
        id: `p:${e.id}`, date, src: 'plan', kind: prep ? 'prep' : 'pub', refId: e.itemId,
        title: stage ? `${stage} · ${name}` : name,
        state: done ? 'done' : date < today ? 'late' : 'open',
        ownerId: e.assigneeId || null,
        stage: prep ? e.prepStage : undefined,
        project: e.projectName || null,
        outDate: prep ? (e.reelDate || null) : date,
      })
    }
    return { byPerson: map, pool: unassigned }
  }, [tasks, cal, from, to, today, moved])

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

  // Роли человека (основная и вторая) — кому можно отдать карточку этапа.
  const rolesOf = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of (Array.isArray(employees) ? employees : [])) {
      if (e.userId) m.set(e.userId, [e.user?.role, e.user?.secondaryRole].filter(Boolean))
    }
    return m
  }, [employees])

  const canDrop = (it: Item, userId: string) => {
    if (it.kind === 'task') return true
    if (it.ownerId === userId) return true
    if (it.kind === 'prep' && it.stage) return (rolesOf.get(userId) ?? []).includes(STAGE_ROLE[it.stage])
    return false
  }

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['week-tasks'] }),
    qc.invalidateQueries({ queryKey: ['week-plan'] }),
    qc.invalidateQueries({ queryKey: ['smm-calendar'] }),
  ])

  async function dropOn(userId: string, date: string) {
    const it = drag
    setDrag(null); setOver(null)
    if (!it || !canDrop(it, userId)) return
    if (it.ownerId === userId && it.date === date) return
    setMoved(m => ({ ...m, [it.id]: { userId, date } }))
    try {
      if (it.kind === 'task') {
        const patch: any = { deadline: date }
        if (it.ownerId !== userId) {
          // Меняем ОДНОГО исполнителя — того, из чьей строки тащили;
          // остальные исполнители задачи остаются при ней.
          const team = it.team && it.team.length ? it.team : (it.ownerId ? [it.ownerId] : [])
          const next = it.ownerId ? team.map(x => (x === it.ownerId ? userId : x)) : [userId, ...team]
          patch.assigneeIds = Array.from(new Set(next.length ? next : [userId]))
        }
        await tasksApi.update(it.refId, patch)
      } else {
        if (it.ownerId !== userId) await contentPlanApi.assignPrep(it.refId, userId)
        if (it.date !== date) await contentPlanApi.smartUpdate(it.refId, { publishDate: date })
      }
      await refresh()
    } catch (e) {
      toast.error(errText(e, 'Не удалось перенести'))
    } finally {
      setMoved(m => { const n = { ...m }; delete n[it.id]; return n })
    }
  }

  /** Действия из окошка карточки контент-плана. */
  async function planAction(it: Item, act: 'done' | 'tomorrow') {
    if (acting) return
    setActing(true)
    try {
      if (act === 'done') {
        await contentPlanApi.smartUpdate(it.refId, { status: 'published' })
      } else {
        const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + 1)
        await contentPlanApi.smartUpdate(it.refId, { publishDate: iso(d) })
      }
      setPop(null)
      await refresh()
      toast.success(act === 'done' ? 'Отмечено: готово' : 'Перенесено на завтра')
    } catch (e) {
      toast.error(errText(e, 'Не получилось'))
    } finally {
      setActing(false)
    }
  }

  const statsOf = (userId: string) => {
    const byDay = byPerson.get(userId)
    let all = 0, done = 0, late = 0, plan = 0, task = 0
    if (byDay) {
      for (const list of byDay.values()) {
        for (const it of list) {
          all += 1
          if (it.state === 'done') done += 1
          if (it.state === 'late') late += 1
          if (it.src === 'task') task += 1; else plan += 1
        }
      }
    }
    return { all, done, late, plan, task }
  }

  // Счётчики фильтра — по людям: фильтр отбирает людей, а не задачи.
  const allPeople = groups.flatMap(g => g.people)
  const counts = {
    all: allPeople.length,
    late: allPeople.filter((e: any) => statsOf(e.userId).late > 0).length,
    free: allPeople.filter((e: any) => statsOf(e.userId).all === 0).length,
  }
  const q = query.trim().toLowerCase()
  const shown = groups
    .map(g => ({
      ...g,
      people: g.people.filter((e: any) => {
        if (q && !String(e.fullName || '').toLowerCase().includes(q)) return false
        const s = statsOf(e.userId)
        return filter === 'late' ? s.late > 0 : filter === 'free' ? s.all === 0 : true
      }),
    }))
    .filter(g => g.people.length > 0)

  // Шапка дня: сколько всего задач и сколько из них просрочено.
  const dayStats = days.map(d => {
    let all = 0, late = 0
    for (const byDay of byPerson.values()) {
      for (const it of byDay.get(d) ?? []) { all += 1; if (it.state === 'late') late += 1 }
    }
    return { all, late }
  })

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

  // Неделя на стыке месяцев — оба месяца: «28 сентября — 4 октября».
  const end = new Date(start.getTime() + 6 * 864e5)
  const label = start.getMonth() === end.getMonth()
    ? `${start.getDate()} — ${end.getDate()} ${MON[end.getMonth()]}`
    : `${start.getDate()} ${MON[start.getMonth()]} — ${end.getDate()} ${MON[end.getMonth()]}`

  const nav = (
    <div className="flex items-center gap-2">
      <button onClick={() => setOffset(o => o - 1)} aria-label="Прошлая неделя"
        className="w-11 h-11 rounded-xl border border-surface-200 dark:border-surface-700 flex items-center justify-center text-surface-500">
        <ChevronLeft size={18} />
      </button>
      <span className="min-w-[164px] px-1 text-center text-[15px] font-bold whitespace-nowrap">{label}</span>
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

  const filters = (
    <div className={clsx('flex flex-wrap items-center gap-2', !narrow && 'ml-auto')}>
      <div role="group" aria-label="Кого показать"
        className="inline-flex gap-0.5 p-1 rounded-xl border border-surface-200 dark:border-surface-700">
        {([['all', 'Все', counts.all], ['late', 'С просрочкой', counts.late], ['free', 'Свободны', counts.free]] as const).map(([k, l, n]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
            className={clsx('min-h-[36px] px-3 rounded-lg text-[12.5px] font-semibold whitespace-nowrap',
              filter === k ? 'bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white'
                : k === 'late' ? 'text-red-600 dark:text-red-400'
                  : k === 'free' ? 'text-green-600 dark:text-green-400' : 'text-surface-500')}>
            {l} · {n}
          </button>
        ))}
      </div>
      <label className={clsx('relative', narrow && 'flex-1 min-w-[200px]')}>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти сотрудника"
          aria-label="Найти сотрудника" className={clsx('input min-h-[44px] pl-9', narrow ? 'w-full' : 'w-[220px]')} />
      </label>
    </div>
  )

  /** Подсказка при наведении: что будет, если потащить. */
  const dragHint = (it: Item) => it.state === 'done' ? ''
    : it.kind === 'task' ? ' · перетащите на другой день или человека'
      : it.kind === 'prep' ? ` · перетащите на другой день или ${STAGE_WHO[it.stage || ''] || 'сотруднику той же роли'}`
        : ' · перетащите на другой день'

  /** Захват чипа мышью. div, а не button: нативный drag на кнопке в
   *  Chrome не стартует. */
  const dragProps = (it: Item) => it.state === 'done' ? {} : {
    draggable: true,
    onDragStart: (ev: any) => {
      setPop(null)
      setDrag(it)
      ev.dataTransfer.effectAllowed = 'move'
      try { ev.dataTransfer.setData('text/plain', it.id) } catch { /* noop */ }
    },
    onDragEnd: () => { setDrag(null); setOver(null) },
  }

  /** Клик: задача — на её страницу; карточка контент-плана — окошко. */
  const openItem = (it: Item, el: HTMLElement) => {
    if (it.to) { navigate(it.to); return }
    const r = el.getBoundingClientRect()
    setPop({ it, x: r.left, y: r.bottom + 6 })
  }

  const chip = (it: Item) => {
    const done = it.state === 'done'
    const late = it.state === 'late'
    const Icon = it.kind === 'task' ? CheckSquare : it.kind === 'pub' ? Send : (PREP_ICON[it.stage || ''] || Video)
    return (
      <div key={it.id} role="button" tabIndex={0} {...dragProps(it)}
        onClick={ev => openItem(it, ev.currentTarget)}
        onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openItem(it, ev.currentTarget) } }}
        title={it.title + (it.project ? ` · ${it.project}` : '') + dragHint(it)}
        className={clsx(
          'w-full flex items-stretch gap-1.5 px-1.5 py-1 rounded-lg border text-left select-none',
          !done && 'cursor-grab active:cursor-grabbing',
          drag?.id === it.id && 'opacity-40',
          done ? 'border-surface-200 dark:border-surface-700'
            : late ? 'border-red-500/30 bg-red-500/10'
              : 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60',
        )}>
        <i className={clsx('w-[3px] rounded-sm shrink-0', it.src === 'task' ? 'bg-primary-500' : 'bg-sky-500', done && 'opacity-50')} />
        <span className="min-w-0 flex-1 flex flex-col">
          <span className={clsx('flex items-center gap-1 min-w-0 text-[11px] font-semibold leading-tight',
            done ? 'text-surface-400' : late ? 'text-red-700 dark:text-red-400' : 'text-surface-700 dark:text-surface-100')}>
            {done ? <Check size={11} className="shrink-0 text-green-500" /> : <Icon size={11} className="shrink-0 opacity-80" />}
            <span className="truncate">{it.title}</span>
          </span>
          {it.project && (
            <span className={clsx('truncate text-[10px] leading-tight pl-4',
              late ? 'text-red-600/80 dark:text-red-400/75' : 'text-surface-400')}>{it.project}</span>
          )}
        </span>
      </div>
    )
  }

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-surface-500 dark:text-surface-400">
      <span className="inline-flex items-center gap-1.5"><i className="w-[3px] h-3 rounded-sm bg-sky-500" />из контент-плана</span>
      <span className="inline-flex items-center gap-1.5"><i className="w-[3px] h-3 rounded-sm bg-primary-500" />выдана вами</span>
      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-red-500/40" />просрочено</span>
      <span className="inline-flex items-center gap-1.5"><Check size={12} className="text-green-500" />сделанное свёрнуто в «готово»</span>
      {!narrow && <span className="md:ml-auto">Задачу — на любой день и любому · съёмку, монтаж и дизайн — только человеку той же роли</span>}
    </div>
  )

  const nobody = shown.length === 0 && (
    <div className="card p-6 text-center text-[13px] text-surface-500">
      {q ? `Никого не нашлось по «${query.trim()}».` : filter === 'late' ? 'Просрочек нет — все в графике.' : 'Свободных на этой неделе нет.'}
    </div>
  )

  // ── Телефон: список людей с полоской недели ────────────────────────
  if (narrow) {
    return (
      <div className="space-y-4">
        {nav}
        {filters}
        {nobody}
        {shown.map(g => (
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
                  <div className={clsx('text-[11px] font-semibold',
                    !s.all ? 'text-green-600 dark:text-green-400' : s.late ? 'text-red-600 dark:text-red-400' : 'text-surface-500')}>
                    {!s.all ? 'свободен на этой неделе' : s.late ? `${s.late} просрочено · ${s.plan} план · ${s.task} выдано` : `в графике · ${s.plan} план · ${s.task} выдано`}
                  </div>
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
      <div className="flex flex-wrap items-center gap-3">{nav}{filters}</div>

      {pool.length > 0 && (
        // Закреплено сверху: тащить в нижние строки можно без прокрутки назад.
        <div className="card p-3 space-y-2 sticky top-2 z-20 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-surface-400">Не распределено</span>
            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11.5px] font-bold tabular-nums">{pool.length}</span>
            <span className="text-[12px] text-surface-500">без исполнителя · перетащите на человека и день</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pool.map(it => (
              <div key={it.id} role="button" tabIndex={0} {...dragProps(it)}
                onClick={ev => openItem(it, ev.currentTarget)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openItem(it, ev.currentTarget) } }}
                title={it.title + (it.project ? ` · ${it.project}` : '') + dragHint(it)}
                className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-dashed border-surface-300 dark:border-surface-600 text-[12px] font-medium select-none',
                  it.state !== 'done' && 'cursor-grab active:cursor-grabbing',
                  it.state === 'late' && 'border-red-500/45 text-red-700 dark:text-red-400',
                  drag?.id === it.id && 'opacity-40')}>
                <span aria-hidden className="text-surface-400 tracking-[-2px]">⋮⋮</span>
                {it.title}
                {it.project && <span className="text-surface-400">· {it.project}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {nobody}

      {shown.length > 0 && (
      <div className="card p-0 overflow-hidden">
        <div className="grid" style={{ gridTemplateColumns: COLS }}>
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-surface-400 border-b border-surface-100 dark:border-surface-700">Сотрудник</div>
          {days.map((d, i) => {
            const isToday = d === today
            const st = dayStats[i]
            return (
              <div key={d} className={clsx('px-2 py-1.5 border-b border-surface-100 dark:border-surface-700',
                i >= 5 && 'bg-surface-50 dark:bg-surface-800/50', isToday && 'bg-primary-500/[0.07]')}>
                <span className="flex items-center gap-1.5">
                  <span className={clsx('text-[11px] font-bold uppercase tracking-wide', isToday ? 'text-primary-500' : 'text-surface-400')}>{WD[i]}</span>
                  <span className={clsx('min-w-[20px] h-5 px-1 rounded-full inline-flex items-center justify-center text-[11px] font-bold tabular-nums',
                    isToday ? 'bg-primary-500 text-white' : 'text-surface-400')}>{Number(d.slice(8))}</span>
                </span>
                <span className="block text-[10px] text-surface-400 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
                  {st.all ? `${st.all} ${plural(st.all, 'задача', 'задачи', 'задач')}` : '—'}
                  {st.late > 0 && <span className="text-red-600 dark:text-red-400"> · {st.late} проср.</span>}
                </span>
              </div>
            )
          })}
          <div className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-surface-400 border-b border-surface-100 dark:border-surface-700">Нагрузка</div>

          {shown.map(g => {
            const closed = !!shut[g.dep]
            let gAll = 0, gLate = 0
            for (const e of g.people) { const s = statsOf(e.userId); gAll += s.all; gLate += s.late }
            return (
            <div key={g.dep} className="contents">
              <button type="button" aria-expanded={!closed}
                onClick={() => setShut(v => ({ ...v, [g.dep]: !v[g.dep] }))}
                className="col-span-9 flex items-center gap-2 px-3 py-1.5 bg-surface-50 dark:bg-surface-800/60 border-b border-surface-100 dark:border-surface-700 text-left">
                <ChevronDown size={13} className={clsx('text-surface-400 transition-transform', closed && '-rotate-90')} />
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-surface-400">{g.dep}</span>
                <span className="text-[10.5px] text-surface-400 tabular-nums">
                  {gAll} {plural(gAll, 'задача', 'задачи', 'задач')}
                  {gLate > 0 && <span className="text-red-600 dark:text-red-400"> · {gLate} просрочено</span>}
                </span>
              </button>
              {!closed && g.people.map((e: any) => {
                const s = statsOf(e.userId)
                const pct = s.all ? Math.round((s.done / s.all) * 100) : 0
                return (
                  <div key={e.id} className="contents">
                    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-r border-surface-100 dark:border-surface-700 min-h-[72px]">
                      <span className="w-8 h-8 rounded-[10px] bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-[11px] font-bold shrink-0">{initials(e.fullName)}</span>
                      <span className="min-w-0">
                        <b className="block text-[12.5px] font-semibold truncate">{e.fullName}</b>
                        <span className="block text-[10.5px] text-surface-500 truncate">{e.position || '—'}</span>
                      </span>
                    </div>
                    {days.map((d, i) => {
                      const key = `${e.userId}|${d}`
                      const ok = !!drag && canDrop(drag, e.userId)
                      const list = byPerson.get(e.userId)?.get(d) ?? []
                      const active = list.filter(x => x.state !== 'done')
                      const doneList = list.filter(x => x.state === 'done')
                      const expanded = !!openCell[key]
                      const toggle = () => setOpenCell(v => ({ ...v, [key]: !v[key] }))
                      return (
                      <div key={d}
                        onDragOver={drag ? ev => {
                          if (ok) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key) }
                          else if (over !== null) setOver(null)
                        } : undefined}
                        onDrop={drag ? ev => { ev.preventDefault(); dropOn(e.userId, d) } : undefined}
                        className={clsx('group relative px-1.5 py-1.5 border-b border-r border-surface-100 dark:border-surface-700 flex flex-col gap-1 min-w-0 transition-opacity',
                          i >= 5 && 'bg-surface-50 dark:bg-surface-800/50',
                          d === today && 'bg-primary-500/[0.05]',
                          drag && !ok && 'opacity-40',
                          over === key && ok && 'outline-dashed outline-2 outline-primary-500 [outline-offset:-3px] bg-primary-500/10')}>
                        {(expanded ? active : active.slice(0, DAY_LIMIT)).map(chip)}
                        {!expanded && active.length > DAY_LIMIT && (
                          <button type="button" onClick={toggle}
                            className="self-start px-1.5 text-[10.5px] font-semibold text-primary-600 dark:text-primary-400">
                            ещё {active.length - DAY_LIMIT}
                          </button>
                        )}
                        {doneList.length > 0 && (expanded ? doneList.map(chip) : (
                          <button type="button" onClick={toggle} title="Показать сделанное"
                            className="self-start inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-500/10 text-[10.5px] font-semibold text-green-700 dark:text-green-400">
                            <Check size={11} /> {doneList.length} готово
                          </button>
                        ))}
                        {expanded && (
                          <button type="button" onClick={toggle} className="self-start px-1.5 text-[10.5px] font-semibold text-surface-400">свернуть</button>
                        )}
                        <button type="button" onClick={() => setIssue({ userId: e.userId, date: d })}
                          title="Выдать задачу на этот день"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                                     self-start mt-auto w-7 h-7 rounded-lg border border-dashed
                                     border-surface-300 dark:border-surface-600 text-surface-400
                                     flex items-center justify-center">
                          <Plus size={14} />
                        </button>
                      </div>
                      )
                    })}
                    <div className="flex flex-col items-end justify-center gap-1 px-3 py-2 border-b border-surface-100 dark:border-surface-700">
                      <span className={clsx('text-[14px] font-bold tabular-nums',
                        s.all > 0 && s.done === s.all ? 'text-green-600 dark:text-green-400' : 'text-surface-700 dark:text-surface-100')}>
                        {s.done}<span className="text-surface-400">/{s.all}</span>
                      </span>
                      <span className="w-full h-1 rounded-sm bg-surface-200 dark:bg-surface-700 overflow-hidden">
                        <i className="block h-1 rounded-sm bg-green-500" style={{ width: `${pct}%` }} />
                      </span>
                      <span className={clsx('text-[10.5px] font-semibold whitespace-nowrap',
                        !s.all ? 'text-green-600 dark:text-green-400' : s.late ? 'text-red-600 dark:text-red-400' : 'text-surface-400')}>
                        {!s.all ? 'свободен' : s.late ? `${s.late} просрочено` : 'в графике'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            )
          })}
        </div>
      </div>
      )}

      {legend}

      {pop && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPop(null)} />
          <div role="dialog" aria-label={pop.it.title}
            className="fixed z-50 w-[272px] p-3 rounded-2xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 shadow-2xl space-y-2.5"
            style={{ left: Math.max(8, Math.min(pop.x, window.innerWidth - 284)), top: Math.max(8, Math.min(pop.y, window.innerHeight - 190)) }}>
            <div className="space-y-0.5">
              <b className="block text-[13.5px] leading-snug">{pop.it.title}</b>
              <span className="block text-[12px] text-surface-500">
                {[pop.it.project, pop.it.outDate ? `выход ${dayText(pop.it.outDate)}` : ''].filter(Boolean).join(' · ')}
              </span>
              <span className={clsx('block text-[12px] font-semibold',
                pop.it.state === 'late' ? 'text-red-600 dark:text-red-400'
                  : pop.it.state === 'done' ? 'text-green-600 dark:text-green-400' : 'text-surface-500')}>
                {pop.it.state === 'done' ? 'сделано'
                  : pop.it.state === 'late'
                    ? `просрочено на ${Math.round((new Date(today).getTime() - new Date(pop.it.date).getTime()) / 864e5)} ${plural(Math.round((new Date(today).getTime() - new Date(pop.it.date).getTime()) / 864e5), 'день', 'дня', 'дней')}`
                    : `на ${dayText(pop.it.date)}`}
              </span>
            </div>
            <div className="flex gap-1.5">
              {pop.it.state !== 'done' && (
                <button type="button" disabled={acting} onClick={() => planAction(pop.it, 'done')}
                  className="flex-1 min-h-[40px] rounded-xl bg-green-500/15 text-green-700 dark:text-green-400 text-[12.5px] font-semibold disabled:opacity-50">
                  ✓ {pop.it.kind === 'pub' ? 'Опубликовано' : 'Готово'}
                </button>
              )}
              {pop.it.state !== 'done' && pop.it.date <= today && (
                <button type="button" disabled={acting} onClick={() => planAction(pop.it, 'tomorrow')}
                  className="flex-1 min-h-[40px] rounded-xl border border-surface-200 dark:border-surface-600 text-[12.5px] font-semibold disabled:opacity-50">
                  На завтра
                </button>
              )}
              <button type="button" onClick={() => { setPop(null); navigate('/smm') }}
                className="flex-1 min-h-[40px] rounded-xl border border-surface-200 dark:border-surface-600 text-[12.5px] font-semibold text-primary-600 dark:text-primary-400">
                Календарь
              </button>
            </div>
          </div>
        </>
      )}

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
