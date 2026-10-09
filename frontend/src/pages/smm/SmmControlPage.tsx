// «СММ → Контроль» — главное по каждому SMM-проекту за месяц (вариант А,
// утверждён владельцем 03.10.2026): доволен ли клиент, свежий ли аккаунт и
// сделано ли обязательное. Сверху — сводка, ниже — таблица по специалистам,
// проблемные проекты сверху. 09.10.2026 владелец выбрал упрощённый вид:
// одна строка цифр вместо карточек, без колонки «Итог» и полоски свежести,
// «Рилсы» и «Посты» в одной колонке, «На связи» и «Отчёт» — тоже; проблему
// показывает только красная полоса слева и красный текст причины.
// В тот же день добавлены два главных сигнала сразу после названия проекта:
// «Клиент» — цветной значок с лицом, «По плану» — галочка или «Отстаёт на N»
// с полоской «вышло / норма цикла» и чёрточкой «должно было выйти к сегодня».
// Красной полосы больше нет, остальные колонки — серые подробности.
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
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Circle, Frown, Loader2, Meh, Search, Smile } from 'lucide-react'
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
  /** По циклу проекта: вышло, норма, сколько должно было выйти к сегодня. null — нормы нет. */
  plan: { done: number; norm: number; expected: number; start: string; end: string } | null
  payment?: 'paid' | 'wait' | 'late' | null
}
type Data = { ym: string; today: string; ref: string; seeMoney: boolean; projects: Row[] }
type Filter = 'all' | 'behind' | 'unhappy' | 'nocontact' | 'late'

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
const MOOD_BG: Record<string, string> = {
  good: 'bg-green-500/15', meh: 'bg-amber-500/15', bad: 'bg-red-500/15', none: '',
}
const MOOD_ICON: Record<string, any> = { good: Smile, meh: Meh, bad: Frown, none: Circle }
const PAY_TXT: Record<string, string> = { paid: 'получена', wait: 'ждём', late: 'просрочена' }
const PAY_COLOR: Record<string, string> = {
  paid: 'text-green-600 dark:text-green-400',
  wait: 'text-surface-500',
  late: 'text-red-600 dark:text-red-400',
}

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

/** На сколько публикаций проект отстаёт от плана цикла (0 — идёт по плану). */
function lagOf(r: Row): number {
  return r.plan ? Math.max(0, r.plan.expected - r.plan.done) : 0
}

/** Порядок в таблице: недовольный клиент, потом отстающие, потом остальные. */
function rankOf(r: Row): number {
  const lag = lagOf(r)
  if (r.mood === 'bad') return 0
  if (lag >= 2) return 1
  if (lag === 1 || r.mood === 'meh') return 2
  return 3
}

function freshOf(d: number | null): string {
  if (d == null) return 'публикаций не было'
  if (d <= 2) return d === 0 ? 'пост сегодня' : d === 1 ? 'пост вчера' : 'пост 2 дн. назад'
  return `${d} дн. без постов`
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

  const counts = {
    all: rows.length,
    behind: rows.filter(r => lagOf(r) > 0).length,
    unhappy: rows.filter(r => r.mood === 'bad').length,
    nocontact: rows.filter(r => !r.contact).length,
    late: rows.filter(r => r.payment === 'late').length,
  }
  const happy = rows.filter(r => r.mood === 'good').length
  const planKnown = rows.filter(r => r.plan)
  const onPlanN = planKnown.filter(r => lagOf(r) === 0).length
  const payKnown = rows.filter(r => r.payment)
  const paidN = payKnown.filter(r => r.payment === 'paid').length

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false
    if (filter === 'behind') return lagOf(r) > 0
    if (filter === 'unhappy') return r.mood === 'bad'
    if (filter === 'nocontact') return !r.contact
    if (filter === 'late') return r.payment === 'late'
    return true
  })
  // По специалистам, как на доске «Схема»; недовольные и отстающие — сверху.
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
        rows: [...list].sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name, 'ru')),
      }))
  }, [shown])

  const [y, m] = ym.split('-').map(Number)
  const monthLabel = `${MON[m - 1]} ${y}`
  const cols = `minmax(130px,1.4fr) minmax(130px,1.2fr) minmax(210px,1.9fr) minmax(130px,1.3fr) 100px ${seeMoney ? '96px ' : ''}84px`

  const filters: [Filter, string, number, string][] = [
    ['all', 'Все', counts.all, 'text-surface-600 dark:text-surface-300'],
    ['behind', 'Отстают от плана', counts.behind, 'text-red-600 dark:text-red-400'],
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
          {/* Сводка: те же два ответа, что в таблице, — по всем проектам. */}
          <div className="card px-5 py-3.5 flex flex-wrap gap-x-10 gap-y-2">
            {planKnown.length > 0 && <Stat value={onPlanN} of={planKnown.length} label="идут по плану" good />}
            <Stat value={happy} of={rows.length} label="клиент доволен" good />
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
                    <ProjectCard key={r.id} r={r} seeMoney={seeMoney}
                      onMood={() => setMoodFor(r)} onToggle={f => toggle(r, f)} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-0 overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid items-end gap-x-3 px-4 py-2.5 border-b border-surface-200 dark:border-surface-700 text-[11px] font-semibold uppercase tracking-wide text-surface-400"
                  style={{ gridTemplateColumns: cols }}>
                  <span>Проект</span><span>Клиент</span><span>По плану</span><span>Свежесть</span><span>Сторис · 7 дн.</span>
                  {seeMoney && <span>Оплата</span>}
                  <span>Связь · отчёт</span>
                </div>
                {groups.map(g => (
                  <div key={g.name}>
                    <div className="flex items-center gap-2.5 px-4 py-2 bg-surface-50 dark:bg-surface-800/60 border-b border-surface-100 dark:border-surface-700">
                      <b className="text-[13px] font-semibold">{g.name}</b>
                      <span className="text-[12px] text-surface-500">
                        {g.rows.length} {g.rows.length === 1 ? 'проект' : g.rows.length < 5 ? 'проекта' : 'проектов'}
                        {g.rows.some(r => r.plan) ? ` · по плану ${g.rows.filter(r => r.plan && lagOf(r) === 0).length}` : ''}
                      </span>
                    </div>
                    {g.rows.map(r => {
                      return (
                        <div key={r.id} className="grid items-center gap-x-3 px-4 min-h-[60px] border-b border-surface-100 dark:border-surface-700/70"
                          style={{ gridTemplateColumns: cols }}>
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotOf(r.name) }} />
                            <b className="text-[14px] font-semibold truncate" title={r.name}>{r.name}</b>
                          </span>
                          <MoodCell r={r} onClick={() => setMoodFor(r)} />
                          <PlanCell r={r} />
                          <span className="text-[13px] text-surface-500">{freshOf(r.daysSincePost)}</span>
                          <Week s={r.stories7} />
                          {seeMoney && (
                            r.payment
                              ? <span className={clsx('text-[13px]', r.payment === 'late' ? 'font-semibold text-red-600 dark:text-red-400' : 'text-surface-500')}>{PAY_TXT[r.payment]}</span>
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
function Stat({ value, of, label, good = false }: { value: number; of: number; label: string; good?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <b className={clsx('text-[24px] font-bold leading-none', good && 'text-green-600 dark:text-green-400')}>{value}</b>
      <span className="text-[13px] text-surface-500">из {of} · {label}</span>
    </span>
  )
}

/** Клиент: цветной значок с лицом и слово. Дата и слова клиента — в подсказке (на телефоне дата рядом). */
function MoodCell({ r, onClick, withDate = false }: { r: Row; onClick: () => void; withDate?: boolean }) {
  const k = r.mood || 'none'
  const Icon = MOOD_ICON[k]
  const when = r.mood ? `${dayMonth(r.moodAt)}${r.moodNote ? `: «${r.moodNote}»` : ''}` : ''
  return (
    <button type="button" onClick={onClick} disabled={!r.canEdit}
      title={[when, r.canEdit ? 'Нажмите, чтобы отметить, как клиент' : ''].filter(Boolean).join(' · ')}
      className={clsx('min-h-[36px] min-w-0 inline-flex items-center gap-2 text-left text-[13px] font-semibold disabled:cursor-default', MOOD_COLOR[k])}>
      <span className={clsx('w-[30px] h-[30px] rounded-full inline-flex items-center justify-center shrink-0', MOOD_BG[k])}>
        <Icon size={20} strokeDasharray={k === 'none' ? '3 3.2' : undefined} />
      </span>
      <span className="truncate">{MOOD_TXT[k]}{withDate && when ? ` · ${when}` : ''}</span>
    </button>
  )
}

/** По плану: вышло публикаций из нормы цикла; чёрточка — сколько должно было выйти к сегодня. */
function PlanCell({ r }: { r: Row }) {
  const p = r.plan
  if (!p) return <span className="text-[13px] text-surface-400" title="У проекта не задана норма рилсов и постов">нормы нет</span>
  const lag = lagOf(r)
  const text = lag === 0 ? 'text-green-600 dark:text-green-400' : lag === 1 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
  const bar = lag === 0 ? 'bg-green-500' : lag === 1 ? 'bg-amber-500' : 'bg-red-500'
  const pct = Math.min(100, Math.round((p.done / p.norm) * 100))
  const exp = Math.min(100, Math.round((p.expected / p.norm) * 100))
  return (
    <span className="flex flex-col gap-1.5 min-w-0"
      title={`Цикл ${dayMonth(p.start)} – ${dayMonth(p.end)}: вышло ${p.done} из ${p.norm}, к сегодня должно быть ${p.expected}`}>
      <span className={clsx('inline-flex items-center gap-1.5 text-[13.5px] font-bold', text)}>
        {lag === 0 ? <Check size={15} strokeWidth={3} className="shrink-0" /> : <AlertTriangle size={15} className="shrink-0" />}
        {lag === 0 ? 'По плану' : `Отстаёт на ${lag}`}
      </span>
      <span className="flex items-center gap-2.5">
        <span className="relative w-[120px] h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 shrink-0">
          <span className={clsx('absolute left-0 top-0 h-1.5 rounded-full', bar)} style={{ width: `${pct}%` }} />
          <span className="absolute -top-1 w-0.5 h-3.5 rounded-sm bg-surface-900 dark:bg-white" style={{ left: `${exp}%` }} />
        </span>
        <span className="text-[12px] text-surface-500 tabular-nums whitespace-nowrap">{p.done} из {p.norm}</span>
      </span>
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
function ProjectCard({ r, seeMoney, onMood, onToggle }: {
  r: Row; seeMoney: boolean; onMood: () => void; onToggle: (f: 'contact' | 'report') => void
}) {
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
    <div className="card p-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotOf(r.name) }} />
        <b className="text-[15px] font-semibold truncate">{r.name}</b>
      </div>
      <MoodCell r={r} onClick={onMood} withDate />
      <PlanCell r={r} />
      <div className="flex gap-2">
        {big(r.contact, 'На связи', 'contact')}
        {big(r.report, 'Отчёт', 'report')}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-surface-500">
        <span>{freshOf(r.daysSincePost)}</span>
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
