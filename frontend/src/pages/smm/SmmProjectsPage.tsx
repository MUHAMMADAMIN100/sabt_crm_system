import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Film, Image as ImageIcon, CalendarRange, Plus, Archive, RotateCcw, LayoutGrid } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { assignProjectColors, projColor, type SmmProj } from './smmShared'
import SmmProjectCreateModal from './SmmProjectCreateModal'

// Кто может создавать проекты (как на основной странице «Проекты»).
const CREATE_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'sales_manager_smm']

type Ev = { projectId: string }
type CalData = { projects: SmmProj[]; backlog: Ev[] }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function SmmProjectsPage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const canCreate = CREATE_ROLES.includes((user as any)?.role ?? '')
  const [showCreate, setShowCreate] = useState(false)
  // Вкладки: активные / архив завершённых. Архив по умолчанию скрыт.
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const now = new Date()
  const from = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))

  const { data, isLoading } = useQuery<CalData>({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
  })

  const projects = data?.projects ?? []
  const backlog = data?.backlog ?? []

  // Архив — завершённые SMM-проекты (isArchived=true). Для восстановления.
  const qc = useQueryClient()
  const { data: archivedData } = useQuery<any[]>({
    queryKey: ['smm-archived'],
    queryFn: () => projectsApi.list({ archived: 'true' }),
    enabled: canCreate,
  })
  const archived = ((archivedData as any[]) || []).filter(p => p.projectType === 'SMM')
  const restoreMut = useMutation({
    mutationFn: (pid: string) => projectsApi.restore(pid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-archived'] }); qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Проект возвращён') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось вернуть'),
  })

  const cards = useMemo(() => {
    assignProjectColors(projects.map(p => p.id))
    const backlogBy = new Map<string, number>()
    for (const b of backlog) backlogBy.set(b.projectId, (backlogBy.get(b.projectId) ?? 0) + 1)
    return projects.map(p => {
      const norm = (p.normReels ?? 0) + (p.normPosts ?? 0)
      return {
        id: p.id, name: p.name, color: projColor(p.id),
        day: p.cycleStartDay ?? null,
        reels: p.normReels ?? 0, posts: p.normPosts ?? 0,
        norm, left: backlogBy.get(p.id) ?? 0,
      }
    })
  }, [projects, backlog])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Проекты</h1>
        {canCreate && (
          <button onClick={() => setShowCreate(true)}
            className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={16} /> Добавить проект
          </button>
        )}
      </div>
      {/* Вкладки «Активные / Архив» — архив показывается только по клику.
          Показываем переключатель лишь тем, у кого есть архив (canCreate). */}
      {canCreate && archived.length > 0 && (
        <div className="inline-flex bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-1 gap-1">
          {([['active', 'Активные', LayoutGrid, projects.length], ['archived', 'Архив', Archive, archived.length]] as const).map(([k, label, Ic, n]) => (
            <button key={k} onClick={() => setTab(k)}
              className={'inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-lg transition ' + (tab === k ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
              <Ic size={14} /> {label} <span className="text-[11px] font-bold opacity-60 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'archived' && canCreate && archived.length > 0 ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {archived.map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 px-3 py-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-700 shrink-0" />
              <span className="text-sm font-semibold text-gray-500 truncate flex-1">{p.name}</span>
              <button onClick={() => restoreMut.mutate(p.id)} disabled={restoreMut.isPending}
                className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-60">
                <RotateCcw size={13} /> Вернуть
              </button>
            </div>
          ))}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {cards.map(c => (
            <button key={c.id} type="button" onClick={() => navigate(`/smm/projects/${c.id}`)}
              className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition hover:border-gray-300 dark:hover:border-gray-600">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-[15px] font-bold truncate">{c.name}</span>
                <span className="ml-auto text-[12px] font-bold tabular-nums shrink-0" style={{ color: c.color }}>
                  {c.norm > 0 ? `${c.norm}/${c.left}` : '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg"
                  style={c.day ? { background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color } : { background: 'rgba(128,128,128,0.12)', color: 'rgb(156,163,175)' }}>
                  <CalendarRange size={13} /> {c.day ? `цикл с ${c.day}-го` : 'цикл не задан'}
                </span>
                {c.norm > 0 && <>
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg" style={{ background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color }}><Film size={13} /> {c.reels}</span>
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg" style={{ background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color }}><ImageIcon size={13} /> {c.posts}</span>
                </>}
              </div>
            </button>
          ))}
        </div>
      )}
      {showCreate && <SmmProjectCreateModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
