import { useMemo, useState, useEffect, type ReactNode } from 'react'
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

// Кто может редактировать профиль клиента: SMM и владелец/руководство.
const EDIT_ROLES = ['founder', 'co_founder', 'admin', 'smm_director', 'smm_specialist']
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtNum = (n: number) => n.toLocaleString('ru-RU')
const mLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1] ?? ''} ${y}` }
const fmtDate = (v?: string | null) => v ? new Date(v + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-500">{k}</span>
      <span className="text-sm font-semibold text-right">{v}</span>
    </div>
  )
}

// Мини-спарклайн истории подписчиков.
function Spark({ vals }: { vals: number[] }) {
  if (vals.length < 2) return null
  const W = 148, H = 40, pad = 4
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1
  const pts = vals.map((v, i) => [pad + i * (W - 2 * pad) / (vals.length - 1), H - pad - (v - mn) / rng * (H - 2 * pad)] as const)
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = `${d} L ${pts[pts.length - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`
  return (
    <svg width={W} height={H} className="shrink-0">
      <path d={area} fill="rgba(16,185,129,.14)" />
      <path d={d} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="#10b981" />
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
  const { data, isLoading } = useQuery<CalData>({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
  })
  const { data: profile } = useQuery<SmmProfile>({
    queryKey: ['smm-profile', id],
    queryFn: () => projectsApi.getSmmProfile(id!),
    enabled: !!id,
  })
  const saveMut = useMutation({
    mutationFn: (patch: Partial<SmmProfile>) => projectsApi.setSmmProfile(id!, patch as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-profile', id] }); toast.success('Сохранено') },
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

  // ── История подписчиков ──
  const followers = profile?.followers ?? []
  const last = followers[followers.length - 1]
  const prev = followers[followers.length - 2]
  const delta = last && prev ? last.value - prev.value : null
  const [addYm, setAddYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [addVal, setAddVal] = useState('')
  const addFollowers = () => {
    const v = parseInt(addVal, 10)
    if (!/^\d{4}-\d{2}$/.test(addYm) || !Number.isFinite(v)) return
    const map = new Map(followers.map(f => [f.ym, f.value]))
    map.set(addYm, v)
    const next = [...map.entries()].map(([ym, value]) => ({ ym, value })).sort((a, b) => a.ym < b.ym ? -1 : 1)
    saveMut.mutate({ followers: next })
    setAddVal('')
  }

  // ── О клиенте (редактирование) ──
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ ownerName: '', keyDate: '', keyDateNote: '', collabSince: '', preferences: '' })
  useEffect(() => {
    if (profile && !editing) setDraft({
      ownerName: profile.ownerName ?? '', keyDate: profile.keyDate ?? '', keyDateNote: profile.keyDateNote ?? '',
      collabSince: profile.collabSince ?? '', preferences: profile.preferences ?? '',
    })
  }, [profile, editing])
  const saveClient = () => {
    saveMut.mutate({
      ownerName: draft.ownerName || null, keyDate: draft.keyDate || null, keyDateNote: draft.keyDateNote || null,
      collabSince: draft.collabSince || null, preferences: draft.preferences || null,
    })
    setEditing(false)
  }

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
  if (!info) return (
    <div className="space-y-4">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <p className="text-gray-400">Проект не найден.</p>
    </div>
  )

  const { p, color, norm, left, placed, cycle } = info
  const inp = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500'
  return (
    <div className="space-y-5 max-w-2xl">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: color }} />
        <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
      </div>

      {/* Цикл и норма */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-2">
        <Row k="День старта цикла" v={p.cycleStartDay ? `${p.cycleStartDay}-е число` : '—'} />
        <Row k="Текущий цикл" v={cycle ? fmtCycleRange(cycle.start, cycle.end) : '—'} />
        <Row k="Норма за цикл" v={norm > 0
          ? <span className="inline-flex items-center gap-3" style={{ color }}>
              <span className="inline-flex items-center gap-1"><Film size={15} /> {p.normReels ?? 0}</span>
              <span className="inline-flex items-center gap-1"><ImageIcon size={15} /> {p.normPosts ?? 0}</span>
            </span>
          : '—'} />
        <Row k="Запланировано в календаре" v={norm > 0 ? `${placed} из ${norm}` : '—'} />
        <Row k="Осталось в «Не запланировано»" v={left} />
      </div>

      {/* Подписчики — история по месяцам */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Подписчики · история по месяцам</h2>
        <div className="flex items-end gap-4 flex-wrap">
          <span className="text-4xl font-extrabold tracking-tight tabular-nums leading-none">{last ? fmtNum(last.value) : '—'}</span>
          {delta != null && (
            <span className={'inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg mb-0.5 '
              + (delta >= 0 ? 'text-emerald-600 bg-emerald-500/10' : 'text-red-500 bg-red-500/10')}>
              {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {(delta >= 0 ? '+' : '−') + fmtNum(Math.abs(delta))}{prev && prev.value ? ` · ${(delta / prev.value * 100).toFixed(1)}%` : ''}
            </span>
          )}
          <div className="ml-auto"><Spark vals={followers.slice(-10).map(f => f.value)} /></div>
        </div>
        <p className="text-xs text-gray-400 mt-2">{last ? `на ${mLabel(last.ym)}` : 'нет данных'}</p>

        {followers.length > 0 && (
          <div className="mt-4 border-t border-gray-100 dark:border-gray-800 max-h-56 overflow-y-auto">
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
            <input type="number" inputMode="numeric" placeholder="Подписчиков" value={addVal} onChange={e => setAddVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addFollowers() }} className={inp + ' flex-1 min-w-0'} />
            <button onClick={addFollowers} disabled={saveMut.isPending}
              className="inline-flex items-center gap-1 px-4 rounded-lg bg-[#3f7a58] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-60">
              <Plus size={15} /> Записать
            </button>
          </div>
        )}
      </div>

      {/* О клиенте */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">О клиенте</h2>
          {canEdit && (editing
            ? <button onClick={saveClient} disabled={saveMut.isPending}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#3f7a58] text-white hover:brightness-110 disabled:opacity-60"><Check size={14} /> Сохранить</button>
            : <button onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"><Pencil size={13} /> Редактировать</button>)}
        </div>

        {editing ? (
          <div className="space-y-3">
            <label className="block"><span className="text-xs text-gray-500">Владелец бизнеса</span>
              <input value={draft.ownerName} onChange={e => setDraft(d => ({ ...d, ownerName: e.target.value }))} placeholder="Имя" className={inp + ' w-full mt-1'} /></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-xs text-gray-500">Значимый день</span>
                <input type="date" value={draft.keyDate} onChange={e => setDraft(d => ({ ...d, keyDate: e.target.value }))} className={inp + ' w-full mt-1'} /></label>
              <label className="block"><span className="text-xs text-gray-500">Комментарий к дню</span>
                <input value={draft.keyDateNote} onChange={e => setDraft(d => ({ ...d, keyDateNote: e.target.value }))} placeholder="Напр. День рождения" className={inp + ' w-full mt-1'} /></label>
            </div>
            <label className="block"><span className="text-xs text-gray-500">Сотрудничаем с</span>
              <input type="date" value={draft.collabSince} onChange={e => setDraft(d => ({ ...d, collabSince: e.target.value }))} className={inp + ' w-full mt-1'} /></label>
            <label className="block"><span className="text-xs text-gray-500">Предпочтения</span>
              <textarea value={draft.preferences} onChange={e => setDraft(d => ({ ...d, preferences: e.target.value }))} rows={4}
                placeholder="Тон, что любят/не любят, правила согласования…" className={inp + ' w-full mt-1 resize-y leading-relaxed'} /></label>
          </div>
        ) : (
          <div>
            <Row k="Владелец бизнеса" v={profile?.ownerName || '—'} />
            <Row k="Значимый день" v={profile?.keyDate
              ? <span className="inline-flex items-center gap-1.5"><Gift size={14} style={{ color }} />{fmtDate(profile.keyDate)}{profile.keyDateNote ? ` · ${profile.keyDateNote}` : ''}</span>
              : '—'} />
            <Row k="Сотрудничаем с" v={fmtDate(profile?.collabSince)} />
            <div className="py-3">
              <p className="text-sm text-gray-500 mb-1.5">Предпочтения</p>
              {profile?.preferences
                ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{profile.preferences}</p>
                : <p className="text-sm text-gray-400">—</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
