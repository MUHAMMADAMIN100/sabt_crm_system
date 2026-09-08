import { useRef, useState, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { projColor } from './smmShared'
import { ChevronLeft, Loader2, GripVertical } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

type Proj = { id: string; name: string }
type Spec = { id: string; name: string; avatar: string | null; projects: Proj[] }
type LoadData = { specialists: Spec[]; unassigned: Proj[] }

const UNASSIGNED = '__unassigned__'
const byName = (a: Proj, b: Proj) => a.name.localeCompare(b.name, 'ru')

// ── Компоненты уровня модуля: стабильная идентичность, чтобы ре-рендер при
//    dragOver НЕ ремаунтил перетаскиваемую карточку (иначе нативный DnD рвётся). ──
function ProjectCard({ p, fromSpecId, onStart, onEnd }: {
  p: Proj; fromSpecId: string | null; onStart: (p: Proj, from: string | null) => void; onEnd: () => void
}) {
  return (
    <div
      draggable
      onDragStart={() => onStart(p, fromSpecId)}
      onDragEnd={onEnd}
      className="group flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-gray-300 dark:hover:border-gray-600 select-none"
    >
      <GripVertical size={14} className="text-gray-300 dark:text-gray-600 group-hover:text-gray-400 shrink-0" />
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: projColor(p.id) }} />
      <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-200 truncate">{p.name}</span>
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
        'rounded-2xl border p-4 transition min-h-[160px]',
        accent === 'amber'
          ? 'border-dashed border-amber-300/60 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
        over && 'ring-2 ring-primary-500/60 border-primary-400',
      )}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        {header}
        <span className={clsx('text-[13px] font-extrabold tabular-nums',
          accent === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400')}>{count}</span>
      </div>
      <div className={clsx('h-1.5 rounded-full overflow-hidden mb-3',
        accent === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-100 dark:bg-gray-800')}>
        <div className={clsx('h-full rounded-full', accent === 'amber' ? 'bg-amber-400' : 'bg-primary-500')}
          style={{ width: `${Math.round(load / maxLoad * 100)}%` }} />
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

/**
 * Страница «СММ-специалисты и проекты» (Вариант B — доска нагрузки) с
 * перетаскиванием: тащим проект из колонки одного специалиста в колонку
 * другого (или в «Не назначены») — проект переназначается. Нативный HTML5-DnD,
 * оптимистичное обновление кэша, запись через setSmmProfile(smmSpecialistIds).
 */
export default function SmmSpecialistLoadPage() {
  const qc = useQueryClient()
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

  // Текущие специалисты проекта — из тех колонок, где он присутствует.
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
    // Оптимистично переносим карточку в кэше.
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

  return (
    <div className="space-y-5">
      <div>
        <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-1.5"><ChevronLeft size={16} /> Проекты</Link>
        <h1 className="text-2xl font-bold tracking-tight">СММ-специалисты и проекты</h1>
        <p className="text-sm text-gray-400 mt-0.5">Перетащите проект на другого специалиста, чтобы переназначить</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : specialists.length === 0 && unassigned.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-16">Нет данных</p>
      ) : (
        <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          {specialists.map(s => (
            <Column
              key={s.id} colKey={s.id} count={s.projects.length} load={s.projects.length} maxLoad={maxLoad}
              accent="primary" over={overCol === s.id} onOver={onOver} onDrop={onDrop}
              header={
                <>
                  <Avatar name={s.name} src={s.avatar || undefined} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100 truncate">{s.name}</p>
                    <p className="text-[11px] text-gray-400">SMM-специалист</p>
                  </div>
                </>
              }
            >
              {s.projects.length
                ? s.projects.map(p => <ProjectCard key={p.id} p={p} fromSpecId={s.id} onStart={onStart} onEnd={onEnd} />)
                : <p className="text-[11.5px] text-gray-400 text-center py-3">Перетащите проект сюда</p>}
            </Column>
          ))}

          <Column
            key={UNASSIGNED} colKey={UNASSIGNED} count={unassigned.length} load={unassigned.length} maxLoad={maxLoad}
            accent="amber" over={overCol === UNASSIGNED} onOver={onOver} onDrop={onDrop}
            header={
              <>
                <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg font-bold shrink-0">?</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-amber-700 dark:text-amber-300">Не назначены</p>
                  <p className="text-[11px] text-amber-600/70 dark:text-amber-400/70">нужен специалист</p>
                </div>
              </>
            }
          >
            {unassigned.length
              ? unassigned.map(p => <ProjectCard key={p.id} p={p} fromSpecId={null} onStart={onStart} onEnd={onEnd} />)
              : <p className="text-[11.5px] text-amber-600/70 dark:text-amber-400/70 text-center py-3">Все проекты распределены</p>}
          </Column>
        </div>
      )}
    </div>
  )
}
