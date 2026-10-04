// «СММ → Контроль» — главное по каждому SMM-проекту за месяц (вариант А,
// утверждён владельцем 03.10.2026): доволен ли клиент, свежий ли аккаунт и
// сделано ли обязательное. Сверху — сводка, ниже — таблица по специалистам,
// проблемные проекты сверху.
//
// Отмечают люди (SMM-специалист — свои проекты, руководство — все):
//   • клиент доволен / так себе / недоволен — с его словами и датой;
//   • на связи — в этом месяце был созвон или встреча;
//   • отчёт клиенту отправлен.
// Считается само: свежесть аккаунта (дни без постов и полоса за 14 дней),
// рилсы и посты по норме за месяц, сторис за 7 дней, оплата из Финансов
// (видит только руководство). Охваты и подписчики владелец убрал — не нужны.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Check, ChevronLeft, ChevronRight, Search, Loader2 } from 'lucide-react'
import { smmControlApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import useNarrow from '@/hooks/useNarrow'

type Mood = 'good' | 'meh' | 'bad' | null
type Row = {
  id: string; name: string
  specialists: { id: string; name: string }[]
  canEdit: boolean
  mood: Mood; moodNote: string | null; moodAt: string | null; moodBy: string | null
  contact: boolean; contactAt: string | null
  report: boolean; reportAt: string | null
  lastPost: string | null; daysSincePost: number | null
  strip: string; stories7: string
  reels: { done: number; norm: number }; posts: { done: number; norm: number }
  payment?: 'paid' | 'wait' | 'late' | null
}
type Data = { ym: string; today: string; ref: string; seeMoney: boolean; projects: Row[] }
type Status = 'bad' | 'warn' | 'ok'
type Filter = 'all' | 'attention' | 'unhappy' | 'nocontact' | 'late'

const MON = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DOTS = ['#e077c4', '#e07a7a', '#e8c04b', '#a8d06a', '#5ab0e0', '#a983e8', '#4bc0a8', '#e0865a', '#7b8cf0', '#c77ae0']

const MOOD_TXT: Record<string, string> = { good: 'доволен', meh: 'так себе', bad: 'недоволен', none: 'нет отзыва' }
const MOOD_CLS: Record<string, string> = {
  good: 'bg-green-500/15 text-green-700 dark:text-green-400',
  meh: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  bad: 'bg-red-500/15 text-red-700 dark:text-red-400',
  none: 'bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300',
}
const PAY_TXT: Record<string, string> = { paid: 'получена', wait: 'ждём', late: 'просрочена' }
const PAY_CLS: Record<string, string> = {
  paid: 'bg-green-500/15 text-green-700 dark:text-green-400',
  wait: 'bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300',
  late: 'bg-red-500/15 text-red-700 dark:text-red-400',
}
const ST_TXT: Record<Status, string> = { bad: 'Проблема', warn: 'Внимание', ok: 'Хорошо' }
const ST_CLS: Record<Status, string> = {
  bad: 'bg-red-500/15 text-red-700 dark:text-red-400',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  ok: 'bg-green-500/15 text-green-700 dark:text-green-400',
}
const ORDER: Record<Status, number> = { bad: 0, warn: 1, ok: 2 }

const thisYm = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const shiftYm = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const dayMonth = (v?: string | null) => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MON_SHORT[d.getMonth()]}`
}
const dotOf = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return DOTS[h % DOTS.length]
}
const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message
  return Array.isArray(m) ? m.join(', ') : (typeof m === 'string' && m) || fallback
}

/** Итог по проекту. «Проблема» — то, из-за чего клиента можно потерять:
 *  недоволен, аккаунт стоит неделю без постов, оплата просрочена.
 *  «Внимание» — с клиентом не было связи, отзыва нет или постов не было 3+ дня. */
function statusOf(r: Row): Status {
  const d = r.daysSincePost
  if (r.mood === 'bad' || d == null || d >= 7 || r.payment === 'late') return 'bad'
  if (r.mood !== 'good' || d >= 3 || !r.contact) return 'warn'
  return 'ok'
}

function freshOf(d: number | null): { t: string; cls: string } {
  if (d == null) return { t: 'публикаций не было', cls: 'text-red-600 dark:text-red-400' }
  if (d <= 2) return { t: d === 0 ? 'пост сегодня' : d === 1 ? 'пост вчера' : 'пост 2 дн. назад', cls: 'text-green-600 dark:text-green-400' }
  if (d <= 6) return { t: `${d} дн. без постов`, cls: 'text-amber-600 dark:text-amber-400' }
  return { t: `${d} дн. без постов — застоялся`, cls: 'text-red-600 dark:text-red-400' }
}

export default function SmmControlPage() {
  const qc = useQueryClient()
  const narrow = useNarrow()
  const [ym, setYm] = useState(thisYm)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [moodFor, setMoodFor] = useState<Row | null>(null)

  const key = ['smm-control', ym]
  const { data, isLoading, isError, refetch } = useQuery<Data>({
    queryKey: key,
    queryFn: () => smmControlApi.list(ym),
    placeholderData: keepPreviousData,
  })
  const rows = data?.projects ?? []
  const seeMoney = !!data?.seeMoney

  /** Отметка с мгновенным откликом: строка меняется сразу, при ошибке — назад. */
  async function save(r: Row, change: Partial<Row>, body: Record<string, any>) {
    const prev = qc.getQueryData<Data>(key)
    qc.setQueryData<Data>(key, old => old
      ? { ...old, projects: old.projects.map(p => (p.id === r.id ? { ...p, ...change } : p)) }
      : old)
    try {
      await smmControlApi.update(r.id, { ym, ...body })
      qc.invalidateQueries({ queryKey: ['smm-control', ym] })
    } catch (e) {
      qc.setQueryData(key, prev)
      toast.error(errText(e, 'Не удалось сохранить отметку'))
    }
  }
  const toggle = (r: Row, field: 'contact' | 'report') =>
    save(r, { [field]: !r[field] } as Partial<Row>, { [field]: !r[field] })

  const status = useMemo(() => new Map(rows.map(r => [r.id, statusOf(r)])), [rows])
  const counts = {
    all: rows.length,
    attention: rows.filter(r => status.get(r.id) === 'bad').length,
    unhappy: rows.filter(r => r.mood === 'bad').length,
    nocontact: rows.filter(r => !r.contact).length,
    late: rows.filter(r => r.payment === 'late').length,
  }
  const happy = rows.filter(r => r.mood === 'good').length
  const freshN = rows.filter(r => r.daysSincePost != null && r.daysSincePost <= 2).length
  const payKnown = rows.filter(r => r.payment)
  const paidN = payKnown.filter(r => r.payment === 'paid').length
  const attention = rows.filter(r => status.get(r.id) === 'bad')

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false
    if (filter === 'attention') return status.get(r.id) === 'bad'
    if (filter === 'unhappy') return r.mood === 'bad'
    if (filter === 'nocontact') return !r.contact
    if (filter === 'late') return r.payment === 'late'
    return true
  })
  // По специалистам, как на доске «Схема»; проблемные — сверху.
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of shown) {
      const k = r.specialists[0]?.name || 'Не назначены'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()]
      .sort(([a], [b]) => (a === 'Не назначены' ? 1 : b === 'Не назначены' ? -1 : a.localeCompare(b, 'ru')))
      .map(([name, list]) => ({
        name,
        rows: [...list].sort((a, b) => ORDER[status.get(a.id)!] - ORDER[status.get(b.id)!] || a.name.localeCompare(b.name, 'ru')),
      }))
  }, [shown, status])

  const [y, m] = ym.split('-').map(Number)
  const monthLabel = `${MON[m - 1]} ${y}`
  const cols = `minmax(150px,1.3fr) 136px 172px 88px 88px 96px 70px ${seeMoney ? '104px ' : ''}70px 100px`

  const filters: [Filter, string, number, string][] = [
    ['all', 'Все', counts.all, 'text-surface-600 dark:text-surface-300'],
    ['attention', 'Требуют внимания', counts.attention, 'text-red-600 dark:text-red-400'],
    ['unhappy', 'Клиент недоволен', counts.unhappy, 'text-amber-600 dark:text-amber-400'],
    ['nocontact', 'Не на связи', counts.nocontact, 'text-surface-600 dark:text-surface-300'],
  ]
  if (seeMoney) filters.push(['late', 'Оплата просрочена', counts.late, 'text-surface-600 dark:text-surface-300'])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Контроль проектов</h1>
          <p className="text-[13px] text-surface-500">Доволен ли клиент, свежий ли аккаунт и сделано ли обязательное — по каждому SMM-проекту</p>
        </div>
        <div className="ml-auto inline-flex items-center gap-0.5 p-1 rounded-xl border border-surface-200 dark:border-surface-700">
          <button type="button" aria-label="Прошлый месяц" onClick={() => setYm(v => shiftYm(v, -1))}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800">
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-[132px] text-center text-[14px] font-semibold">{monthLabel}</span>
          <button type="button" aria-label="Следующий месяц" onClick={() => setYm(v => shiftYm(v, 1))}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-surface-400" /></div>
      ) : isError && !data ? (
        <div className="card p-6 text-center space-y-3">
          <p className="text-[13.5px] text-surface-500">Не удалось загрузить контроль проектов.</p>
          <button type="button" className="btn-secondary min-h-[44px] px-4" onClick={() => refetch()}>Повторить</button>
        </div>
      ) : (
        <>
          {/* Сводка сверху: с одного взгляда понятно, где плохо. */}
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <Tile label="Клиент доволен" value={happy} of={rows.length}
              note={`так себе — ${rows.filter(r => r.mood === 'meh').length} · недовольны — ${counts.unhappy} · нет отзыва — ${rows.filter(r => !r.mood).length}`}
              segs={rows.map(r => r.mood === 'good' ? 'g' : r.mood === 'bad' ? 'r' : r.mood === 'meh' ? 'a' : 'n')} />
            <Tile label="Аккаунт свежий — пост за 2 дня" value={freshN} of={rows.length}
              note={`3–6 дней без постов — ${rows.filter(r => r.daysSincePost != null && r.daysSincePost >= 3 && r.daysSincePost <= 6).length} · застоялись — ${rows.filter(r => r.daysSincePost == null || r.daysSincePost >= 7).length}`}
              segs={rows.map(r => r.daysSincePost != null && r.daysSincePost <= 2 ? 'g' : r.daysSincePost != null && r.daysSincePost <= 6 ? 'a' : 'r')} />
            {seeMoney && payKnown.length > 0 && (
              <Tile label={`Оплата за ${MON[m - 1].toLowerCase()} получена`} value={paidN} of={payKnown.length}
                note={`ждём по сроку — ${payKnown.filter(r => r.payment === 'wait').length} · просрочены — ${counts.late}`}
                segs={payKnown.map(r => r.payment === 'paid' ? 'g' : r.payment === 'late' ? 'r' : 'n')} />
            )}
            <div className={clsx('rounded-2xl border p-4 space-y-1.5',
              attention.length ? 'border-red-500/45 bg-red-500/[0.06]' : 'border-green-500/40 bg-green-500/[0.05]')}>
              <div className={clsx('text-[12.5px]', attention.length ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400')}>Требуют внимания</div>
              <div className="text-[26px] font-bold leading-tight">{attention.length}</div>
              <div className="text-[12.5px] leading-snug">
                {attention.length ? attention.map(r => r.name).join(' · ') : 'Проблемных проектов нет'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Какие проекты показать" className="inline-flex flex-wrap gap-0.5 p-1 rounded-xl border border-surface-200 dark:border-surface-700">
              {filters.map(([k, l, n, cls]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={clsx('min-h-[36px] px-3 rounded-lg text-[12.5px] font-semibold whitespace-nowrap',
                    filter === k ? 'bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white' : cls)}>
                  {l} · {n}
                </button>
              ))}
            </div>
            <label className={clsx('relative', narrow ? 'w-full' : 'ml-auto')}>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти проект" aria-label="Найти проект"
                className={clsx('input min-h-[44px] pl-9', narrow ? 'w-full' : 'w-[220px]')} />
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="card p-8 text-center text-[13.5px] text-surface-500">
              {rows.length === 0 ? 'Активных SMM-проектов нет.' : 'По этому фильтру проектов нет.'}
            </div>
          ) : narrow ? (
            <div className="space-y-5">
              {groups.map(g => (
                <div key={g.name} className="space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400">{g.name}</div>
                  {g.rows.map(r => (
                    <ProjectCard key={r.id} r={r} st={status.get(r.id)!} seeMoney={seeMoney}
                      onMood={() => setMoodFor(r)} onToggle={f => toggle(r, f)} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-0 overflow-x-auto">
              <div className="min-w-[1080px]">
                <div className="grid items-end gap-x-2.5 px-4 py-2.5 border-b border-surface-200 dark:border-surface-700 text-[11px] font-semibold uppercase tracking-wide text-surface-400"
                  style={{ gridTemplateColumns: cols }}>
                  <span>Проект</span><span>Клиент</span><span>Свежесть · 14 дн.</span><span>Рилсы</span><span>Посты</span><span>Сторис · 7 дн.</span>
                  <span className="text-center">На&nbsp;связи</span>
                  {seeMoney && <span className="text-center">Оплата</span>}
                  <span className="text-center">Отчёт клиенту</span>
                  <span className="text-right">Итог</span>
                </div>
                {groups.map(g => (
                  <div key={g.name}>
                    <div className="flex items-center gap-2.5 px-4 py-2 bg-surface-50 dark:bg-surface-800/60 border-b border-surface-100 dark:border-surface-700">
                      <b className="text-[13px] font-semibold">{g.name}</b>
                      <span className="text-[12px] text-surface-500">
                        {g.rows.length} {g.rows.length === 1 ? 'проект' : g.rows.length < 5 ? 'проекта' : 'проектов'}
                        {g.rows.some(r => status.get(r.id) === 'bad') ? ` · проблем: ${g.rows.filter(r => status.get(r.id) === 'bad').length}` : ''}
                      </span>
                    </div>
                    {g.rows.map(r => {
                      const st = status.get(r.id)!
                      const f = freshOf(r.daysSincePost)
                      return (
                        <div key={r.id} className="grid items-center gap-x-2.5 px-4 py-2.5 border-b border-surface-100 dark:border-surface-700/70"
                          style={{
                            gridTemplateColumns: cols,
                            boxShadow: st === 'bad' ? 'inset 3px 0 0 rgb(239 68 68)' : st === 'warn' ? 'inset 3px 0 0 rgba(245,158,11,.55)' : undefined,
                          }}>
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotOf(r.name) }} />
                            <b className="text-[14px] font-semibold truncate">{r.name}</b>
                          </span>
                          <MoodCell r={r} onClick={() => setMoodFor(r)} />
                          <span className="flex flex-col gap-1">
                            <Strip s={r.strip} />
                            <span className={clsx('text-[11.5px] font-semibold', f.cls)}>{f.t}</span>
                          </span>
                          <Norm v={r.reels} color="bg-blue-500" />
                          <Norm v={r.posts} color="bg-violet-500" />
                          <Week s={r.stories7} />
                          <span className="flex justify-center">
                            <Tick on={r.contact} disabled={!r.canEdit} label="На связи с клиентом в этом месяце"
                              title={r.contact ? `Отмечено ${dayMonth(r.contactAt)}` : 'Был созвон или встреча в этом месяце'} onClick={() => toggle(r, 'contact')} />
                          </span>
                          {seeMoney && (
                            <span className="flex justify-center">
                              {r.payment
                                ? <span className={clsx('px-2.5 py-0.5 rounded-full text-[12px] font-semibold whitespace-nowrap', PAY_CLS[r.payment])}>{PAY_TXT[r.payment]}</span>
                                : <span className="text-[12px] text-surface-400" title="Проект с таким названием в Финансах не найден или платежей в этом месяце нет">—</span>}
                            </span>
                          )}
                          <span className="flex justify-center">
                            <Tick on={r.report} disabled={!r.canEdit} label="Отчёт клиенту отправлен"
                              title={r.report ? `Отправлен ${dayMonth(r.reportAt)}` : 'Отчёт за месяц отправлен клиенту'} onClick={() => toggle(r, 'report')} />
                          </span>
                          <span className="flex justify-end">
                            <span className={clsx('px-2.5 py-1 rounded-full text-[12px] font-bold', ST_CLS[st])}>{ST_TXT[st]}</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-surface-500">
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-3.5 rounded-sm bg-green-500" />пост или рилс</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-3.5 rounded-sm bg-green-800" />только сторис</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-3.5 rounded-sm bg-surface-300 dark:bg-surface-700" />ничего</span>
            <span>«Клиент», «На связи» и «Отчёт» отмечает SMM-специалист по своим проектам{seeMoney ? ' · оплата — из Финансов, видит только руководство' : ''} · остальное считается само</span>
          </div>
        </>
      )}

      {moodFor && (
        <MoodModal row={moodFor} onClose={() => setMoodFor(null)}
          onSave={(mood, note) => {
            const r = moodFor
            setMoodFor(null)
            save(r, { mood, moodNote: mood ? (note.trim() || null) : null, moodAt: mood ? new Date().toISOString() : null },
              { mood, moodNote: note })
          }} />
      )}
    </div>
  )
}

// ── части ───────────────────────────────────────────────────────────────
function Tile({ label, value, of, note, segs }: { label: string; value: number; of: number; note: string; segs: string[] }) {
  const COL: Record<string, string> = { g: 'bg-green-500', a: 'bg-amber-500', r: 'bg-red-500', n: 'bg-surface-300 dark:bg-surface-600' }
  const order: Record<string, number> = { g: 0, a: 1, n: 2, r: 3 }
  return (
    <div className="card p-4 space-y-2">
      <div className="text-[12.5px] text-surface-500">{label}</div>
      <div className="text-[26px] font-bold leading-tight">{value} <span className="text-[14px] font-medium text-surface-400">из {of}</span></div>
      <div className="flex gap-[3px]">
        {[...segs].sort((a, b) => order[a] - order[b]).map((c, i) => <span key={i} className={clsx('flex-1 h-[7px] rounded-sm', COL[c])} />)}
      </div>
      <div className="text-[11.5px] text-surface-500">{note}</div>
    </div>
  )
}

function MoodCell({ r, onClick }: { r: Row; onClick: () => void }) {
  const k = r.mood || 'none'
  const sub = r.mood ? `${dayMonth(r.moodAt)}${r.moodNote ? `: «${r.moodNote}»` : ''}` : 'в этом месяце не было'
  return (
    <button type="button" onClick={onClick} disabled={!r.canEdit}
      title={r.canEdit ? 'Отметить, как клиент' : r.moodNote || ''}
      className="flex flex-col items-start gap-1 min-w-0 text-left disabled:cursor-default">
      <span className={clsx('px-2.5 py-0.5 rounded-full text-[12px] font-semibold', MOOD_CLS[k])}>{MOOD_TXT[k]}</span>
      <span className="text-[11px] text-surface-500 truncate max-w-full">{sub}</span>
    </button>
  )
}

function Strip({ s }: { s: string }) {
  return (
    <span className="flex gap-[2px]" aria-hidden>
      {s.split('').map((c, i) => (
        <span key={i} className={clsx('w-2 h-[15px] rounded-[2px]',
          c === 'p' ? 'bg-green-500' : c === 's' ? 'bg-green-800' : 'bg-surface-200 dark:bg-surface-700')} />
      ))}
    </span>
  )
}

function Week({ s }: { s: string }) {
  return (
    <span className="flex gap-[3px]" title="Сторис за последние 7 дней">
      {s.split('').map((c, i) => (
        <span key={i} className={clsx('w-2.5 h-2.5 rounded-[3px]', c === '1' ? 'bg-green-500' : 'bg-red-500/25')} />
      ))}
    </span>
  )
}

function Norm({ v, color }: { v: { done: number; norm: number }; color: string }) {
  if (!v.norm) return <span className="text-[11.5px] text-surface-400">не в норме</span>
  const pct = Math.min(100, Math.round((v.done / v.norm) * 100))
  return (
    <span className="flex flex-col gap-1">
      <span className="block w-[72px] h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
        <span className={clsx('block h-1.5 rounded-full', color)} style={{ width: `${Math.max(pct, v.done ? 6 : 0)}%` }} />
      </span>
      <span className="text-[11.5px] text-surface-500">{v.done} из {v.norm}</span>
    </span>
  )
}

function Tick({ on, disabled, label, title, onClick }: {
  on: boolean; disabled: boolean; label: string; title: string; onClick: () => void
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}
      title={disabled ? `${title} · отмечает SMM-специалист проекта` : title}
      className={clsx('w-[26px] h-[26px] rounded-lg inline-flex items-center justify-center transition-colors disabled:cursor-default',
        on ? 'bg-green-500 text-white' : 'border-[1.5px] border-surface-300 dark:border-surface-600 enabled:hover:border-green-500')}>
      {on && <Check size={15} strokeWidth={3.2} />}
    </button>
  )
}

/** Телефон: карточка проекта вместо строки таблицы. */
function ProjectCard({ r, st, seeMoney, onMood, onToggle }: {
  r: Row; st: Status; seeMoney: boolean; onMood: () => void; onToggle: (f: 'contact' | 'report') => void
}) {
  const f = freshOf(r.daysSincePost)
  const big = (on: boolean, label: string, field: 'contact' | 'report') => (
    <button type="button" aria-pressed={on} disabled={!r.canEdit} onClick={() => onToggle(field)}
      className={clsx('flex-1 min-h-[44px] rounded-xl border px-3 inline-flex items-center gap-2 text-[13px] font-semibold disabled:cursor-default',
        on ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400' : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300')}>
      <span className={clsx('w-5 h-5 rounded-md inline-flex items-center justify-center shrink-0',
        on ? 'bg-green-500 text-white' : 'border-[1.5px] border-surface-300 dark:border-surface-600')}>
        {on && <Check size={13} strokeWidth={3.4} />}
      </span>
      {label}
    </button>
  )
  return (
    <div className={clsx('card p-3.5 space-y-3', st === 'bad' && 'border-red-500/50', st === 'warn' && 'border-amber-500/40')}>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotOf(r.name) }} />
        <b className="text-[15px] font-semibold truncate">{r.name}</b>
        <span className={clsx('ml-auto px-2.5 py-0.5 rounded-full text-[12px] font-bold shrink-0', ST_CLS[st])}>{ST_TXT[st]}</span>
      </div>
      <MoodCell r={r} onClick={onMood} />
      <div className="space-y-1">
        <span className={clsx('block text-[12.5px] font-semibold', f.cls)}>{f.t}</span>
        <Strip s={r.strip} />
      </div>
      <div className="flex gap-2">
        {big(r.contact, 'На связи', 'contact')}
        {big(r.report, 'Отчёт', 'report')}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-surface-500">
        <span>Рилсы <b className="text-surface-800 dark:text-surface-100">{r.reels.norm ? `${r.reels.done} из ${r.reels.norm}` : '—'}</b></span>
        <span>Посты <b className="text-surface-800 dark:text-surface-100">{r.posts.norm ? `${r.posts.done} из ${r.posts.norm}` : '—'}</b></span>
        <span className="inline-flex items-center gap-1.5">Сторис <Week s={r.stories7} /></span>
        {seeMoney && r.payment && (
          <span className={clsx('px-2 py-0.5 rounded-full text-[11.5px] font-semibold', PAY_CLS[r.payment])}>оплата {PAY_TXT[r.payment]}</span>
        )}
      </div>
    </div>
  )
}

function MoodModal({ row, onClose, onSave }: { row: Row; onClose: () => void; onSave: (mood: Mood, note: string) => void }) {
  const [mood, setMood] = useState<Mood>(row.mood)
  const [note, setNote] = useState(row.moodNote || '')
  const opts: [Exclude<Mood, null>, string, string][] = [
    ['good', 'Доволен', 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400'],
    ['meh', 'Так себе', 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400'],
    ['bad', 'Недоволен', 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'],
  ]
  return (
    <Modal open onClose={onClose} title={`Как клиент — ${row.name}`} size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {opts.map(([k, l, cls]) => (
            <button key={k} type="button" aria-pressed={mood === k} onClick={() => setMood(k)}
              className={clsx('min-h-[48px] rounded-xl border text-[14px] font-semibold',
                mood === k ? cls : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300')}>
              {l}
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-semibold text-surface-500">Что сказал клиент</span>
          <input className="input min-h-[48px]" value={note} maxLength={300}
            onChange={e => setNote(e.target.value)} placeholder="Например, «мало охватов» или «нравится подача»" />
        </label>
        {row.moodAt && (
          <p className="text-[12px] text-surface-500">
            Сейчас: {MOOD_TXT[row.mood || 'none']} · {dayMonth(row.moodAt)}{row.moodBy ? ` · отметил(а) ${row.moodBy}` : ''}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary flex-1 min-h-[48px] disabled:opacity-50" disabled={!mood}
            onClick={() => onSave(mood, note)}>Сохранить</button>
          {row.mood && (
            <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={() => onSave(null, '')}>Сбросить</button>
          )}
          <button type="button" className="btn-secondary min-h-[48px] px-4" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </Modal>
  )
}
