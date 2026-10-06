// Авторасстановка публикаций (вариант 2, решение владельца 06.10.2026).
// Специалист один раз задаёт правила проекта — дни и время выхода рилсов и
// постов, за сколько дней и во сколько съёмка, с какого дня начинать, — а
// календарь цикла справа сразу показывает даты. «Сохранить» ставит всё разом
// (POST /content-plan/auto-plan/:id); недостающие до нормы заготовки сервер
// заводит сам. Правила запоминаются в проекте; с «Каждый цикл —
// автоматически» новый цикл расставляется сам утром первого дня.
// На телефоне — два шага: правила → результат.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Camera, Film, Image as ImageIcon, Loader2, Minus, Palette, Plus, Scissors, Sparkles, X } from 'lucide-react'
import { contentPlanApi } from '@/services/api.service'

/** Правила проекта (smmData.autoPlan). Дни недели: 0 — понедельник … 6 — воскресенье. */
export type AutoRules = {
  reelDays: number[]; postDays: number[]; reelTime: string; postTime: string
  shootLead: number; shootTime: string; sep: boolean; spread: boolean; auto: boolean
}
export const DEFAULT_RULES: AutoRules = {
  reelDays: [0, 2, 4], postDays: [1, 3], reelTime: '19:00', postTime: '12:00',
  shootLead: 2, shootTime: '11:00', sep: true, spread: true, auto: true,
}

type CEv = {
  id: string; itemId?: string; kind: string; date?: string; projectId: string
  contentType?: string; topic?: string | null
}
type CProj = {
  id: string; name: string; normReels?: number | null; normPosts?: number | null
  specialistIds?: string[]; autoPlan?: AutoRules | null
}
type Plan = { reels: string[]; posts: string[] }

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MON_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoOf(d) }
const weekday = (iso: string) => (new Date(`${iso}T00:00:00`).getDay() + 6) % 7
const dayShort = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1] || ''}`
const dayLong = (iso: string) => `${Number(iso.slice(8, 10))} ${MON_FULL[Number(iso.slice(5, 7)) - 1] || ''}`
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0 }
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const shiftTime = (t: string, delta: number) => hhmm(Math.max(360, Math.min(1410, toMin(t) + delta)))
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}
const stubNum = (e: CEv) => Number(String(e.topic || '').replace(/\D+/g, '')) || 9999
const byStub = (a: CEv, b: CEv) => stubNum(a) - stubNum(b) || String(a.topic || '').localeCompare(String(b.topic || ''), 'ru')
const maxIso = (...xs: string[]) => xs.reduce((a, b) => (a > b ? a : b))

/** Самый ранний день рилса и поста: съёмке и дизайну нужно успеть (не раньше завтра). */
function minDays(today: string, start: string, w: { start: string }, rules: AutoRules) {
  return {
    rMin: maxIso(w.start, start, addDays(today, 1 + rules.shootLead)),
    pMin: maxIso(w.start, start, addDays(today, 2)),
  }
}

/** Раскладка по правилам. Та же логика — на сервере (ContentPlanService.planDates):
 *  подходящие дни недели внутри цикла, равномерно; занятые дни проекта, дни
 *  рилсов (для постов) и дни других проектов специалиста обходим, если
 *  подходящих дней хватает. */
export function planDates(input: {
  window: { start: string; end: string }; today: string; startFrom: string
  rules: AutoRules; reels: number; posts: number; taken: Set<string>; busy: Set<string>
}): Plan {
  const { window: w, rules } = input
  const { rMin, pMin } = minDays(input.today, input.startFrom, w, rules)
  const cands = (min: string, days: number[]) => {
    const out: string[] = []
    for (let d = min, guard = 0; d <= w.end && guard < 400; d = addDays(d, 1), guard++) {
      if (days.includes(weekday(d))) out.push(d)
    }
    return out
  }
  const prefer = (pool: string[], bad: Set<string>, k: number) => {
    const ok = pool.filter(d => !bad.has(d))
    return ok.length >= k ? ok : pool
  }
  const pick = (pool: string[], k: number) => {
    if (k <= 0) return []
    if (pool.length <= k) return pool.slice()
    const out: string[] = []
    for (let i = 0; i < k; i++) out.push(pool[Math.floor((i + 0.5) * pool.length / k)])
    return out
  }
  let rPool = prefer(cands(rMin, rules.reelDays), input.taken, input.reels)
  if (rules.spread) rPool = prefer(rPool, input.busy, input.reels)
  const reels = pick(rPool, input.reels)
  let pPool = prefer(cands(pMin, rules.postDays), input.taken, input.posts)
  if (rules.sep) pPool = prefer(pPool, new Set(reels), input.posts)
  if (rules.spread) pPool = prefer(pPool, input.busy, input.posts)
  return { reels, posts: pick(pPool, input.posts) }
}

// ─── мелкие части ─────────────────────────────────────────────────────

function Stepper({ value, onMinus, onPlus, minusLabel, plusLabel, wide = false }: {
  value: string; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; wide?: boolean
}) {
  return (
    <span className="inline-flex items-center rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
      <button type="button" aria-label={minusLabel} onClick={onMinus}
        className="w-9 h-9 grid place-items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
        <Minus size={15} />
      </button>
      <b className={`text-center text-[15px] tabular-nums text-gray-900 dark:text-gray-100 ${wide ? 'min-w-[66px]' : 'min-w-[56px]'}`}>{value}</b>
      <button type="button" aria-label={plusLabel} onClick={onPlus}
        className="w-9 h-9 grid place-items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
        <Plus size={15} />
      </button>
    </span>
  )
}

function DayChips({ value, onToggle }: { value: number[]; onToggle: (i: number) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WD.map((l, i) => {
        const on = value.includes(i)
        return (
          <button key={l} type="button" aria-pressed={on} onClick={() => onToggle(i)}
            className={`min-h-[40px] rounded-xl border-[1.5px] text-[13px] font-semibold transition-colors ${on
              ? 'border-primary-500 bg-primary-500/15 text-primary-700 dark:text-primary-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'}`}>
            {l}
          </button>
        )
      })}
    </div>
  )
}

function ToggleRow({ on, title, sub, onFlip }: { on: boolean; title: string; sub: string; onFlip: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onFlip}
      className="w-full flex items-center gap-3 min-h-[52px] px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-left">
      <span className="flex-1 min-w-0">
        <b className="block text-[14px] font-semibold text-gray-900 dark:text-gray-100">{title}</b>
        <span className="block text-[12.5px] leading-snug text-gray-500 dark:text-gray-400">{sub}</span>
      </span>
      <span className={`w-10 h-6 rounded-full p-[3px] flex shrink-0 transition-colors ${on ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <span className={`w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-2.5 p-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">{children}</section>
}

// ─── окно ─────────────────────────────────────────────────────────────

export default function AutoPlanModal({ projectId, segment, window: w, hasCycle, color, isPhone, busyWho, onClose }: {
  projectId: string; segment: 'smm' | 'dev'
  /** Окно цикла проекта (или ближайшие 30 дней, если цикл не задан). */
  window: { start: string; end: string }; hasCycle: boolean
  color: string; isPhone: boolean
  /** «у вас» — для самого специалиста, «у специалиста» — для руководства. */
  busyWho: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const today = isoOf(new Date())
  const tomorrow = addDays(today, 1)

  // Своё окно данных — ровно цикл: в виде «День» общий запрос календаря
  // покрывает один день, а планировщику нужен весь цикл.
  const { data, isLoading } = useQuery<{ events: CEv[]; projects: CProj[]; backlog: CEv[] }>({
    queryKey: ['smm-calendar', segment, w.start, w.end],
    queryFn: () => contentPlanApi.smmCalendar({ from: w.start, to: w.end, segment }),
  })
  const project = data?.projects.find(p => p.id === projectId)

  const isReel = (e: CEv) => e.contentType === 'reel'
  const pubs = (data?.events ?? []).filter(e => e.kind === 'publication' && e.contentType !== 'story' && !!e.date)
  const scheduled = pubs.filter(e => e.projectId === projectId && e.date! >= w.start && e.date! <= w.end)
  const backlog = (data?.backlog ?? []).filter(b => b.projectId === projectId && b.kind === 'publication')
  const blR = backlog.filter(isReel).sort(byStub)
  const blP = backlog.filter(e => !isReel(e)).sort(byStub)
  const schedR = scheduled.filter(isReel).length
  const schedP = scheduled.length - schedR
  const normR = project?.normReels ?? 0
  const normP = project?.normPosts ?? 0
  const needR = normR > 0 ? Math.max(0, normR - schedR) : blR.length
  const needP = normP > 0 ? Math.max(0, normP - schedP) : blP.length
  const newStubs = Math.max(0, needR - blR.length) + Math.max(0, needP - blP.length)

  const taken = useMemo(() => new Set(scheduled.map(e => e.date!)), [data, projectId])
  const busy = useMemo(() => {
    const spec = new Set(project?.specialistIds ?? [])
    const related = new Set((data?.projects ?? [])
      .filter(p => p.id !== projectId && (p.specialistIds ?? []).some(s => spec.has(s))).map(p => p.id))
    return new Set(pubs.filter(e => related.has(e.projectId)).map(e => e.date!))
  }, [data, projectId])

  const [rules, setRules] = useState<AutoRules | null>(null)
  useEffect(() => {
    if (data && rules === null) setRules({ ...DEFAULT_RULES, ...(project?.autoPlan ?? {}) })
  }, [data])
  const r = rules ?? DEFAULT_RULES

  // С какого дня начинать: завтра (или начало предстоящего цикла), ближайший понедельник, свой день.
  const defaultStart = w.start > tomorrow ? w.start : tomorrow
  const nextMonday = (() => { let d = addDays(defaultStart, 1); while (weekday(d) !== 0) d = addDays(d, 1); return d })()
  const [start, setStart] = useState(defaultStart)
  const [manual, setManual] = useState<Plan | null>(null)
  const [step, setStep] = useState<'rules' | 'result'>('rules')

  const upd = (patch: Partial<AutoRules>) => { setRules(prev => ({ ...(prev ?? DEFAULT_RULES), ...patch })); setManual(null) }
  const toggleDay = (key: 'reelDays' | 'postDays', i: number) => {
    const was = r[key]
    const next = was.includes(i) ? was.filter(x => x !== i) : [...was, i].sort((a, b) => a - b)
    upd(key === 'reelDays' ? { reelDays: next } : { postDays: next })
  }
  const pickStart = (d: string) => { setStart(d); setManual(null) }

  const auto = useMemo<Plan>(() => planDates({
    window: w, today, startFrom: start, rules: r, reels: needR, posts: needP, taken, busy,
  }), [r, start, needR, needP, taken, busy, w.start, w.end])
  const cur = manual ?? auto
  const { rMin, pMin } = minDays(today, start, w, r)

  const tap = (d: string) => {
    if (cur.reels.includes(d)) { setManual({ reels: cur.reels.filter(x => x !== d), posts: cur.posts }); return }
    if (cur.posts.includes(d)) { setManual({ reels: cur.reels, posts: cur.posts.filter(x => x !== d) }); return }
    if (cur.reels.length < needR && d >= rMin) { setManual({ reels: [...cur.reels, d].sort(), posts: cur.posts }); return }
    if (cur.posts.length < needP && d >= pMin) { setManual({ reels: cur.reels, posts: [...cur.posts, d].sort() }); return }
    if (cur.reels.length >= needR && cur.posts.length >= needP) toast('Всё уже расставлено — уберите публикацию с другого дня')
    else toast('Слишком рано: съёмка или дизайн не успеют')
  }

  const count = cur.reels.length + cur.posts.length
  const leftR = Math.max(0, needR - cur.reels.length)
  const leftP = Math.max(0, needP - cur.posts.length)
  const nothing = !isLoading && needR + needP === 0

  const saveMut = useMutation({
    mutationFn: () => contentPlanApi.autoPlan(projectId, {
      rules: r,
      reels: cur.reels.slice().sort().map((date, i) => ({ date, itemId: blR[i]?.itemId ?? null })),
      posts: cur.posts.slice().sort().map((date, i) => ({ date, itemId: blP[i]?.itemId ?? null })),
    }),
    onSuccess: (res: any) => {
      void qc.invalidateQueries({ queryKey: ['smm-calendar'] })
      const n = Number(res?.placed) || 0
      toast.success(n ? `Расставлено: ${n} ${plural(n, 'публикация', 'публикации', 'публикаций')}` : 'Правила сохранены')
      onClose()
    },
    onError: () => toast.error('Не удалось сохранить расстановку'),
  })

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const listDays = (days: number[]) => (days.length ? days.map(i => WD[i]).join(', ') : 'дни не выбраны')
  const summary = `Рилсы: ${listDays(r.reelDays)} в ${r.reelTime} · Посты: ${listDays(r.postDays)} в ${r.postTime}`
    + ` · Съёмка за ${r.shootLead} ${plural(r.shootLead, 'день', 'дня', 'дней')} в ${r.shootTime}`
  const saveText = nothing
    ? 'Сохранить правила'
    : `Сохранить ${count} ${plural(count, 'публикацию', 'публикации', 'публикаций')}`
  const cycleText = hasCycle ? `цикл ${dayShort(w.start)} – ${dayShort(w.end)}` : `ближайшие 30 дней`
  const needText = [
    needR ? `${needR} ${plural(needR, 'рилс', 'рилса', 'рилсов')}` : '',
    needP ? `${needP} ${plural(needP, 'пост', 'поста', 'постов')}` : '',
  ].filter(Boolean).join(' · ')

  const startChips = [
    { value: defaultStart, label: w.start > tomorrow ? `С начала цикла · ${dayShort(defaultStart)}` : `Завтра · ${dayShort(defaultStart)}` },
    ...(nextMonday <= w.end ? [{ value: nextMonday, label: `С понедельника · ${dayShort(nextMonday)}` }] : []),
  ]
  const customStart = !startChips.some(c => c.value === start)

  // ── правила ──
  const rulesUi = (
    <>
      {([
        { key: 'reelDays' as const, title: 'Рилсы', need: needR, Icon: Film, time: r.reelTime, set: (t: string) => upd({ reelTime: t }) },
        { key: 'postDays' as const, title: 'Посты', need: needP, Icon: ImageIcon, time: r.postTime, set: (t: string) => upd({ postTime: t }) },
      ]).map(t => (
        <Section key={t.key}>
          <div className="flex flex-wrap items-center gap-2">
            <t.Icon size={18} style={{ color }} className="shrink-0" />
            <b className="text-[15px] text-gray-900 dark:text-gray-100">{t.title}</b>
            <span className="text-[12.5px] text-gray-500 dark:text-gray-400">{t.need ? `${t.need} к расстановке` : 'всё стоит'}</span>
            <span className="flex-1" />
            <span className="text-[13px] text-gray-500 dark:text-gray-400">в</span>
            <Stepper value={t.time} onMinus={() => t.set(shiftTime(t.time, -30))} onPlus={() => t.set(shiftTime(t.time, 30))}
              minusLabel={`${t.title}: на 30 минут раньше`} plusLabel={`${t.title}: на 30 минут позже`} />
          </div>
          <DayChips value={r[t.key]} onToggle={i => toggleDay(t.key, i)} />
        </Section>
      ))}

      <Section>
        <div className="flex items-center gap-2">
          <Camera size={18} style={{ color }} className="shrink-0" />
          <b className="text-[15px] text-gray-900 dark:text-gray-100">Съёмка рилса</b>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13.5px] text-gray-700 dark:text-gray-300">
          <span>за</span>
          <Stepper wide value={`${r.shootLead} ${plural(r.shootLead, 'день', 'дня', 'дней')}`}
            onMinus={() => upd({ shootLead: Math.max(1, r.shootLead - 1) })} onPlus={() => upd({ shootLead: Math.min(5, r.shootLead + 1) })}
            minusLabel="Снимать ближе к выходу" plusLabel="Снимать раньше" />
          <span>до выхода, в</span>
          <Stepper value={r.shootTime} onMinus={() => upd({ shootTime: shiftTime(r.shootTime, -30) })} onPlus={() => upd({ shootTime: shiftTime(r.shootTime, 30) })}
            minusLabel="Снимать на 30 минут раньше" plusLabel="Снимать на 30 минут позже" />
        </div>
        <span className="text-[12.5px] text-gray-500 dark:text-gray-400">Монтаж — за день до выхода рилса, дизайн поста — за день до поста.</span>
      </Section>

      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">С какого дня начинать</span>
        <div className="flex flex-wrap gap-1.5">
          {startChips.map(c => (
            <button key={c.value} type="button" aria-pressed={start === c.value} onClick={() => pickStart(c.value)}
              className={`min-h-[40px] px-3 rounded-xl border-[1.5px] text-[13px] font-semibold ${start === c.value
                ? 'border-primary-500 bg-primary-500/15 text-primary-700 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
              {c.label}
            </button>
          ))}
          <label className={`relative min-h-[40px] px-3 rounded-xl border-[1.5px] text-[13px] font-semibold flex items-center ${customStart
            ? 'border-primary-500 bg-primary-500/15 text-primary-700 dark:text-primary-300'
            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
            {customStart ? `С ${dayShort(start)}` : 'Другой день'}
            <input type="date" aria-label="С какого дня начинать" min={tomorrow} max={w.end} value={start}
              onChange={e => { if (e.target.value) pickStart(e.target.value) }}
              onClick={e => { try { (e.currentTarget as any).showPicker?.() } catch { /* старый браузер */ } }}
              className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ToggleRow on={r.sep} onFlip={() => upd({ sep: !r.sep })}
          title="Рилс и пост — в разные дни" sub="не ставить их на один день" />
        <ToggleRow on={r.spread} onFlip={() => upd({ spread: !r.spread })}
          title="Разносить с другими проектами" sub={`по возможности не в дни, где ${busyWho} уже есть публикации`} />
        <ToggleRow on={r.auto} onFlip={() => upd({ auto: !r.auto })}
          title="Каждый цикл — так же, автоматически" sub="в первый день цикла заготовки создадутся и встанут сами, придёт уведомление проверить" />
      </div>
    </>
  )

  // ── календарь цикла ──
  const gridStart = addDays(w.start, -weekday(w.start))
  const gridEnd = addDays(w.end, 6 - weekday(w.end))
  const cells: string[] = []
  for (let d = gridStart, guard = 0; d <= gridEnd && guard < 120; d = addDays(d, 1), guard++) cells.push(d)
  const clampW = (d: string) => (d < w.start ? w.start : d)
  const shootDays = new Set(cur.reels.map(x => clampW(addDays(x, -r.shootLead))))
  const editDays = new Set(cur.reels.map(x => clampW(addDays(x, -1))))
  const designDays = new Set(cur.posts.map(x => clampW(addDays(x, -1))))

  const calendar = (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-7 gap-1">
        {WD.map(l => <span key={l} className="text-center text-[11px] font-semibold tracking-wide text-gray-400">{l.toUpperCase()}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(d => {
          const inW = d >= w.start && d <= w.end
          const open = inW && d > today
          const n = Number(d.slice(8, 10))
          const label = n === 1 || d === w.start ? dayShort(d) : String(n)
          const isR = cur.reels.includes(d), isP = cur.posts.includes(d)
          const existing = scheduled.filter(e => e.date === d)
          const prep = open && (shootDays.has(d) || editDays.has(d) || designDays.has(d))
          const body = (
            <>
              <span className="flex items-center justify-between gap-1">
                <span className={`text-[12px] font-semibold ${d === today
                  ? 'min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#eb5757] text-white inline-flex items-center justify-center'
                  : inW ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}>{label}</span>
                {inW && busy.has(d) && <span title={`В этот день ${busyWho} публикация другого проекта`} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />}
              </span>
              {existing.map(e => (
                <span key={e.id} title="Уже стоит в календаре"
                  className="flex items-center gap-1 h-[22px] px-1.5 rounded-md text-[11px] font-semibold truncate"
                  style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
                  {isReel(e) ? <Film size={11} className="shrink-0" /> : <ImageIcon size={11} className="shrink-0" />}
                  {!isPhone && <span className="truncate">{e.topic || (isReel(e) ? 'Рилс' : 'Пост')}</span>}
                </span>
              ))}
              {(isR || isP) && (
                <span className={`rounded-md font-bold tabular-nums ${isPhone
                  ? 'flex flex-col items-center gap-0.5 py-0.5 px-0.5 text-[9.5px]'
                  : 'flex items-center gap-1 h-[24px] px-1.5 text-[11.5px]'}`}
                  style={{ border: `1.5px dashed ${color}`, background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
                  {isR ? <Film size={12} className="shrink-0" /> : <ImageIcon size={12} className="shrink-0" />}
                  <span>{isR ? r.reelTime : r.postTime}</span>
                </span>
              )}
              {prep && (
                <span className="flex items-center gap-1 text-gray-400">
                  {shootDays.has(d) && <Camera size={12} aria-label="съёмка" />}
                  {!isPhone && editDays.has(d) && <Scissors size={12} aria-label="монтаж" />}
                  {!isPhone && designDays.has(d) && <Palette size={12} aria-label="дизайн" />}
                  {!isPhone && shootDays.has(d) && <span className="text-[10.5px] tabular-nums">{r.shootTime}</span>}
                </span>
              )}
            </>
          )
          return open ? (
            <button key={d} type="button" onClick={() => tap(d)}
              aria-label={`${dayLong(d)}${isR ? ': рилс — нажмите, чтобы убрать' : isP ? ': пост — нажмите, чтобы убрать' : ' — нажмите, чтобы добавить'}`}
              className={`${isPhone ? 'min-h-[64px]' : 'min-h-[86px]'} p-1.5 rounded-xl border text-left flex flex-col gap-1 min-w-0 transition-colors ${isR || isP
                ? 'border-transparent'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 hover:border-gray-300 dark:hover:border-gray-600'}`}
              style={isR || isP ? { background: `color-mix(in srgb, ${color} 7%, transparent)`, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` } : undefined}>
              {body}
            </button>
          ) : (
            <div key={d} className={`${isPhone ? 'min-h-[64px]' : 'min-h-[86px]'} p-1.5 rounded-xl flex flex-col gap-1 min-w-0 ${inW ? 'border border-gray-100 dark:border-gray-800' : ''}`}>
              {body}
            </div>
          )
        })}
      </div>
      <span className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
        Пунктир — ещё не сохранено. Значки внизу дня — съёмка{isPhone ? '' : ', монтаж, дизайн'}. Серая точка — {busyWho} в этот день публикация другого проекта. Нажмите на день, чтобы добавить или убрать публикацию.
      </span>
      {(leftR > 0 || leftP > 0) && !nothing && (
        <span className="px-2.5 py-2 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[12.5px] leading-snug">
          Не хватает подходящих дней: осталось {[
            leftR ? `${leftR} ${plural(leftR, 'рилс', 'рилса', 'рилсов')}` : '',
            leftP ? `${leftP} ${plural(leftP, 'пост', 'поста', 'постов')}` : '',
          ].filter(Boolean).join(' и ')}. Добавьте день недели или нажмите на свободный день.
        </span>
      )}
      {newStubs > 0 && !nothing && (
        <span className="text-[12px] text-gray-500 dark:text-gray-400">
          До нормы не хватает заготовок — {newStubs} {plural(newStubs, 'новую создадим', 'новые создадим', 'новых создадим')} сами.
        </span>
      )}
      {r.auto && (
        <span className="text-[12.5px] text-gray-500 dark:text-gray-400">
          Следующий цикл расставится сам по этим правилам — придёт уведомление проверить.
        </span>
      )}
    </div>
  )

  const resultUi = (
    <>
      {nothing ? (
        <div className="px-3 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[13.5px] leading-snug">
          Все публикации этого цикла уже стоят в календаре. Можно сохранить правила — они пригодятся для следующего цикла.
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-primary-700 dark:text-primary-300">
          <Sparkles size={15} className="shrink-0" />
          <span>Меняете правила — даты пересчитываются сразу.</span>
        </div>
      )}
      {calendar}
    </>
  )

  const header = (
    <div className="flex items-start gap-2.5 shrink-0">
      <span className="w-2.5 h-2.5 mt-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 min-w-0">
        <b className="block text-[19px] leading-snug text-gray-900 dark:text-gray-100 truncate">{project?.name || 'Проект'}</b>
        <span className="block text-[13px] text-gray-500 dark:text-gray-400">
          Расстановка публикаций · {cycleText}{needText ? ` · ${needText}` : ''}
        </span>
      </span>
      <button type="button" onClick={onClose} aria-label="Закрыть"
        className="w-10 h-10 grid place-items-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0">
        <X size={18} />
      </button>
    </div>
  )

  const saveBtn = (
    <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || isLoading || !rules}
      className="min-h-[48px] px-5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
      {saveMut.isPending && <Loader2 size={16} className="animate-spin" />}
      {saveText}
    </button>
  )

  if (isPhone) return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Расстановка публикаций"
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="px-4 pt-3 pb-2">{header}</div>
      {isLoading ? (
        <div className="flex-1 grid place-items-center"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : step === 'rules' ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 flex flex-col gap-3">{rulesUi}</div>
          <div className="shrink-0 px-4 pt-2.5 pb-3 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-2">
            <span className="text-[12px] leading-snug text-gray-500 dark:text-gray-400">{summary}</span>
            <button type="button" onClick={() => setStep('result')}
              className="min-h-[52px] rounded-2xl bg-primary-600 text-white text-[15px] font-bold inline-flex items-center justify-center gap-2">
              <Sparkles size={16} /> {nothing ? 'Дальше' : `Расставить ${needR + needP} ${plural(needR + needP, 'публикацию', 'публикации', 'публикаций')}`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 flex flex-col gap-2.5">{resultUi}</div>
          <div className="shrink-0 px-4 pt-2.5 pb-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-[1fr_1.7fr] gap-2">
            <button type="button" onClick={() => setStep('rules')}
              className="min-h-[52px] rounded-2xl border border-gray-200 dark:border-gray-700 text-[14px] font-semibold text-gray-700 dark:text-gray-200">
              Правила
            </button>
            {saveBtn}
          </div>
        </>
      )}
    </div>,
    document.body,
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Расстановка публикаций" onClick={e => e.stopPropagation()}
        className="w-full max-w-[1220px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-5 flex flex-col gap-4">
        {header}
        {isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
        ) : (
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex-[1_1_380px] max-w-full min-w-0 flex flex-col gap-3">
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-gray-400">Правила</span>
              {rulesUi}
            </div>
            <div className="flex-[999_1_540px] min-w-0 flex flex-col gap-2.5">
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-gray-400">Результат</span>
              {resultUi}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 pt-3.5 border-t border-gray-100 dark:border-gray-800">
          <span className="flex-[1_1_320px] text-[12.5px] leading-snug text-gray-500 dark:text-gray-400">{summary}</span>
          <button type="button" onClick={onClose}
            className="min-h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-[14px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            Отмена
          </button>
          {saveBtn}
        </div>
      </div>
    </div>,
    document.body,
  )
}
