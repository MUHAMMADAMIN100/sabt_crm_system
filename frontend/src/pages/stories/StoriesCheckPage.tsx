// «Проверка сторис» — страница роли stories_checker (и руководства): кто из
// SMM-специалистов выложил сторис по своим проектам. Только чтение: отметить
// отсюда ничего нельзя, поэтому и прав на запись у роли нет.
//
// Вид утверждён владельцем 02.10.2026 (холст «Мобильная версия Sabt», ряд
// «Проверка сторис»), карточка специалиста — вариант Б, точки нормы:
//   • «День» — крупно «выложено по N из M проектов» и карточка на каждого
//     специалиста. Точка = одна сторис по норме: зелёная выложена, пустая —
//     ещё нет, синяя — сверх нормы (тот же знак, что специалист видит у себя
//     в кабинете). Дробей «0 из 1» и «3 из 10» нет — владелец попросил убрать.
//     Общий проект засчитывается команде: выложил один — у второго проект
//     тоже закрыт, с подписью, кем выложено.
//   • «Месяц» — таблица проектов по дням (кто ведёт, сколько дней закрыто) и
//     та же сетка по специалистам.
//
// Расчёты — на бэке (GET /stories/check/day и /stories/check): ведут сторис
// только SMM-специалисты, норма = месячная / дни месяца — как в отчёте 18:00.
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { addDays, addMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { storiesApi } from '@/services/api.service'
import useNarrow from '@/hooks/useNarrow'

type SDay = 'done' | 'partial' | 'none'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const parseDay = (s: string) => new Date(`${s}T00:00:00`)
const COLOR: Record<SDay, string> = { done: '#4bc98a', partial: '#e8b04b', none: '#eb5b5b' }
const OVER = '#5c9cf0'
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MON_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
/** Порядок в карточке: сначала то, о чём надо напомнить. */
const ORDER: Record<SDay, number> = { none: 0, partial: 1, done: 2 }

type DayProject = {
  id: string; name: string; target: number; actual: number; status: SDay
  crew: { id: string; name: string }[]
  posters: { id: string; name: string; count: number }[]
}
type DayData = {
  date: string; today: string; future: boolean
  projects: DayProject[]
  people: { id: string; name: string; avatar?: string | null; projectIds: string[] }[]
  totals: { projects: number; done: number; partial: number; none: number }
}
type MonthRow = { id: string; name: string; days: Record<string, SDay>; done: number; partial: number; none: number }
type MonthData = {
  from: string; to: string; today: string; days: string[]
  people: (MonthRow & { projects: { id: string; name: string }[] })[]
  projects: (MonthRow & { crew: number; team?: { id: string; name: string }[] })[]
}

const initials = (name?: string | null) => {
  const p = String(name || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
/** «Зарипова Умрона» из полного имени — без отчества, чтобы влезало в строку. */
const shortName = (name: string) => String(name || '').trim().split(/\s+/).slice(0, 2).join(' ')

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

const OVER_WORD = ['', 'на одну больше нормы', 'на две больше нормы', 'на три больше нормы']

export default function StoriesCheckPage() {
  const narrow = useNarrow()
  const [mode, setMode] = useState<'day' | 'month'>('day')
  const [day, setDay] = useState(() => iso(new Date()))
  const [cursor, setCursor] = useState(() => new Date())
  const [slice, setSlice] = useState<'projects' | 'people'>('projects')

  const dayQ = useQuery<DayData>({
    queryKey: ['stories-check-day', day],
    queryFn: () => storiesApi.checkDay(day),
    enabled: mode === 'day',
    placeholderData: keepPreviousData,
  })
  const from = iso(startOfMonth(cursor))
  const to = iso(endOfMonth(cursor))
  const monthQ = useQuery<MonthData>({
    queryKey: ['stories-check', from, to],
    queryFn: () => storiesApi.check(from, to),
    enabled: mode === 'month',
    placeholderData: keepPreviousData,
  })

  const today = dayQ.data?.today ?? monthQ.data?.today ?? iso(new Date())
  const d = parseDay(day)
  const dayLabel = `${day === today ? 'Сегодня, ' : ''}${WD[d.getDay()]}, ${d.getDate()} ${MON_GEN[d.getMonth()]}`
  const monthLabel = `${MON_NOM[cursor.getMonth()]} ${cursor.getFullYear()}`

  const navBtn = 'w-11 h-11 rounded-xl flex items-center justify-center text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div className="space-y-4">
      {/* ── шапка: режим и перелистывание ─────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Проверка сторис</h1>
          <p className="text-[12.5px] text-surface-500">Кто из SMM-специалистов выложил сторис по своим проектам</p>
        </div>
        <div className={clsx('flex flex-wrap items-center gap-2', narrow && 'w-full')}>
          <div role="group" aria-label="Период" className="inline-flex gap-0.5 p-1 rounded-xl border border-surface-200 dark:border-surface-700">
            {([['day', 'День'], ['month', 'Месяц']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
                className={clsx('min-h-[36px] px-4 rounded-lg text-[13px] font-semibold',
                  mode === k ? 'bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white' : 'text-surface-500')}>
                {l}
              </button>
            ))}
          </div>
          <div className={clsx('inline-flex items-center gap-0.5 p-1 rounded-xl border border-surface-200 dark:border-surface-700', narrow && 'flex-1 justify-between')}>
            {mode === 'day' ? (
              <>
                <button type="button" className={navBtn} aria-label="Предыдущий день" onClick={() => setDay(iso(addDays(d, -1)))}><ChevronLeft size={18} /></button>
                <span className="min-w-[190px] text-center text-[14px] font-semibold">{dayLabel}</span>
                <button type="button" className={navBtn} aria-label="Следующий день" disabled={day >= today}
                  onClick={() => setDay(iso(addDays(d, 1)))}><ChevronRight size={18} /></button>
              </>
            ) : (
              <>
                <button type="button" className={navBtn} aria-label="Предыдущий месяц" onClick={() => setCursor(c => addMonths(c, -1))}><ChevronLeft size={18} /></button>
                <span className="min-w-[140px] text-center text-[14px] font-semibold">{monthLabel}</span>
                <button type="button" className={navBtn} aria-label="Следующий месяц" onClick={() => setCursor(c => addMonths(c, 1))}><ChevronRight size={18} /></button>
              </>
            )}
          </div>
          {mode === 'day' && day !== today && (
            <button type="button" onClick={() => setDay(today)}
              className="min-h-[44px] px-3 rounded-xl border border-surface-200 dark:border-surface-700 text-[13px] font-semibold text-surface-600 dark:text-surface-300">
              Сегодня
            </button>
          )}
        </div>
      </div>

      {mode === 'day'
        ? <DayView data={dayQ.data} loading={dayQ.isLoading} isToday={day === today} narrow={narrow} />
        : <MonthView data={monthQ.data} loading={monthQ.isLoading} today={today} slice={slice} onSlice={setSlice} />}
    </div>
  )
}

// ── День ────────────────────────────────────────────────────────────────
function DayView({ data, loading, isToday, narrow }: { data?: DayData; loading: boolean; isToday: boolean; narrow: boolean }) {
  if (loading && !data) return <Spinner />
  if (!data || data.totals.projects === 0) {
    return <Empty text="В этот день сторис ни по одному проекту не требовались — нет активных SMM-проектов с нормой." />
  }
  const t = data.totals
  const byId = new Map(data.projects.map(p => [p.id, p]))
  const orphans = data.projects.filter(p => p.crew.length === 0)
  const segs = [...data.projects].sort((a, b) => ORDER[b.status] - ORDER[a.status])

  return (
    <div className="space-y-4">
      {/* Главный вопрос дня — одной фразой и полосой из проектов. */}
      <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="shrink-0">
          <div className="text-[13px] text-surface-500">{isToday ? 'Сегодня сторис выложены по' : 'В этот день сторис выложены по'}</div>
          <div className="text-[28px] leading-tight font-bold tabular-nums">
            {t.done} <span className="text-[17px] font-semibold text-surface-400">из {t.projects} {plural(t.projects, 'проекта', 'проектов', 'проектов')}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-1">
            {segs.map(p => (
              <span key={p.id} title={p.name} className="flex-1 h-3 rounded-[4px]" style={{ background: COLOR[p.status] }} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-surface-500">
            <Swatch color={COLOR.done}><b className="text-surface-800 dark:text-surface-100">{t.done}</b> выложено</Swatch>
            {t.partial > 0 && <Swatch color={COLOR.partial}><b className="text-surface-800 dark:text-surface-100">{t.partial}</b> меньше нормы</Swatch>}
            <Swatch color={COLOR.none}><b className="text-surface-800 dark:text-surface-100">{t.none}</b> не выложено</Swatch>
            {isToday && <span className="sm:ml-auto text-surface-400">в 18:00 руководителю уйдёт отчёт по невыложенным</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-surface-500">
        <span className="inline-flex items-center gap-1.5"><Dot kind="done" />сторис выложена</span>
        <span className="inline-flex items-center gap-1.5"><Dot kind="none" />ещё нет</span>
        <span className="inline-flex items-center gap-1.5"><Dot kind="over" />сверх нормы</span>
        <span className="text-surface-400">· одна точка — одна сторис по норме проекта</span>
      </div>

      {data.people.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          {data.people.map(person => (
            <PersonCard key={person.id} person={person} narrow={narrow}
              projects={person.projectIds.map(id => byId.get(id)).filter(Boolean) as DayProject[]} />
          ))}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="rounded-2xl border border-amber-500/45 bg-amber-500/[0.06] p-4 space-y-2">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <AlertTriangle size={16} className="text-amber-500" />
            Без SMM-специалиста · {orphans.length} {plural(orphans.length, 'проект', 'проекта', 'проектов')}
          </div>
          <p className="text-[12.5px] text-surface-500">Сторис по этим проектам вести некому — специалиста назначает руководство в карточке проекта.</p>
          <div className="flex flex-col">
            {orphans.map(p => <ProjectLine key={p.id} p={p} note={p.posters.length ? `выложено: ${p.posters.map(x => shortName(x.name)).join(', ')}` : ''} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function PersonCard({ person, projects, narrow }: {
  person: { id: string; name: string }; projects: DayProject[]; narrow: boolean
}) {
  const [showDone, setShowDone] = useState(false)
  const rows = [...projects].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, 'ru'))
  const allDone = rows.every(p => p.status === 'done')
  const doneRows = rows.filter(p => p.status === 'done')
  // На телефоне выложенное свёрнуто: смотрят, кому напомнить.
  const visible = narrow && !showDone && !allDone ? rows.filter(p => p.status !== 'done') : rows

  // Подпись под проектом: кем выложено (общий проект), сверх нормы или с кем ведёт.
  const noteOf = (p: DayProject) => {
    const mine = p.posters.find(x => x.id === person.id)
    const others = p.posters.filter(x => x.id !== person.id)
    if (others.length && !mine) return `выложено: ${others.map(x => shortName(x.name)).join(', ')}`
    if (others.length && mine) return `вместе с: ${others.map(x => shortName(x.name)).join(', ')}`
    const extra = p.actual - p.target
    if (extra > 0) return OVER_WORD[extra] || 'больше нормы'
    const team = p.crew.filter(c => c.id !== person.id)
    if (team.length) return `вместе с: ${team.map(c => shortName(c.name)).join(', ')}`
    return ''
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-surface-100 dark:border-surface-700">
        <span className="w-10 h-10 rounded-xl bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-[13px] font-bold shrink-0">{initials(person.name)}</span>
        <span className="min-w-0">
          <b className="block text-[15px] font-semibold truncate">{person.name}</b>
          <span className="block text-[12px] text-surface-500">SMM-специалист</span>
        </span>
        <span className={clsx('ml-auto shrink-0 px-3 py-1 rounded-full text-[12px] font-semibold',
          allDone ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-red-500/15 text-red-700 dark:text-red-400')}>
          {allDone ? 'Всё выложено' : 'Не всё выложено'}
        </span>
      </div>
      <div className="flex flex-col p-2">
        {visible.map(p => <ProjectLine key={p.id} p={p} note={noteOf(p)} />)}
        {narrow && !allDone && doneRows.length > 0 && (
          <button type="button" onClick={() => setShowDone(v => !v)}
            className="mt-1 mx-1 min-h-[40px] px-3 rounded-[10px] bg-green-500/10 text-left text-[13px] font-semibold text-green-700 dark:text-green-400">
            {showDone ? 'Свернуть выложенное' : `✓ Выложено по ${doneRows.length} ${plural(doneRows.length, 'проекту', 'проектам', 'проектам')} — показать`}
          </button>
        )}
      </div>
    </div>
  )
}

function ProjectLine({ p, note }: { p: DayProject; note: string }) {
  return (
    <div className={clsx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 min-h-[40px] px-2.5 py-1 rounded-[10px]',
      p.status === 'none' && 'bg-red-500/[0.06]')}>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium truncate">{p.name}</span>
        {note && <span className="block text-[11.5px] text-surface-400 truncate">{note}</span>}
      </span>
      <Dots target={p.target} actual={p.actual} />
    </div>
  )
}

/** Точки нормы: одна точка — одна сторис по норме. Больше шести не рисуем. */
function Dots({ target, actual }: { target: number; actual: number }) {
  const MAX = 6
  const total = Math.max(target, actual)
  const kinds: ('done' | 'none' | 'over')[] = []
  for (let k = 0; k < Math.min(total, MAX); k++) {
    kinds.push(k < Math.min(target, actual) ? 'done' : k < target ? 'none' : 'over')
  }
  const said = actual >= target
    ? (actual > target ? 'выложено сверх нормы' : 'выложено по норме')
    : actual > 0 ? 'выложено меньше нормы' : 'не выложено'
  return (
    <span className="inline-flex items-center gap-[5px]" role="img" aria-label={said} title={`норма ${target} · выложено ${actual}`}>
      {kinds.map((k, i) => <Dot key={i} kind={k} />)}
      {total > MAX && <span className="text-[11px] text-surface-400">…</span>}
    </span>
  )
}

function Dot({ kind }: { kind: 'done' | 'none' | 'over' }) {
  return (
    <span className="inline-block w-3.5 h-3.5 rounded-full box-border shrink-0"
      style={kind === 'done' ? { background: COLOR.done }
        : kind === 'over' ? { background: OVER }
          : { border: `2px solid ${COLOR.none}` }} />
  )
}

// ── Месяц ───────────────────────────────────────────────────────────────
function MonthView({ data, loading, today, slice, onSlice }: {
  data?: MonthData; loading: boolean; today: string; slice: 'projects' | 'people'; onSlice: (v: 'projects' | 'people') => void
}) {
  const rows = useMemo(() => {
    const src: (MonthRow & { team?: { id: string; name: string }[]; isProject: boolean })[] = slice === 'projects'
      ? (data?.projects ?? []).map(r => ({ ...r, isProject: true }))
      : (data?.people ?? []).map(r => ({ ...r, isProject: false }))
    const share = (r: MonthRow) => {
      const n = r.done + r.partial + r.none
      return n ? r.done / n : 1
    }
    // Сначала проблемные: меньше закрытых дней — выше.
    return [...src].sort((a, b) => share(a) - share(b) || a.name.localeCompare(b.name, 'ru'))
  }, [data, slice])

  if (loading && !data) return <Spinner />
  const days = data?.days ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Срез" className="inline-flex gap-4 border-b border-surface-200 dark:border-surface-700">
          {([['projects', 'По проектам'], ['people', 'По специалистам']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={slice === k} onClick={() => onSlice(k)}
              className={clsx('pb-2 -mb-px border-b-2 text-[13.5px] font-semibold',
                slice === k ? 'border-primary-500 text-surface-900 dark:text-white' : 'border-transparent text-surface-500')}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-surface-500">
          <Swatch color={COLOR.done}>выложено по норме</Swatch>
          <Swatch color={COLOR.partial}>меньше нормы</Swatch>
          <Swatch color={COLOR.none}>ничего</Swatch>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty text={slice === 'projects'
          ? 'Нет активных SMM-проектов с нормой сторис за этот месяц.'
          : 'За этот месяц некого проверять — ни у одного проекта нет SMM-специалиста.'} />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full border-collapse min-w-[900px]">
            <thead>
              <tr className="text-[10.5px] text-surface-400">
                <th className="sticky left-0 z-10 bg-white dark:bg-surface-800 text-left font-semibold uppercase tracking-wide px-3 py-2.5 min-w-[170px]">
                  {slice === 'projects' ? 'Проект' : 'Специалист'}
                </th>
                {slice === 'projects' && <th className="text-left font-semibold uppercase tracking-wide px-2 py-2.5 min-w-[80px]">Ведут</th>}
                {days.map(dd => (
                  <th key={dd} className={clsx('px-0 py-2.5 font-medium tabular-nums', dd === today && 'text-primary-500')}>{Number(dd.slice(8, 10))}</th>
                ))}
                <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide min-w-[110px]">Закрыто дней</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const n = r.done + r.partial + r.none
                const pct = n ? Math.round((r.done / n) * 100) : 0
                return (
                  <tr key={r.id} className="border-t border-surface-100 dark:border-surface-700">
                    <td className="sticky left-0 z-10 bg-white dark:bg-surface-800 px-3 py-2 text-[13.5px] font-medium">
                      <span className="block truncate max-w-[220px]">{r.name}</span>
                    </td>
                    {slice === 'projects' && (
                      <td className="px-2 py-2">
                        <span className="flex gap-1">
                          {(r.team ?? []).length === 0
                            ? <span className="px-1.5 h-[22px] rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10.5px] font-bold inline-flex items-center">некому</span>
                            : (r.team ?? []).map(m => (
                              <span key={m.id} title={m.name}
                                className="min-w-[26px] h-[22px] px-1 rounded-md bg-surface-200 dark:bg-surface-700 text-[10.5px] font-bold inline-flex items-center justify-center">
                                {initials(m.name)}
                              </span>
                            ))}
                        </span>
                      </td>
                    )}
                    {days.map(dd => {
                      const st = r.days[dd]
                      return (
                        <td key={dd} className="px-0 py-2 text-center">
                          <span className="inline-block w-4 h-4 rounded-[4px] align-middle"
                            title={st ? `${Number(dd.slice(8, 10))} — ${st === 'done' ? 'выложено по норме' : st === 'partial' ? 'меньше нормы' : 'ничего'}` : undefined}
                            style={{
                              background: st ? COLOR[st] : 'transparent',
                              border: st ? 'none' : '1px dashed rgba(127,127,127,.3)',
                              outline: dd === today ? '1.5px solid rgba(127,127,127,.55)' : 'none',
                              outlineOffset: '1px',
                            }} />
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-right">
                      <b className="block text-[14px] tabular-nums" style={{ color: pct >= 90 ? COLOR.done : pct >= 60 ? COLOR.partial : COLOR.none }}>{pct}%</b>
                      <span className="block text-[11px] text-surface-400 tabular-nums">{r.done} из {n} дн.</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {slice === 'people' && rows.length > 0 && (
        <p className="text-[12px] text-surface-400">День специалиста закрыт, когда по всем его проектам сторис выложены по норме — кем угодно из команды проекта.</p>
      )}
    </div>
  )
}

// ── мелочи ──────────────────────────────────────────────────────────────
function Swatch({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} />{children}
    </span>
  )
}

function Spinner() {
  return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-surface-400" /></div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-surface-300 dark:border-surface-700 p-10 text-center text-[13px] text-surface-500">{text}</div>
}
