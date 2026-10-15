import { useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Avatar } from '@/components/ui'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { SmmProjectMiniBox, MINI_CLS, type SmmCard } from './SmmProjectCard'
import { Column } from './SmmSpecialistBoard'

type Proj = { id: string; name: string; specialists: string[] }
type Manager = { id: string; name: string; avatar: string | null; projects: Proj[] }
type LoadData = { managers: Manager[]; unassigned: Proj[] }

const UNASSIGNED = '__unassigned__'
const KEY = ['smm-manager-load']
const byName = (a: Proj, b: Proj) => a.name.localeCompare(b.name, 'ru')

// Стабильный (module-level) компонент — чтобы ре-рендер при dragOver не
// ремаунтил перетаскиваемую карточку (иначе нативный DnD рвётся).
function ManagerCard({ p, fromId, card, canDrag, onStart, onEnd, onOpen }: {
  p: Proj; fromId: string | null; card: SmmCard; canDrag: boolean
  onStart: (p: Proj, from: string | null) => void; onEnd: () => void; onOpen: (id: string) => void
}) {
  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? () => onStart(p, fromId) : undefined}
      onDragEnd={canDrag ? onEnd : undefined}
      onClick={() => onOpen(p.id)}
      className={MINI_CLS + (canDrag ? ' cursor-grab active:cursor-grabbing' : ' cursor-pointer') + ' hover:border-gray-300 dark:hover:border-gray-600 select-none'}
    >
      <SmmProjectMiniBox c={card} />
      {/* Кто ведёт контент — чтобы менеджер видел, с кем работать по проекту. */}
      <div className={'mt-1.5 text-[10.5px] font-semibold truncate ' + (p.specialists.length ? 'text-gray-500 dark:text-gray-400' : 'text-amber-600 dark:text-amber-400')}>
        {p.specialists.length ? `SMM: ${p.specialists.join(', ')}` : 'SMM не назначен'}
      </div>
    </div>
  )
}

/**
 * «Схема менеджеров» (вариант А, решение владельца 10.10.2026): та же доска,
 * что у SMM-специалистов, но колонки — менеджеры по продажам. У проекта один
 * ответственный менеджер (smmData.salesManagerId); перетаскивать карточки
 * может только владелец, остальные доску видят.
 */
export default function SmmManagerBoard({ cardById }: { cardById: (id: string) => SmmCard | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery<LoadData>({ queryKey: KEY, queryFn: () => projectsApi.smmManagerLoad() })
  const managers = data?.managers ?? []
  const unassigned = data?.unassigned ?? []
  const maxLoad = Math.max(1, ...managers.map(m => m.projects.length), unassigned.length)

  const role = useAuthStore(s => s.user?.role)
  const canReassign = role === 'founder'

  const dragRef = useRef<{ project: Proj; fromId: string | null } | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const persist = useMutation({
    mutationFn: (v: { projectId: string; managerId: string | null }) => projectsApi.setSmmManager(v.projectId, v.managerId),
    onError: () => { toast.error('Не удалось назначить менеджера') },
    onSettled: () => { qc.invalidateQueries({ queryKey: KEY }) },
  })

  const onStart = useCallback((project: Proj, fromId: string | null) => { dragRef.current = { project, fromId } }, [])
  const onEnd = useCallback(() => { dragRef.current = null; setOverCol(null) }, [])
  const onOver = useCallback((k: string) => { if (canReassign) setOverCol(prev => (prev === k ? prev : k)) }, [canReassign])
  const onOpen = useCallback((id: string) => navigate(`/smm/projects/${id}`), [navigate])

  const onDrop = (colKey: string) => {
    if (!canReassign) return
    const toId = colKey === UNASSIGNED ? null : colKey
    const info = dragRef.current
    dragRef.current = null
    setOverCol(null)
    if (!info || info.fromId === toId) return
    const { project } = info
    // У проекта один менеджер: убираем из прежней колонки, кладём в новую.
    qc.setQueryData<LoadData>(KEY, old => {
      if (!old) return old
      const list = old.managers.map(m => ({
        ...m,
        projects: m.id === toId
          ? [...m.projects.filter(p => p.id !== project.id), project].sort(byName)
          : m.projects.filter(p => p.id !== project.id),
      }))
      const un = old.unassigned.filter(p => p.id !== project.id)
      return { managers: list, unassigned: toId ? un : [...un, project].sort(byName) }
    })
    persist.mutate({ projectId: project.id, managerId: toId })
  }

  const fallback = (p: Proj): SmmCard => ({ id: p.id, name: p.name, color: '#8a97a6', day: null, reels: 0, posts: 0, norm: 0, left: 0, pct: null })
  const cardOf = (p: Proj, fromId: string | null) => (
    <ManagerCard key={p.id} p={p} fromId={fromId} card={cardById(p.id) ?? fallback(p)}
      canDrag={canReassign} onStart={onStart} onEnd={onEnd} onOpen={onOpen} />
  )

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-400" /></div>
  if (managers.length === 0 && unassigned.length === 0)
    return <p className="text-sm text-gray-400 text-center py-16">Нет данных</p>

  return (
    <div className="space-y-3">
      {managers.length === 0 && (
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          Менеджеров по продажам пока нет. Колонка появится, когда у сотрудника будет роль «Менеджер по продажам».
        </p>
      )}
      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {managers.map(m => (
          <Column
            key={m.id} colKey={m.id} count={m.projects.length} load={m.projects.length} maxLoad={maxLoad}
            accent="primary" over={overCol === m.id} onOver={onOver} onDrop={onDrop}
            header={
              <>
                <Avatar name={m.name} src={m.avatar || undefined} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100 truncate">{m.name}</p>
                  <p className="text-[11px] text-gray-400">Менеджер по продажам</p>
                </div>
              </>
            }
          >
            {m.projects.length
              ? m.projects.map(p => cardOf(p, m.id))
              : <p className="text-[11.5px] text-gray-400 text-center py-4">{canReassign ? 'Перетащите проект сюда' : 'Нет проектов'}</p>}
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
                <p className="text-[11px] text-amber-600/70 dark:text-amber-400/70">нужен менеджер</p>
              </div>
            </>
          }
        >
          {unassigned.length
            ? unassigned.map(p => cardOf(p, null))
            : <p className="text-[11.5px] text-amber-600/70 dark:text-amber-400/70 text-center py-4">У всех проектов есть менеджер</p>}
        </Column>
      </div>
    </div>
  )
}
