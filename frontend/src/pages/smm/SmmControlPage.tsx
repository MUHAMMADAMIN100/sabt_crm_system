// «СММ → Контроль» — главное по каждому SMM-проекту за месяц (вариант А,
// утверждён владельцем 03.10.2026): доволен ли клиент, свежий ли аккаунт и
// сделано ли обязательное. Сверху — сводка, ниже — таблица по специалистам,
// проблемные проекты сверху. 09.10.2026 владелец выбрал упрощённый вид:
// одна строка цифр вместо карточек, без колонки «Итог» и полоски свежести,
// «Рилсы» и «Посты» в одной колонке, «На связи» и «Отчёт» — тоже; проблему
// показывает только красная полоса слева и красный текст причины.
//
// Отмечают люди (SMM-специалист — свои проекты, руководство — все):
//   • клиент доволен / так себе / недоволен — с его словами и датой;
//   • на связи — в этом месяце был созвон или встреча;
//   • отчёт клиенту отправлен.
// Считается само: свежесть аккаунта (дни без постов),
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
const MOOD_COLOR: Record<string, string> = {
  good: 'text-green-600 dark:text-green-400',
  meh: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  none: 'text-surface-500',
}
const PAY_TXT: Record<string, string> = { paid: 'получена', wait: 'ждём', late: 'просрочена' }
const PAY_COLOR: Record<string, string> = {
  paid: 'text-green-600 dark:text-green-400',
  wait: 'text-surface-500',
  late: 'text-red-600 dark:text-red-400',
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
  return { t: `${d} дн. без постов`, cls: 'text-red-600 dark:text-red-400' }
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
  const cols = `minmax(160px,2.2fr) minmax(96px,1.2fr) minmax(150px,1.7fr) 112px 100px ${seeMoney ? '96px ' : ''}84px`

  const filters: [Filter, string, number, string][] = [
    ['all', 'Все', counts.all, 'text-surface-600 dark:text-surface-300'],
    ['attention', 'Требуют внимания', counts.attention, 'text-red-600 dark:text-red-400'],
    ['unhappy', 'Клиент недоволен', counts.unhappy, 'text-amber-600 dark:text-amber-400'],
    ['nocontact', 'Не на связи', counts.nocontact, 'text-surface-600 dark:text-surface-300'],
  ]
  if (seeMoney) filters.push(['late', 'Оплата просрочена', counts.late, 'text-surface-600 dark:text-surface-300'])
  // Фильтр с нулём ничего не покажет — прячем (кроме «Все» и выбранного).
  const shownFilters = filters.filter(([k, , n]) => k === 'all' || n > 0 || filter === k)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Контроль проектов</h1>
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
          {/* Сводка: три цифры одной строкой. */}
          <div className="card px-5 py-3.5 flex flex-wrap gap-x-10 gap-y-2">
            <Stat value={happy} of={rows.length} label="клиент доволен" />
            <Stat value={freshN} of={rows.length} label="аккаунт свежий" />
            {seeMoney && payKnown.length > 0 && <Stat value={paidN} of={payKnown.length} label="оплата получена" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Какие проекты показать" className="inline-flex flex-wrap gap-0.5 p-1 rounded-xl border border-surface-200 dark:border-surface-700">
              {shownFilters.map(([k, l, n, cls]) => (
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
              <div className="min-w-[860px]">
                <div className="grid items-end gap-x-3 px-4 py-2.5 border-b border-surface-200 dark:border-surface-700 text-[11px] font-semibold uppercase tracking-wide text-surface-400"
                  style={{ gridTemplateColumns: cols }}>
                  <span>Проект</span><span>Клиент</span><span>Свежесть</span><span>Рилсы · посты</span><span>Сторис · 7 дн.</span>
                  {seeMoney && <span>Оплата</span>}
                  <span>Связь · отчёт</span>
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
                      const f = freshOf(r.daysSincePost)
                      return (
                        <div key={r.id} className="grid items-center gap-x-3 px-4 min-h-[52px] border-b border-surface-100 dark:border-surface-700/70"
                          style={{
                            gridTemplateColumns: cols,
                            boxShadow: status.get(r.id) === 'bad' ? 'inset 3px 0 0 rgb(239 68 68)' : undefined,
                          }}>
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotOf(r.name) }} />
                            <b className="text-[14px] font-semibold truncate">{r.name}</b>
                          </span>
                          <MoodCell r={r} onClick={() => setMoodFor(r)} />
                          <span className={clsx('text-[13px] font-semibold', f.cls)}>{f.t}</span>
                          <Content r={r} />
                          <Week s={r.stories7} />
                          {seeMoney && (
                            r.payment
                              ? <span className={clsx('text-[13px] font-semibold', PAY_COLOR[r.payment])}>{PAY_TXT[r.payment]}</span>
                              : <span className="text-[13px] text-surface-400" title="Проект с таким названием в Финансах не найден или платежей в этом месяце нет">—</span>
                          )}
                          <span className="flex items-center gap-2">
                            <Tick on={r.contact} disabled={!r.canEdit} label="На связи с клиентом в этом месяце"
                              title={r.contact ? `На связи · отмечено ${dayMonth(r.contactAt)}` : 'На связи: был созвон или встреча в этом месяце'} onClick={() => toggle(r, 'contact')} />
                            <Tick on={r.report} disabled={!r.canEdit} label="Отчёт клиенту отправлен"
                              title={r.report ? `Отчёт · отправлен ${dayMonth(r.reportAt)}` : 'Отчёт за месяц отправлен клиенту'} onClick={() => toggle(r, 'report')} />
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
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
function Stat({ value, of, label }: { value: number; of: number; label: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <b className="text-[24px] font-bold leading-none">{value}</b>
      <span className="text-[13px] text-surface-500">из {of} · {label}</span>
    </span>
  )
}

/** Отзыв клиента одной строкой; дата и слова клиента — в подсказке (на телефоне дата рядом). */
function MoodCell({ r, onClick, withDate = false }: { r: Row; onClick: () => void; withDate?: boolean }) {
  const k = r.mood || 'none'
  const when = r.mood ? `${dayMonth(r.moodAt)}${r.moodNote ? `: «${r.moodNote}»` : ''}` : ''
  return (
    <button type="button" onClick={onClick} disabled={!r.canEdit}
      title={[when, r.canEdit ? 'Нажмите, чтобы отметить, как клиент' : ''].filter(Boolean).join(' · ')}
      className={clsx('min-h-[36px] min-w-0 text-left text-[13px] font-semibold truncate disabled:cursor-default', MOOD_COLOR[k])}>
      {MOOD_TXT[k]}{withDate && when ? ` · ${when}` : ''}
    </button>
  )
}

/** Рилсы и посты по норме одной ячейкой: «0/4 · 0/3». */
function Content({ r }: { r: Row }) {
  const short = (v: { done: number; norm: number }) => (v.norm ? `${v.done}/${v.norm}` : '—')
  const long = (v: { done: number; norm: number }) => (v.norm ? `${v.done} из ${v.norm}` : 'нормы нет')
  return (
    <span className="text-[13px] text-surface-500 tabular-nums whitespace-nowrap"
      title={`Рилсы: ${long(r.reels)} · посты: ${long(r.posts)}`}>
      {short(r.reels)} · {short(r.posts)}
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
    <div className={clsx('card p-3.5 space-y-2.5', st === 'bad' && 'border-red-500/50')}>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotOf(r.name) }} />
        <b className="text-[15px] font-semibold truncate">{r.name}</b>
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <MoodCell r={r} onClick={onMood} withDate />
        <span className={clsx('text-[13px] font-semibold', f.cls)}>{f.t}</span>
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
          <span className={clsx('font-semibold', PAY_COLOR[r.payment])}>оплата {PAY_TXT[r.payment]}</span>
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
