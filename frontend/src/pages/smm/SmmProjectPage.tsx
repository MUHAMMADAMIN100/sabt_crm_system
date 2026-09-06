import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ChevronLeft, Film, Image as ImageIcon, Pencil, Check, Plus, TrendingUp, TrendingDown, Gift, FileText, X, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { assignProjectColors, projColor, cycleBoundsFor, fmtCycleRange, type SmmProj } from './smmShared'

type Ev = { projectId: string; kind?: string; contentType?: string; status?: string; count?: number; date?: string }
type CalData = { projects: SmmProj[]; backlog: Ev[]; events: Ev[] }
type MKey = 'subs' | 'reach' | 'eng' | 'leads'
type MPoint = { ym: string; subs: number | null; reach: number | null; eng: number | null; leads: number | null }
type SmmProfile = { ownerName: string | null; keyDate: string | null; keyDateNote: string | null; collabSince: string | null; preferences: string | null; metrics: MPoint[] }

const EDIT_ROLES = ['founder', 'co_founder', 'admin', 'smm_director', 'smm_specialist']
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const METRICS: { key: MKey; label: string; color: string }[] = [
  { key: 'subs', label: 'Подписчики', color: '#10b981' },
  { key: 'reach', label: 'Охват', color: '#3b82f6' },
  { key: 'eng', label: 'Вовлечённость', color: '#8b5cf6' },
  { key: 'leads', label: 'Заявки', color: '#e0a63a' },
]
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtNum = (n: number) => n.toLocaleString('ru-RU')
const mLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1] ?? ''} ${y}` }
const mShort = (ym: string) => (MONTHS[+ym.split('-')[1] - 1] ?? '').slice(0, 3)
const fmtDate = (v?: string | null) => v ? new Date(v + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
const inp = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500'
const card = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5'
const secLabel = 'text-[11px] font-bold uppercase tracking-wider text-gray-400'
const fRow = 'flex items-center justify-between gap-3 h-[46px] border-b border-gray-100 dark:border-gray-800 last:border-0'
const editIn = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg h-8 px-2.5 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500'

// Универсальный график метрики: сетка + оси + подписи месяцев + точки + тултип (в интерактиве).
function MetricChart({ data, color, w = 480, h = 190, axes = true, interactive = true }: {
  data: { ym: string; value: number }[]; color: string; w?: number; h?: number; axes?: boolean; interactive?: boolean
}) {
  const [hi, setHi] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  if (data.length < 2) return <div style={{ height: h }} className="flex items-center justify-center text-sm text-gray-400">Мало данных — добавь ещё месяц</div>
  const pl = axes ? 46 : 8, pr = axes ? 14 : 8, pt = axes ? 16 : 8, pb = axes ? 28 : 8
  const iw = w - pl - pr, ih = h - pt - pb
  const vals = data.map(d => d.value)
  let mn = Math.min(...vals), mx = Math.max(...vals)
  if (mn === mx) { mn -= 1; mx += 1 }
  const rp = (mx - mn) * 0.14; mn = Math.floor(mn - rp); mx = Math.ceil(mx + rp)
  const X = (i: number) => pl + i * iw / (data.length - 1)
  const Y = (v: number) => pt + ih - (v - mn) / (mx - mn) * ih
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d.value).toFixed(1)}`).join(' ')
  const area = `${line} L ${X(data.length - 1).toFixed(1)} ${(pt + ih).toFixed(1)} L ${X(0).toFixed(1)} ${(pt + ih).toFixed(1)} Z`
  const gv = [0, 0.5, 1].map(t => Math.round(mn + (mx - mn) * t))
  const step = Math.max(1, Math.ceil(data.length / 7))
  const cur = interactive ? (hi ?? data.length - 1) : data.length - 1
  const onMove = interactive ? (e: { clientX: number }) => { const r = ref.current!.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * w; setHi(Math.max(0, Math.min(data.length - 1, Math.round((px - pl) / (iw / (data.length - 1)))))) } : undefined
  return (
    <svg ref={ref} viewBox={`0 0 ${w} ${h}`} className="w-full text-gray-400 dark:text-gray-500 select-none touch-none" onMouseMove={onMove} onMouseLeave={interactive ? () => setHi(null) : undefined}>
      {axes && gv.map((tv, i) => { const yy = Y(tv); return (
        <g key={i}>
          <line x1={pl} y1={yy} x2={w - pr} y2={yy} stroke="currentColor" strokeOpacity="0.14" />
          <text x={pl - 8} y={yy + 3} textAnchor="end" fontSize="10" fill="currentColor">{fmtNum(tv)}</text>
        </g>
      ) })}
      <path d={area} fill={color + '22'} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {axes && data.map((d, i) => (i % step === 0 || i === data.length - 1)
        ? <text key={i} x={X(i)} y={h - 9} textAnchor="middle" fontSize="10" fill="currentColor">{mShort(d.ym)}</text> : null)}
      {data.map((d, i) => <circle key={i} cx={X(i)} cy={Y(d.value)} r={i === cur ? 4 : 2.4} fill={color} />)}
      {interactive && hi != null && (() => {
        const d = data[hi], hx = X(hi), hy = Y(d.value), tw = 104, tx = Math.max(2, Math.min(w - tw - 2, hx - tw / 2)), ty = Math.max(2, hy - 46)
        return (
          <g>
            <line x1={hx} y1={pt} x2={hx} y2={pt + ih} stroke="currentColor" strokeOpacity="0.28" strokeDasharray="3 3" />
            <rect x={tx} y={ty} width={tw} height={36} rx="7" fill="#111827" stroke="#374151" />
            <text x={tx + tw / 2} y={ty + 14} textAnchor="middle" fontSize="10.5" fill="#9ca3af">{mShort(d.ym)} {d.ym.split('-')[0]}</text>
            <text x={tx + tw / 2} y={ty + 28} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{fmtNum(d.value)}</text>
          </g>
        )
      })()}
    </svg>
  )
}

// Логотип WeBrand (инлайн SVG) — для печатного отчёта клиенту.
function WeBrandLogo({ height = 30 }: { height?: number }) {
  return (
    <svg viewBox="0 0 436 91" style={{ height, width: 'auto', display: 'block' }} fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="WeBrand">
      <path d="M85.0763 88.0513C84.5342 89.1439 83.4189 89.8351 82.198 89.8351H59.4197C57.6552 89.8351 56.221 88.4137 56.2073 86.6516L55.9534 53.9781C55.9265 50.516 51.1865 49.5454 49.7977 52.7177L34.3901 87.912C33.8787 89.0802 32.7233 89.8351 31.4468 89.8351H8.60091C6.90704 89.8351 5.50421 88.5215 5.39516 86.8332L0.00680036 3.41496C-0.112659 1.56558 1.35701 0 3.21255 0H25.689C27.4752 0 28.9184 1.45526 28.9012 3.23916L28.5494 39.8903C28.5161 43.3528 33.2393 44.405 34.6825 41.2567L52.7359 1.87283C53.259 0.731737 54.4002 0 55.6568 0H70.5118C72.253 0 73.6772 1.38542 73.7231 3.12383L74.6975 40.0335C74.7887 43.4882 79.5327 44.3769 80.8711 41.19L97.3446 1.96733C97.8451 0.775492 99.0128 0 100.307 0H123.59C125.973 0 127.527 2.50048 126.469 4.63306L85.0763 88.0513Z" fill="url(#wb0)" />
      <path fillRule="evenodd" clipRule="evenodd" d="M142.514 89.8349C124.864 89.8349 112.645 80.9501 112.645 64.7753C112.645 47.2335 125.996 32.0838 145.117 32.0838C158.694 32.0838 170.687 40.399 170.687 57.1434C170.687 59.7735 170.354 62.6824 169.961 64.8947C169.708 66.3162 168.441 67.2812 166.995 67.2812H132.898C132.835 67.2812 132.784 67.3322 132.784 67.3951C132.784 68.1925 136.065 74.2296 143.985 74.2296C146.769 74.2296 149.886 73.7997 152.412 73.0326C154.312 72.4558 156.629 73.1329 157.469 74.9305L160.898 82.2741C161.579 83.7328 161.079 85.4868 159.633 86.1974C154.454 88.7427 148.15 89.8349 142.514 89.8349ZM134.708 54.2958H152.697V53.954C152.697 52.3593 150.774 47.6891 144.325 47.6891C138.894 47.6891 135.386 51.9037 134.708 54.2958Z" fill="url(#wb1)" />
      <path d="M157.788 25.6672C164.912 25.6672 170.687 19.9214 170.687 12.8336C170.687 5.74579 164.912 0 157.788 0C150.665 0 144.89 5.74579 144.89 12.8336C144.89 19.9214 150.665 25.6672 157.788 25.6672Z" fill="url(#wb2)" />
      <path d="M204.824 73.1159C206.351 75.0025 209.406 75.9907 211.562 75.9907C215.963 75.9907 219.647 72.9363 219.647 67.4563C219.647 62.0662 215.963 59.0118 211.562 59.0118C209.406 59.0118 206.351 60.0899 204.824 61.9764V73.1159ZM204.824 89.1964H188.654V29.2764H204.824V50.3877C208.238 46.2553 212.64 44.7281 217.041 44.7281C227.732 44.7281 236.176 53.0827 236.176 67.4563C236.176 82.3689 227.552 90.2744 217.041 90.2744C212.64 90.2744 208.507 88.7472 204.824 84.6148V89.1964ZM259.237 89.1964H243.067V45.8061H259.237V50.5673C261.932 47.4231 267.592 44.5484 272.533 44.5484V60C271.724 59.7305 270.377 59.5508 268.85 59.5508C265.436 59.5508 261.034 60.4492 259.237 62.6052V89.1964ZM320.204 89.1964H304.033V85.064C301.608 88.1184 296.308 90.2744 290.917 90.2744C284.449 90.2744 276.005 85.8725 276.005 75.9907C276.005 65.2105 284.449 62.1561 290.917 62.1561C296.577 62.1561 301.698 63.9528 304.033 66.9173V62.4256C304.033 59.3712 301.249 57.0355 295.948 57.0355C291.906 57.0355 287.324 58.6525 283.91 61.2577L278.43 51.286C284.27 46.6146 292.355 44.7281 298.913 44.7281C309.693 44.7281 320.204 48.5011 320.204 62.9646V89.1964ZM297.655 79.7637C300.171 79.7637 302.955 78.9552 304.033 77.428V75.0025C302.955 73.4753 300.171 72.6668 297.655 72.6668C294.96 72.6668 291.996 73.5651 291.996 76.2602C291.996 78.9552 294.96 79.7637 297.655 79.7637ZM375.595 89.1964H359.425V65.2105C359.425 60.7187 357 59.0118 353.137 59.0118C349.453 59.0118 347.567 60.8984 346.219 62.4256V89.1964H330.049V45.8061H346.219V50.747C348.735 47.8723 353.496 44.7281 361.132 44.7281C371.194 44.7281 375.595 50.8368 375.595 58.383V89.1964ZM430.073 89.1964H413.903V84.6148C410.22 88.7472 406.087 90.2744 401.686 90.2744C391.175 90.2744 382.551 82.3689 382.551 67.4563C382.551 53.0827 390.995 44.7281 401.686 44.7281C406.087 44.7281 410.489 46.2553 413.903 50.3877V29.2764H430.073V89.1964ZM407.165 75.9907C409.321 75.9907 412.376 74.9126 413.903 73.0261V61.8866C412.376 60 409.321 59.0118 407.165 59.0118C402.764 59.0118 399.08 62.0662 399.08 67.4563C399.08 72.8464 402.764 75.9907 407.165 75.9907Z" fill="#0D131F" />
      <defs>
        <linearGradient id="wb0" x1="87.592" y1="0" x2="85.3489" y2="89.8352" gradientUnits="userSpaceOnUse"><stop stopColor="#3068D8" /><stop offset="1" stopColor="#275ACF" /></linearGradient>
        <linearGradient id="wb1" x1="87.592" y1="0" x2="85.3489" y2="89.8352" gradientUnits="userSpaceOnUse"><stop stopColor="#3068D8" /><stop offset="1" stopColor="#275ACF" /></linearGradient>
        <linearGradient id="wb2" x1="87.592" y1="0" x2="85.3489" y2="89.8352" gradientUnits="userSpaceOnUse"><stop stopColor="#3068D8" /><stop offset="1" stopColor="#275ACF" /></linearGradient>
      </defs>
    </svg>
  )
}

export default function SmmProjectPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = EDIT_ROLES.includes((user as any)?.role ?? '')

  const now = new Date()
  const from = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const monthPref = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthTitle = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
  const { data, isLoading } = useQuery<CalData>({ queryKey: ['smm-calendar', from, to], queryFn: () => contentPlanApi.smmCalendar({ from, to }) })
  const { data: profile } = useQuery<SmmProfile>({ queryKey: ['smm-profile', id], queryFn: () => projectsApi.getSmmProfile(id!), enabled: !!id })

  const saveMut = useMutation({
    mutationFn: (patch: Partial<SmmProfile>) => projectsApi.setSmmProfile(id!, patch as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-profile', id] }); toast.success('Сохранено') },
    onError: () => toast.error('Не удалось сохранить'),
  })
  const cycleMut = useMutation({
    mutationFn: (patch: { day?: number | null; normReels?: number | null; normPosts?: number | null; storiesPerMonth?: number | null }) => projectsApi.setSmmCycle(id!, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Сохранено') },
    onError: () => toast.error('Не удалось сохранить'),
  })

  const projects = data?.projects ?? []
  const backlog = data?.backlog ?? []
  const events = data?.events ?? []
  const info = useMemo(() => {
    assignProjectColors(projects.map(p => p.id))
    const p = projects.find(x => x.id === id)
    if (!p) return null
    const norm = (p.normReels ?? 0) + (p.normPosts ?? 0)
    const left = backlog.filter(b => b.projectId === p.id).length
    const placed = Math.max(0, norm - left)
    const cycle = p.cycleStartDay ? cycleBoundsFor(new Date(), p.cycleStartDay) : null
    return { p, color: projColor(p.id), norm, left, placed, cycle }
  }, [projects, backlog, id])
  const p = info?.p

  // ── Цикл (редактирование) ──
  const [cycEditing, setCycEditing] = useState(false)
  const [cycDraft, setCycDraft] = useState({ day: '', reels: '', posts: '', spm: '' })
  useEffect(() => {
    if (p && !cycEditing) setCycDraft({
      day: p.cycleStartDay != null ? String(p.cycleStartDay) : '',
      reels: String(p.normReels ?? 0), posts: String(p.normPosts ?? 0),
      spm: p.storiesPerMonth != null ? String(p.storiesPerMonth) : '',
    })
  }, [p, cycEditing])
  const perDayHint = (() => { const m = parseInt(cycDraft.spm, 10); return Number.isFinite(m) && m > 0 ? Math.max(1, Math.round(m / daysInMonth)) : 0 })()
  const saveCycle = () => {
    const nn = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null }
    cycleMut.mutate({ day: nn(cycDraft.day), normReels: nn(cycDraft.reels) ?? 0, normPosts: nn(cycDraft.posts) ?? 0, storiesPerMonth: nn(cycDraft.spm) })
    setCycEditing(false)
  }

  // ── О клиенте (редактирование) ──
  const [cliEditing, setCliEditing] = useState(false)
  const [draft, setDraft] = useState({ ownerName: '', keyDate: '', keyDateNote: '', collabSince: '', preferences: '' })
  useEffect(() => {
    if (profile && !cliEditing) setDraft({
      ownerName: profile.ownerName ?? '', keyDate: profile.keyDate ?? '', keyDateNote: profile.keyDateNote ?? '',
      collabSince: profile.collabSince ?? '', preferences: profile.preferences ?? '',
    })
  }, [profile, cliEditing])
  const saveClient = () => {
    saveMut.mutate({ ownerName: draft.ownerName || null, keyDate: draft.keyDate || null, keyDateNote: draft.keyDateNote || null, collabSince: draft.collabSince || null, preferences: draft.preferences || null })
    setCliEditing(false)
  }

  // ── Метрики ──
  const metrics = profile?.metrics ?? []
  const [selM, setSelM] = useState<MKey>('subs')
  const [addYm, setAddYm] = useState(monthPref)
  const [addV, setAddV] = useState<Record<MKey, string>>({ subs: '', reach: '', eng: '', leads: '' })
  const series = (k: MKey) => metrics.map(m => ({ ym: m.ym, value: m[k] })).filter(x => x.value != null) as { ym: string; value: number }[]
  const latest = (k: MKey) => { const s = series(k); const a = s[s.length - 1], b = s[s.length - 2]; return { cur: a ? a.value : null, prev: b ? b.value : null, ym: a ? a.ym : null } }
  const addMetrics = () => {
    if (!/^\d{4}-\d{2}$/.test(addYm)) return
    const g = (s: string) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : undefined }
    const map = new Map<string, MPoint>(metrics.map(m => [m.ym, { ...m }]))
    const row = map.get(addYm) ?? { ym: addYm, subs: null, reach: null, eng: null, leads: null }
    ;(['subs', 'reach', 'eng', 'leads'] as MKey[]).forEach(k => { const v = g(addV[k]); if (v !== undefined) row[k] = v })
    map.set(addYm, row)
    saveMut.mutate({ metrics: [...map.values()].sort((a, b) => a.ym < b.ym ? -1 : 1) })
    setAddV({ subs: '', reach: '', eng: '', leads: '' })
  }

  // ── Отчёт ──
  const [reportOpen, setReportOpen] = useState(false)

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
  if (!info || !p) return (
    <div className="space-y-4">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <p className="text-gray-400">Проект не найден.</p>
    </div>
  )

  const { color, norm, left, placed, cycle } = info

  // Выполнение плана (из событий календаря этого месяца).
  const myEv = events.filter(e => e.projectId === p.id)
  const isPub = (e: Ev) => e.kind === 'publication'
  const done = (e: Ev) => e.status === 'published'
  const reelsDone = myEv.filter(e => isPub(e) && (e.contentType === 'reel' || e.contentType === 'video') && done(e)).length
  const postsDone = myEv.filter(e => isPub(e) && e.contentType === 'design' && done(e)).length
  const storyByDate = new Map<string, number>()
  myEv.filter(e => isPub(e) && e.contentType === 'story').forEach(e => { if (e.date) storyByDate.set(e.date, (storyByDate.get(e.date) ?? 0) + (e.count ?? 0)) })
  const storiesTotal = [...storyByDate.values()].reduce((a, b) => a + b, 0)
  const reelsNorm = p.normReels ?? 0, postsNorm = p.normPosts ?? 0
  const spm = p.storiesPerMonth ?? null
  const dayTarget = spm != null ? (spm > 0 ? Math.max(1, Math.round(spm / daysInMonth)) : 0) : (p.storiesPerDay ?? 3)
  let discG = 0, discY = 0, discR = 0
  if (dayTarget > 0) {
    const todayStr = iso(now)
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${monthPref}-${String(d).padStart(2, '0')}`
      if (ds > todayStr) break
      const actual = storyByDate.get(ds) ?? 0
      if (actual >= dayTarget) discG++
      else if (actual > 0) discY++
      else if (ds < todayStr) discR++
    }
  }
  const pct = (a: number, b: number) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0

  // Печать отчёта: имя PDF-файла = WeBrand-(проект) - дата-дата (через document.title перед print).
  const dmy = (isoStr: string) => { const [y, m, d] = isoStr.split('-'); return `${d}.${m}.${y}` }
  const rangeStart = cycle ? cycle.start : from, rangeEnd = cycle ? cycle.end : to
  const reportFile = `WeBrand-${p.name.replace(/[\\/:*?"<>|]+/g, '').trim()} - ${dmy(rangeStart)}-${dmy(rangeEnd)}`
  const printReport = () => {
    const prev = document.title
    document.title = reportFile
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
    setTimeout(restore, 1500)
  }

  const selMeta = METRICS.find(m => m.key === selM)!
  const selLatest = latest(selM)
  const selDelta = selLatest.cur != null && selLatest.prev != null ? selLatest.cur - selLatest.prev : null

  const editBtn = (onEdit: () => void) => canEdit ? (
    <button onClick={onEdit} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"><Pencil size={13} /> Изменить</button>
  ) : null
  const editActions = (onSave: () => void, onCancel: () => void) => (
    <div className="flex gap-2">
      <button onClick={onCancel} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
      <button onClick={onSave} disabled={cycleMut.isPending || saveMut.isPending} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#3f7a58] text-white hover:brightness-110 disabled:opacity-60"><Check size={14} /> Сохранить</button>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
        <button onClick={() => setReportOpen(true)} className="inline-flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-xl bg-[#3068D8] text-white hover:brightness-110"><FileText size={16} /> Получить отчёт</button>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: color }} />
        <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {/* ЛЕВО — информация */}
        <div className="space-y-4">
          {/* Цикл и норма */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className={secLabel}>Цикл и норма</h2>
              {cycEditing ? editActions(saveCycle, () => setCycEditing(false)) : editBtn(() => setCycEditing(true))}
            </div>
            <div>
              <div className={fRow}><span className="text-sm text-gray-500">День старта цикла</span>
                {cycEditing
                  ? <input type="number" min={1} max={31} value={cycDraft.day} onChange={e => setCycDraft(d => ({ ...d, day: e.target.value }))} className={editIn + ' w-16 text-center'} />
                  : <span className="text-sm font-semibold text-right">{p.cycleStartDay ? `${p.cycleStartDay}-е число` : '—'}</span>}
              </div>
              <div className={fRow}><span className="text-sm text-gray-500">Текущий цикл</span>
                <span className="text-sm font-semibold text-right">{cycle ? fmtCycleRange(cycle.start, cycle.end) : '—'}</span></div>
              <div className={fRow}><span className="text-sm text-gray-500">Норма за цикл</span>
                {cycEditing
                  ? <span className="flex items-center gap-2 text-gray-500"><Film size={14} /><input type="number" min={0} value={cycDraft.reels} onChange={e => setCycDraft(d => ({ ...d, reels: e.target.value }))} className={editIn + ' w-14 text-center'} /><ImageIcon size={14} /><input type="number" min={0} value={cycDraft.posts} onChange={e => setCycDraft(d => ({ ...d, posts: e.target.value }))} className={editIn + ' w-14 text-center'} /></span>
                  : <span className="inline-flex items-center gap-3 text-sm font-semibold" style={{ color }}><span className="inline-flex items-center gap-1"><Film size={15} /> {p.normReels ?? 0}</span><span className="inline-flex items-center gap-1"><ImageIcon size={15} /> {p.normPosts ?? 0}</span></span>}
              </div>
              <div className={fRow}><span className="text-sm text-gray-500">Сторис в месяц</span>
                {cycEditing
                  ? <span className="flex items-center gap-2"><input type="number" min={0} value={cycDraft.spm} onChange={e => setCycDraft(d => ({ ...d, spm: e.target.value }))} placeholder="90" className={editIn + ' w-16 text-center'} /><span className="text-gray-400 text-[12.5px] whitespace-nowrap">· ≈ {perDayHint > 0 ? perDayHint : '—'}/день</span></span>
                  : <span className="text-sm font-semibold text-right">{p.storiesPerMonth != null && p.storiesPerMonth > 0 ? <>{p.storiesPerMonth} <span className="text-gray-400 font-medium text-[12.5px]">· ≈ {Math.max(1, Math.round(p.storiesPerMonth / daysInMonth))}/день</span></> : '—'}</span>}
              </div>
              <div className={fRow}><span className="text-sm text-gray-500">Запланировано в календаре</span><span className="text-sm font-semibold text-right">{norm > 0 ? `${placed} из ${norm}` : '—'}</span></div>
              <div className={fRow}><span className="text-sm text-gray-500">Осталось в «Не запланировано»</span><span className="text-sm font-semibold text-right">{left}</span></div>
            </div>
          </div>

          {/* Выполнение плана */}
          <div className={card}>
            <h2 className={secLabel + ' mb-3'}>Выполнение плана · {monthTitle}</h2>
            <div className="space-y-3">
              <PlanBar icon={<Film size={14} />} label="Рилсы" done={reelsDone} total={reelsNorm} color="#10b981" />
              <PlanBar icon={<ImageIcon size={14} />} label="Посты" done={postsDone} total={postsNorm} color="#3b82f6" />
              <div>
                <div className="flex justify-between text-sm mb-1.5"><span className="text-gray-500 inline-flex items-center gap-1.5">📸 Сторис за месяц</span><span className="font-bold tabular-nums">{storiesTotal}{spm ? ` / ${spm}` : ''}</span></div>
                <div className="h-[7px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct(storiesTotal, spm ?? storiesTotal)}%`, background: '#8b5cf6' }} /></div>
                {dayTarget > 0 && <div className="flex gap-3 mt-2 text-[12px] font-semibold"><span className="text-emerald-600">🟢 {discG}</span><span className="text-amber-500">🟡 {discY}</span><span className="text-red-500">🔴 {discR}</span><span className="text-gray-400 font-normal">дней</span></div>}
              </div>
            </div>
          </div>

          {/* О клиенте */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className={secLabel}>О клиенте</h2>
              {cliEditing ? editActions(saveClient, () => setCliEditing(false)) : editBtn(() => setCliEditing(true))}
            </div>
            <div>
              <div className={fRow}><span className="text-sm text-gray-500 shrink-0">Владелец бизнеса</span>
                {cliEditing
                  ? <input value={draft.ownerName} onChange={e => setDraft(d => ({ ...d, ownerName: e.target.value }))} placeholder="Имя" className={editIn + ' w-52 text-right'} />
                  : <span className="text-sm font-semibold text-right">{profile?.ownerName || '—'}</span>}
              </div>
              <div className={fRow}><span className="text-sm text-gray-500 shrink-0">Значимый день</span>
                {cliEditing
                  ? <span className="flex items-center gap-2 flex-1 min-w-0 justify-end"><input type="date" value={draft.keyDate} onChange={e => setDraft(d => ({ ...d, keyDate: e.target.value }))} className={editIn + ' w-[140px] shrink-0'} /><input value={draft.keyDateNote} onChange={e => setDraft(d => ({ ...d, keyDateNote: e.target.value }))} placeholder="Комментарий" className={editIn + ' flex-1 min-w-0'} /></span>
                  : <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-right">{profile?.keyDate ? <><Gift size={14} style={{ color }} />{fmtDate(profile.keyDate)}{profile.keyDateNote ? ` · ${profile.keyDateNote}` : ''}</> : '—'}</span>}
              </div>
              <div className={fRow}><span className="text-sm text-gray-500 shrink-0">Сотрудничаем с</span>
                {cliEditing
                  ? <input type="date" value={draft.collabSince} onChange={e => setDraft(d => ({ ...d, collabSince: e.target.value }))} className={editIn + ' w-[150px]'} />
                  : <span className="text-sm font-semibold text-right">{fmtDate(profile?.collabSince)}</span>}
              </div>
              <div className="h-[112px] pt-2.5 flex flex-col gap-1.5">
                <span className="text-sm text-gray-500">Предпочтения</span>
                {cliEditing
                  ? <textarea value={draft.preferences} onChange={e => setDraft(d => ({ ...d, preferences: e.target.value }))} placeholder="Тон, что любят/не любят, правила согласования…" className={inp + ' flex-1 w-full resize-none leading-relaxed'} />
                  : (profile?.preferences ? <p className="flex-1 overflow-auto text-sm leading-relaxed whitespace-pre-wrap">{profile.preferences}</p> : <p className="flex-1 text-sm text-gray-400">—</p>)}
              </div>
            </div>
          </div>
        </div>

        {/* ПРАВО — метрики */}
        <div className="space-y-4">
          <div className={card}>
            <h2 className={secLabel + ' mb-3'}>Метрики · история по месяцам</h2>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {METRICS.map(m => (
                <button key={m.key} onClick={() => setSelM(m.key)}
                  className={'inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border transition ' + (selM === m.key ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
                  <span className="w-2 h-2 rounded-full" style={{ background: m.color }} />{m.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <span className="text-4xl font-extrabold tabular-nums leading-none" style={{ color: selMeta.color }}>{selLatest.cur != null ? fmtNum(selLatest.cur) : '—'}</span>
              {selDelta != null && (
                <span className="inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg mb-0.5"
                  style={selDelta >= 0 ? { color: selMeta.color, background: selMeta.color + '22' } : { color: '#ef4444', background: '#ef444422' }}>
                  {selDelta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {(selDelta >= 0 ? '+' : '−') + fmtNum(Math.abs(selDelta))}{selLatest.prev ? ` · ${(selDelta / selLatest.prev * 100).toFixed(1)}%` : ''}
                </span>
              )}
              <span className="ml-auto self-end text-xs text-gray-400">{selLatest.ym ? `${selMeta.label} · на ${mLabel(selLatest.ym)}` : 'нет данных'}</span>
            </div>
            <div className="mt-3"><MetricChart data={series(selM)} color={selMeta.color} /></div>

            <div className="grid grid-cols-4 gap-2 mt-4">
              {METRICS.map(m => {
                const l = latest(m.key); const d = l.cur != null && l.prev != null ? l.cur - l.prev : null
                return (
                  <button key={m.key} onClick={() => setSelM(m.key)}
                    className={'text-left rounded-xl px-2.5 py-2 border transition ' + (selM === m.key ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700')}>
                    <span className="flex items-center gap-1.5 text-[10.5px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />{m.label}</span>
                    <span className="block text-[15px] font-extrabold tabular-nums mt-0.5">{l.cur != null ? fmtNum(l.cur) : '—'}</span>
                    {d != null && <span className={'block text-[10.5px] font-bold ' + (d >= 0 ? 'text-emerald-600' : 'text-red-500')}>{(d >= 0 ? '+' : '−') + fmtNum(Math.abs(d))}</span>}
                  </button>
                )
              })}
            </div>

            {canEdit && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <input type="month" value={addYm} onChange={e => setAddYm(e.target.value)} className={inp + ' w-full mb-2'} />
                <div className="grid grid-cols-2 gap-2">
                  {METRICS.map(m => (
                    <input key={m.key} type="number" inputMode="numeric" placeholder={m.label} value={addV[m.key]} onChange={e => setAddV(v => ({ ...v, [m.key]: e.target.value }))} className={inp + ' w-full'} />
                  ))}
                </div>
                <button onClick={addMetrics} disabled={saveMut.isPending} className="w-full mt-2 inline-flex items-center justify-center gap-1 py-2.5 rounded-lg bg-[#3f7a58] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-60"><Plus size={15} /> Записать за месяц</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Отчёт — печатная страница для клиента */}
      {reportOpen && createPortal(
        <div id="smmrep">
          <style>{`@media print{ body>*:not(#smmrep){display:none!important} #smmrep .rov{position:static!important;background:#fff!important;padding:0!important;display:block!important;overflow:visible!important} #smmrep .rdoc{box-shadow:none!important;border:0!important;max-width:100%!important;border-radius:0!important} #smmrep .noprint{display:none!important} @page{margin:12mm} }`}</style>
          <div className="rov fixed inset-0 z-[60] bg-black/70 overflow-auto flex justify-center py-8 px-4" onClick={e => { if (e.target === e.currentTarget) setReportOpen(false) }}>
            <div className="rdoc relative bg-white text-gray-900 rounded-2xl w-full max-w-3xl p-9 shadow-2xl">
              <button onClick={() => setReportOpen(false)} className="noprint absolute top-4 right-4 text-gray-300 hover:text-gray-600"><X size={20} /></button>

              {/* Шапка: логотип WeBrand + проект/период */}
              <div className="flex items-end justify-between gap-4 pb-5 border-b-2 border-gray-100">
                <div>
                  <WeBrandLogo height={30} />
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#3068D8] mt-3">Отчёт по проекту</p>
                </div>
                <div className="text-right">
                  <h3 className="text-lg font-extrabold flex items-center gap-2 justify-end"><span className="w-3 h-3 rounded-full" style={{ background: color }} />{p.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">{cycle ? fmtCycleRange(cycle.start, cycle.end) : monthTitle}</p>
                </div>
              </div>

              {/* KPI */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                {METRICS.map(m => {
                  const l = latest(m.key); const d = l.cur != null && l.prev != null ? l.cur - l.prev : null
                  return (
                    <div key={m.key} className="relative rounded-xl border border-gray-200 p-3.5 pl-4 overflow-hidden">
                      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: m.color }} />
                      <span className="text-[11px] text-gray-500 font-medium">{m.label}</span>
                      <span className="block text-[23px] font-extrabold tabular-nums mt-1 leading-none">{l.cur != null ? fmtNum(l.cur) : '—'}</span>
                      {d != null
                        ? <span className={'inline-flex items-center gap-0.5 text-[11px] font-bold mt-1.5 ' + (d >= 0 ? 'text-emerald-600' : 'text-red-500')}>{d >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{(d >= 0 ? '+' : '−') + fmtNum(Math.abs(d))} за месяц</span>
                        : <span className="block text-[11px] text-gray-300 mt-1.5">нет сравнения</span>}
                    </div>
                  )
                })}
              </div>

              {/* Графики */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                {METRICS.map(m => (
                  <div key={m.key} className="rounded-xl border border-gray-200 p-3.5 text-gray-500">
                    <div className="text-[11px] font-semibold flex items-center gap-1.5 mb-1.5 text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: m.color }} />{m.label}</div>
                    <MetricChart data={series(m.key)} color={m.color} w={320} h={96} axes={false} interactive={false} />
                  </div>
                ))}
              </div>

              {/* Выполнение плана */}
              <div className="rounded-xl border border-gray-200 p-4 mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Выполнение плана · {monthTitle}</p>
                <p className="text-sm text-gray-700">🎬 Рилсы <b className="text-gray-900">{reelsDone}/{reelsNorm}</b> · 🖼 Посты <b className="text-gray-900">{postsDone}/{postsNorm}</b> · 📸 Сторис <b className="text-gray-900">{storiesTotal}{spm ? `/${spm}` : ''}</b> за месяц{dayTarget > 0 ? <> · дисциплина <span className="text-emerald-600 font-semibold">🟢 {discG}</span> <span className="text-amber-500 font-semibold">🟡 {discY}</span> <span className="text-red-500 font-semibold">🔴 {discR}</span></> : ''}</p>
              </div>
              {(profile?.ownerName || profile?.collabSince || profile?.preferences) && (
                <div className="rounded-xl border border-gray-200 p-4 mt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Клиент</p>
                  <p className="text-sm text-gray-700">{profile?.ownerName || '—'}{profile?.collabSince ? ` · сотрудничаем с ${fmtDate(profile.collabSince)}` : ''}{profile?.preferences ? <> · <span className="text-gray-600">{profile.preferences}</span></> : ''}</p>
                </div>
              )}

              {/* Подвал */}
              <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-gray-100 text-[11px] text-gray-400">
                <span className="font-semibold text-gray-500">WeBrand — digital-агентство</span>
                <span>Сформировано {fmtDate(iso(now))}</span>
              </div>

              <div className="noprint flex justify-end mt-5">
                <button onClick={printReport} className="inline-flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-[#3068D8] text-white hover:brightness-110"><Printer size={16} /> Печать / Сохранить PDF</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function PlanBar({ icon, label, done, total, color }: { icon: ReactNode; label: string; done: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5"><span className="text-gray-500 inline-flex items-center gap-1.5">{icon} {label}</span><span className="font-bold tabular-nums">{done} / {total}</span></div>
      <div className="h-[7px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  )
}
