import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ChevronLeft, Film, Image as ImageIcon, Pencil, Check, Plus, TrendingUp, TrendingDown, Gift } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { assignProjectColors, projColor, cycleBoundsFor, fmtCycleRange, type SmmProj } from './smmShared'

type Ev = { projectId: string }
type CalData = { projects: SmmProj[]; backlog: Ev[] }
type Follower = { ym: string; value: number }
type SmmProfile = { ownerName: string | null; keyDate: string | null; keyDateNote: string | null; collabSince: string | null; preferences: string | null; followers: Follower[] }

// Кто может редактировать: SMM и владелец/руководство.
const EDIT_ROLES = ['founder', 'co_founder', 'admin', 'smm_director', 'smm_specialist']
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtNum = (n: number) => n.toLocaleString('ru-RU')
const mLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1] ?? ''} ${y}` }
const fmtDate = (v?: string | null) => v ? new Date(v + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
const inp = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500'
const card = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5'
const secLabel = 'text-[11px] font-bold uppercase tracking-wider text-gray-400'
// Строка фиксированной высоты: поле редактирования встаёт РОВНО на место значения — при входе
// в «Изменить» раскладка не сдвигается (высота карточки постоянна).
const fRow = 'flex items-center justify-between gap-3 h-[46px] border-b border-gray-100 dark:border-gray-800 last:border-0'
const editIn = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg h-8 px-2.5 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500'

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-500">{k}</span>
      <span className="text-sm font-semibold text-right">{v}</span>
    </div>
  )
}
// Крупный график подписчиков: сетка + значения по оси + подписи месяцев + точки + тултип при наведении.
function SubsChart({ data }: { data: Follower[] }) {
  const [hi, setHi] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  if (data.length < 2) return <div className="h-[188px] flex items-center justify-center text-sm text-gray-400">Добавь ещё месяц — построю график роста</div>
  const W = 460, H = 188, pl = 46, pr = 14, pt = 16, pb = 30
  const iw = W - pl - pr, ih = H - pt - pb
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
  const mShort = (ym: string) => MONTHS[+ym.split('-')[1] - 1].slice(0, 3)
  const onMove = (e: { clientX: number }) => { const r = svgRef.current!.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; setHi(Math.max(0, Math.min(data.length - 1, Math.round((px - pl) / (iw / (data.length - 1)))))) }
  const cur = hi ?? data.length - 1
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full text-gray-400 dark:text-gray-500 select-none touch-none" onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      {gv.map((tv, i) => { const yy = Y(tv); return (
        <g key={i}>
          <line x1={pl} y1={yy} x2={W - pr} y2={yy} stroke="currentColor" strokeOpacity="0.14" />
          <text x={pl - 8} y={yy + 3} textAnchor="end" fontSize="10" fill="currentColor">{fmtNum(tv)}</text>
        </g>
      ) })}
      <path d={area} fill="rgba(16,185,129,.13)" />
      <path d={line} fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (i % step === 0 || i === data.length - 1)
        ? <text key={i} x={X(i)} y={H - 9} textAnchor="middle" fontSize="10" fill="currentColor">{mShort(d.ym)}</text> : null)}
      {data.map((d, i) => <circle key={i} cx={X(i)} cy={Y(d.value)} r={i === cur ? 4 : 2.4} fill="#10b981" />)}
      {hi != null && (() => {
        const d = data[hi], hx = X(hi), hy = Y(d.value), tw = 96, tx = Math.max(2, Math.min(W - tw - 2, hx - tw / 2)), ty = Math.max(2, hy - 46)
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

export default function SmmProjectPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = EDIT_ROLES.includes((user as any)?.role ?? '')

  const now = new Date()
  const from = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
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
    const numOrNull = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null }
    cycleMut.mutate({ day: numOrNull(cycDraft.day), normReels: numOrNull(cycDraft.reels) ?? 0, normPosts: numOrNull(cycDraft.posts) ?? 0, storiesPerMonth: numOrNull(cycDraft.spm) })
    setCycEditing(false)
  }

  // ── Подписчики ──
  const followers = profile?.followers ?? []
  const last = followers[followers.length - 1]
  const prev = followers[followers.length - 2]
  const delta = last && prev ? last.value - prev.value : null
  const [addYm, setAddYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [addVal, setAddVal] = useState('')
  const addFollowers = () => {
    const v = parseInt(addVal, 10)
    if (!/^\d{4}-\d{2}$/.test(addYm) || !Number.isFinite(v)) return
    const map = new Map(followers.map(f => [f.ym, f.value])); map.set(addYm, v)
    const next = [...map.entries()].map(([ym, value]) => ({ ym, value })).sort((a, b) => a.ym < b.ym ? -1 : 1)
    saveMut.mutate({ followers: next }); setAddVal('')
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

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
  if (!info || !p) return (
    <div className="space-y-4">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <p className="text-gray-400">Проект не найден.</p>
    </div>
  )

  const { color, norm, left, placed, cycle } = info
  const editBtn = (editing: boolean, onEdit: () => void) => canEdit ? (
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
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
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
              {cycEditing ? editActions(saveCycle, () => setCycEditing(false)) : editBtn(false, () => setCycEditing(true))}
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

          {/* О клиенте */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className={secLabel}>О клиенте</h2>
              {cliEditing ? editActions(saveClient, () => setCliEditing(false)) : editBtn(false, () => setCliEditing(true))}
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

        {/* ПРАВО — графики */}
        <div className="space-y-4">
          <div className={card}>
            <h2 className={secLabel + ' mb-2'}>Подписчики · история по месяцам</h2>
            <div className="flex items-end gap-3 flex-wrap">
              <span className="text-4xl font-extrabold tracking-tight tabular-nums leading-none">{last ? fmtNum(last.value) : '—'}</span>
              {delta != null && (
                <span className={'inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg mb-0.5 ' + (delta >= 0 ? 'text-emerald-600 bg-emerald-500/10' : 'text-red-500 bg-red-500/10')}>
                  {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {(delta >= 0 ? '+' : '−') + fmtNum(Math.abs(delta))}{prev && prev.value ? ` · ${(delta / prev.value * 100).toFixed(1)}%` : ''}
                </span>
              )}
              <span className="ml-auto self-end text-xs text-gray-400">{last ? `на ${mLabel(last.ym)}` : 'нет данных'}</span>
            </div>
            <div className="mt-3"><SubsChart data={followers} /></div>

            {followers.length > 0 && (
              <div className="mt-4 border-t border-gray-100 dark:border-gray-800 max-h-72 overflow-y-auto">
                {[...followers].reverse().map((f, i, arr) => {
                  const pr = arr[i + 1]; const d = pr ? f.value - pr.value : null
                  return (
                    <div key={f.ym} className="grid grid-cols-[1fr_auto_64px] items-center gap-3 py-2 text-sm border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      <span className="text-gray-500 capitalize">{mLabel(f.ym)}</span>
                      <span className="font-bold tabular-nums text-right">{fmtNum(f.value)}</span>
                      <span className={'text-xs font-semibold tabular-nums text-right ' + (d == null ? 'text-gray-300 dark:text-gray-600' : d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-500' : 'text-gray-400')}>
                        {d == null ? '—' : (d > 0 ? '+' : '') + fmtNum(d)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {canEdit && (
              <div className="flex gap-2 mt-4">
                <input type="month" value={addYm} onChange={e => setAddYm(e.target.value)} className={inp + ' w-[140px]'} />
                <input type="number" inputMode="numeric" placeholder="Подписчиков" value={addVal} onChange={e => setAddVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addFollowers() }} className={inp + ' flex-1 min-w-0'} />
                <button onClick={addFollowers} disabled={saveMut.isPending} className="inline-flex items-center gap-1 px-4 rounded-lg bg-[#3f7a58] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-60"><Plus size={15} /> Записать</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
