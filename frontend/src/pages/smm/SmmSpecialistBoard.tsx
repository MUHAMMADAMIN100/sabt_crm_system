import { useRef, useState, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { Loader2, GripVertical } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { SmmProjectCardBox, CARD_CLS, type SmmCard } from './SmmProjectCard'

type Proj = { id: string; name: string }
type Spec = { id: string; name: string; avatar: string | null; projects: Proj[] }
type LoadData = { specialists: Spec[]; unassigned: Proj[] }

const UNASSIGNED = '__unassigned__'
const byName = (a: Proj, b: Proj) => a.name.localeCompare(b.name, 'ru')

// Стабильные (module-level) компоненты — чтобы ре-рендер при dragOver не
// ремаунтил перетаскиваемую карточку (иначе нативный DnD рвётся).
function DragCard({ p, fromSpecId, card, onStart, onEnd, onOpen }: {
  p: Proj; fromSpecId: string | null; card: SmmCard
  onStart: (p: Proj, from: string | null) => void; onEnd: () => void; onOpen: (id: string) => void
}) {
  return (
    <div
      draggable
      onDragStart={() => onStart(p, fromSpecId)}
      onDragEnd={onEnd}
      onClick={() => onOpen(p.id)}
      className={CARD_CLS + ' relative cursor-grab active:cursor-grabbing hover:border-gray-300 dark:hover:border-gray-600 select-none'}
    >
      <GripVertical size={13} className="absolute top-2 right-2 text-gray-300 dark:text-gray-600" />
      <SmmProjectCardBox c={card} />
    </div>
  )
}

function Column({ colKey, header, count, load, maxLoad, accent, over, onOver, onDrop, children }: {
  colKey: string; header: ReactNode; count: number; load: number; maxLoad: number
  accent: 'primary' | 'amber'; over: boolean; onOver: (k: string) => void; onDrop: (k: string) => void; children: ReactNode
}) {
  return (
    <div
      onDragOver={e => { e.preventDefault(); onOver(colKey) }}
      onDrop={() => onDrop(colKey)}
      className={clsx(
        'rounded-2xl border p-3 transition min-h-[150px]',
        accent === 'amber'
          ? 'border-dashed border-amber-300/60 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10'
          : 'border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/30',
        over && 'ring-2 ring-primary-500/60 border-primary-400',
      )}
    >
      <div className="flex items-center gap-2.5 px-1 mb-2.5">
        {header}
        <span className={clsx('text-[13px] font-extrabold tabular-nums',
          accent === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400')}>{count}</span>
      </div>
      <div className={clsx('h-1.5 rounded-full overflow-hidden mb-3 mx-1',
        accent === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-200 dark:bg-gray-800')}>
        <div className={clsx('h-full rounded-full', accent === 'amber' ? 'bg-amber-400' : 'bg-primary-500')}
          style={{ width: `${Math.round(load / maxLoad * 100)}%` }} />
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

/**
 * Встраиваемая доска нагрузки СММ: колонка на каждого специалиста (аватар,
 * счётчик, полоска-нагрузка, его проекты полноценными карточками) + колонка
 * «Не назначены». Проекты можно перетаскивать между колонками — переназначение
 * через setSmmProfile(smmSpecialistIds), оптимистично. Карточки берём из
 * `cardById` (тот же вид, что в сетке «Проекты»).
 */
export default function SmmSpecialistBoard({ cardById }: { cardById: (id: string) => SmmCard | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery<LoadData>({
    queryKey: ['smm-specialist-load'],
    queryFn: () => projectsApi.smmSpecialistLoad(),
  })
  const specialists = data?.specialists ?? []
  const unassigned = data?.unassigned ?? []
  const maxLoad = Math.max(1, ...specialists.map(s => s.projects.length), unassigned.length)

  const dragRef = useRef<{ project: Proj; fromSpecId: string | null } | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const persist = useMutation({
    mutationFn: (v: { projectId: string; ids: string[] }) => projectsApi.setSmmProfile(v.projectId, { smmSpecialistIds: v.ids }),
    onError: () => { toast.error('Не удалось переназначить'); qc.invalidateQueries({ queryKey: ['smm-specialist-load'] }) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['smm-specialist-load'] }); qc.invalidateQueries({ queryKey: ['smm-calendar'] }) },
  })

  const onStart = useCallback((project: Proj, fromSpecId: string | null) => { dragRef.current = { project, fromSpecId } }, [])
  const onEnd = useCallback(() => { dragRef.current = null; setOverCol(null) }, [])
  const onOver = useCallback((k: string) => setOverCol(prev => (prev === k ? prev : k)), [])
  const onOpen = useCallback((id: string) => navigate(`/smm/projects/${id}`), [navigate])

  const currentIdsOf = (projectId: string) =>
    specialists.filter(s => s.projects.some(p => p.id === projectId)).map(s => s.id)

  const onDrop = (colKey: string) => {
    const toSpecId = colKey === UNASSIGNED ? null : colKey
    const info = dragRef.current
    dragRef.current = null
    setOverCol(null)
    if (!info) return
    const { project, fromSpecId } = info
    if (fromSpecId === toSpecId) return
    const set = new Set(currentIdsOf(project.id))
    if (fromSpecId) set.delete(fromSpecId)
    if (toSpecId) set.add(toSpecId)
    const newIds = [...set]
    qc.setQueryData<LoadData>(['smm-specialist-load'], (old) => {
      if (!old) return old
      const specs = old.specialists.map(s => ({ ...s, projects: s.projects.filter(p => p.id !== project.id) }))
      let un = old.unassigned.filter(p => p.id !== project.id)
      if (newIds.length === 0) un = [...un, project].sort(byName)
      else specs.forEach(s => { if (newIds.includes(s.id)) s.projects = [...s.projects, project].sort(byName) })
      return { specialists: specs, unassigned: un }
    })
    persist.mutate({ projectId: project.id, ids: newIds })
  }

  const fallback = (p: Proj): SmmCard => ({ id: p.id, name: p.name, color: '#8a97a6', day: null, reels: 0, posts: 0, norm: 0, left: 0 })

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-400" /></div>
  if (specialists.length === 0 && unassigned.length === 0)
    return <p className="text-sm text-gray-400 text-center py-16">Нет данных</p>

  return (
    <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {specialists.map(s => (
        <Column
          key={s.id} colKey={s.id} count={s.projects.length} load={s.projects.length} maxLoad={maxLoad}
          accent="primary" over={overCol === s.id} onOver={onOver} onDrop={onDrop}
          header={
            <>
              <Avatar name={s.name} src={s.avatar || undefined} size={34} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100 truncate">{s.name}</p>
                <p className="text-[11px] text-gray-400">SMM-специалист</p>
              </div>
            </>
          }
        >
          {s.projects.length
            ? s.projects.map(p => <DragCard key={p.id} p={p} fromSpecId={s.id} card={cardById(p.id) ?? fallback(p)} onStart={onStart} onEnd={onEnd} onOpen={onOpen} />)
            : <p className="text-[11.5px] text-gray-400 text-center py-4">Перетащите проект сюда</p>}
        </Column>
      ))}

      <Column
        key={UNASSIGNED} colKey={UNASSIGNED} count={unassigned.length} load={unassigned.length} maxLoad={maxLoad}
        accent="amber" over={overCol === UNASSIGNED} onOver={onOver} onDrop={onDrop}
        header={
          <>
            <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-base font-bold shrink-0">?</div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-amber-700 dark:text-amber-300">Не назначены</p>
              <p className="text-[11px] text-amber-600/70 dark:text-amber-400/70">нужен специалист</p>
            </div>
          </>
        }
      >
        {unassigned.length
          ? unassigned.map(p => <DragCard key={p.id} p={p} fromSpecId={null} card={cardById(p.id) ?? fallback(p)} onStart={onStart} onEnd={onEnd} onOpen={onOpen} />)
          : <p className="text-[11.5px] text-amber-600/70 dark:text-amber-400/70 text-center py-4">Все проекты распределены</p>}
      </Column>
    </div>
  )
}
