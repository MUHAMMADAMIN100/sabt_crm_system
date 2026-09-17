// «Проверка сторис» — страница роли stories_checker (и руководства): кто из
// команды отметил сторис, а кто нет. Только чтение: ничего отметить отсюда
// нельзя, поэтому и прав на запись у роли нет.
//
// Все расчёты — на бэке (GET /stories/check): команда проекта = участники +
// назначенные SMM-специалисты, дневная норма = месячная / дни месяца. Те же
// правила, что у вечернего отчёта в 18:00, поэтому цифры сходятся.
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { addMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Users, FolderKanban } from 'lucide-react'
import { storiesApi } from '@/services/api.service'
import { StoriesTab, buildCells, monthTitle, type SDay } from '../smm/SmmPage'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const COLOR: Record<SDay, string> = { done: '#4bc98a', partial: '#e8b04b', none: '#eb5b5b' }
const LABEL: Record<SDay, string> = { done: 'сделано', partial: 'частично', none: 'не сделано' }

type Row = {
  id: string; name: string; position?: string | null
  projects: { id: string; name: string }[]
  days: Record<string, SDay>
  marked: number; expected: number; done: number; partial: number; none: number
}
type ProjRow = Omit<Row, 'projects' | 'position'> & { crew: number; target: number }
type CheckData = {
  from: string; to: string; today: string; days: string[]
  people: Row[]; projects: ProjRow[]
  missingToday: { id: string; name: string; status: SDay; projects: { id: string; name: string; target: number; actual: number }[] }[]
  totals: { people: number; projects: number; marked: number; expected: number; todayDone: number; todayTotal: number }
}

const pct = (marked: number, expected: number) => (expected > 0 ? Math.round((marked / expected) * 100) : 0)

export default function StoriesCheckPage() {
  const [cursor, setCursor] = useState(new Date())
  const [tab, setTab] = useState<'people' | 'projects'>('people')
  const [sort, setSort] = useState<'risk' | 'name'>('risk')
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())

  const monthStr = format(cursor, 'yyyy-MM')
  const from = iso(startOfMonth(cursor))
  const to = iso(endOfMonth(cursor))

  const { data, isLoading } = useQuery<CheckData>({
    queryKey: ['stories-check', from, to],
    queryFn: () => storiesApi.check(from, to),
    placeholderData: keepPreviousData,
  })

  const days = data?.days ?? []
  const today = data?.today ?? iso(new Date())
  const people = data?.people ?? []
  const totals = data?.totals

  const rows = useMemo(() => {
    const list = [...people]
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    // «Сначала проблемные»: больше пропущенных дней — выше.
    return list.sort((a, b) => b.none - a.none || b.partial - a.partial || a.name.localeCompare(b.name, 'ru'))
  }, [people, sort])

  // Срез по проектам — те же мини-календари, что и на странице «Сторисы».
  const cells = useMemo(() => buildCells(monthStr), [monthStr])
  const statusByProject = useMemo(() => {
    const m = new Map<string, Map<string, SDay>>()
    for (const p of data?.projects ?? []) m.set(p.id, new Map(Object.entries(p.days)))
    return m
  }, [data?.projects])
  const projectList = useMemo(() => (data?.projects ?? []).map(p => ({ id: p.id, name: p.name })), [data?.projects])

  const togglePick = (id: string) => setActiveIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="space-y-4">
      {/* ── шапка: месяц + переключатель среза ───────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Проверка сторис</h1>
          <p className="text-[12px] text-surface-500">Кто отметил сторис, а кто нет · {monthTitle(monthStr)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(c => addMonths(c, -1))} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" aria-label="Предыдущий месяц">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setCursor(new Date())} className="px-2.5 py-1.5 text-[12px] rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800">Сегодня</button>
          <button onClick={() => setCursor(c => addMonths(c, 1))} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" aria-label="Следующий месяц">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── сводка дня и месяца ──────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Tile
          icon={<FolderKanban size={15} />}
          label="Сегодня закрыто проектов"
          value={totals ? `${totals.todayDone} из ${totals.todayTotal}` : '—'}
          tone={totals && totals.todayTotal > 0 && totals.todayDone === totals.todayTotal ? 'good' : 'warn'}
        />
        <Tile
          icon={<Users size={15} />}
          label="Не отметили сегодня"
          value={data ? `${data.missingToday.length} чел.` : '—'}
          tone={data && data.missingToday.length === 0 ? 'good' : 'bad'}
        />
        <Tile
          icon={<span className="text-[13px] font-bold">%</span>}
          label="Выполнение за месяц"
          value={totals ? `${pct(totals.marked, totals.expected)}%` : '—'}
          sub={totals ? `${totals.marked} из ${totals.expected} сторис` : undefined}
          tone={totals && pct(totals.marked, totals.expected) >= 90 ? 'good' : 'warn'}
        />
      </div>

      <div className="flex items-center gap-1 border-b border-surface-200 dark:border-surface-800">
        {([['people', 'По людям'], ['projects', 'По проектам']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ' +
              (tab === k ? 'border-primary-600 text-surface-900 dark:text-surface-100' : 'border-transparent text-surface-500 hover:text-surface-700')}>
            {label}
          </button>
        ))}
      </div>

      {isLoading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-surface-400" /></div>
      ) : tab === 'people' ? (
        <div className="space-y-4">
          {/* кто ещё не закрыл сегодняшний день */}
          {data && data.missingToday.length > 0 && (
            <div className="rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle size={15} /> Сегодня ещё не выполнили норму
              </div>
              <div className="flex flex-wrap gap-2">
                {data.missingToday.map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1 text-[12px]"
                    title={m.projects.map(p => `${p.name}: ${p.actual} из ${p.target}`).join('\n') || 'Нет отметок'}>
                    <span className="w-2 h-2 rounded-full" style={{ background: COLOR[m.status] }} />
                    {m.name}
                    <span className="text-surface-400">{m.projects.length ? m.projects.map(p => `${p.actual}/${p.target}`).join(' · ') : '0'}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-wrap gap-3 text-[11px] text-surface-500">
              {(['done', 'partial', 'none'] as SDay[]).map(s => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: COLOR[s] }} />{LABEL[s]}
                </span>
              ))}
            </div>
            <button onClick={() => setSort(s => (s === 'risk' ? 'name' : 'risk'))}
              className="text-[12px] text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">
              Сортировка: {sort === 'risk' ? 'сначала проблемные' : 'по имени'}
            </button>
          </div>

          {rows.length === 0 ? (
            <Empty text="За этот месяц некого проверять — нет активных SMM-проектов с нормой сторис." />
          ) : (
            <div className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[10px] text-surface-400">
                    <th className="sticky left-0 z-10 bg-white dark:bg-surface-950 text-left font-medium px-3 py-2 min-w-[150px]">Сотрудник</th>
                    {days.map(d => (
                      <th key={d} className={'px-0 py-2 font-medium tabular-nums ' + (d === today ? 'text-primary-600' : '')}>
                        {Number(d.slice(8, 10))}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium min-w-[92px]">Дней</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const total = r.done + r.partial + r.none
                    return (
                      <tr key={r.id} className="border-t border-surface-100 dark:border-surface-900">
                        <td className="sticky left-0 z-10 bg-white dark:bg-surface-950 px-3 py-1.5">
                          <div className="text-[13px] font-medium truncate max-w-[220px]">{r.name}</div>
                          <div className="text-[10px] text-surface-400 truncate max-w-[220px]"
                            title={r.projects.map(p => p.name).join(', ')}>
                            {r.projects.length} {plural(r.projects.length, 'проект', 'проекта', 'проектов')}
                          </div>
                        </td>
                        {days.map(d => {
                          const st = r.days[d]
                          return (
                            <td key={d} className="px-0 py-1.5 text-center">
                              <span className="inline-block w-[15px] h-[15px] rounded-[3px] align-middle"
                                title={st ? `${d} — ${LABEL[st]}` : d}
                                style={{
                                  background: st ? COLOR[st] : 'transparent',
                                  border: st ? 'none' : '1px dashed rgba(127,127,127,.28)',
                                  outline: d === today ? '1.5px solid rgba(127,127,127,.5)' : 'none',
                                  outlineOffset: '1px',
                                }} />
                            </td>
                          )
                        })}
                        <td className="px-3 py-1.5 text-right">
                          <div className="text-[13px] font-semibold tabular-nums">{r.done} / {total}</div>
                          <div className="text-[10px] text-surface-400 tabular-nums">{r.marked} из {r.expected} сторис</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : projectList.length === 0 ? (
        <Empty text="Нет активных SMM-проектов с нормой сторис за этот месяц." />
      ) : (
        <StoriesTab projects={projectList} cells={cells} statusByProject={statusByProject}
          today={today} monthLabel={monthTitle(monthStr)} activeIds={activeIds} onPick={togglePick} />
      )}
    </div>
  )
}

function Tile({ icon, label, value, sub, tone }: {
  icon: ReactNode; label: string; value: string; sub?: string; tone: 'good' | 'warn' | 'bad'
}) {
  const color = tone === 'good' ? COLOR.done : tone === 'bad' ? COLOR.none : COLOR.partial
  return (
    <div className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-3">
      <div className="flex items-center gap-2 text-[11px] text-surface-500">
        <span style={{ color }}>{icon}</span>{label}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-surface-400 tabular-nums">{sub}</div>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-surface-300 dark:border-surface-800 p-10 text-center text-[13px] text-surface-500">{text}</div>
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
