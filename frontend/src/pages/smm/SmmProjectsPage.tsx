import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Archive, RotateCcw, LayoutGrid, Network } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { contentPlanApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { isDevProjectType } from '@/lib/projectType'
import { assignProjectColors, projColor, useSmmSection, SECTION_BASE, type SmmProj } from './smmShared'
import SmmProjectCreateModal from './SmmProjectCreateModal'
import { SmmProjectCardBox, CARD_CLS, type SmmCard } from './SmmProjectCard'
import { DevTeamStack } from '@/pages/dev/components/DevTeamStack'
import type { DevTeamPerson } from '@/pages/dev/devTeam'
import SmmSpecialistBoard from './SmmSpecialistBoard'

// Кто может создавать проекты (как на основной странице «Проекты») — по разделам.
// СММ-специалист тоже может добавлять проект (по просьбе владельца); в
// «Разработке» — только роли с нативным правом projects.create.
const CREATE_ROLES: Record<'smm' | 'dev', string[]> = {
  smm: ['admin', 'founder', 'co_founder', 'smm_director', 'sales_manager_smm', 'smm_specialist'],
  dev: ['admin', 'founder', 'co_founder', 'dev_director', 'sales_manager_dev'],
}
// Кто видит схему нагрузки СММ (кто ведёт какие проекты). Специалист её ВИДИТ,
// но переставлять проекты не может (DnD-переназначение отключено в доске).
// Схема — про СММ-специалистов, в разделе «Разработка» не показывается.
const LOAD_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'smm_specialist']

type Ev = { projectId: string; kind?: string; contentType?: string; status?: string }
type CalData = { projects: SmmProj[]; backlog: Ev[]; events: Ev[] }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function SmmProjectsPage() {
  const navigate = useNavigate()
  const section = useSmmSection()
  const base = SECTION_BASE[section]
  const user = useAuthStore(s => s.user)
  const canCreate = CREATE_ROLES[section].includes((user as any)?.role ?? '')
  // Открытие формы прямо по адресу: так на неё ведёт кнопка создания
  // из нижней панели на телефоне.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('new') !== '1' || !canCreate) return
    setShowCreate(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, canCreate])
  const canSeeLoad = section === 'smm' && LOAD_ROLES.includes((user as any)?.role ?? '')
  const [showCreate, setShowCreate] = useState(false)
  // Вкладки: активные / архив завершённых. Архив по умолчанию скрыт.
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  // Вид: сетка проектов ↔ схема «кто ведёт какие проекты» (плавно, без перехода).
  const [view, setView] = useState<'grid' | 'schema'>('grid')
  const [schemaSeen, setSchemaSeen] = useState(false)
  const toggleSchema = () => { setView(v => (v === 'schema' ? 'grid' : 'schema')); setSchemaSeen(true) }
  const now = new Date()
  const from = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))

  const { data, isLoading } = useQuery<CalData>({
    queryKey: ['smm-calendar', section, from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to, segment: section }),
  })

  const projects = data?.projects ?? []
  const backlog = data?.backlog ?? []
  const events = data?.events ?? []

  // Архив — завершённые проекты раздела (isArchived=true). Для восстановления.
  const qc = useQueryClient()
  const { data: archivedData } = useQuery<any[]>({
    queryKey: ['smm-archived'],
    queryFn: () => projectsApi.list({ archived: 'true' }),
    enabled: canCreate,
  })
  const archived = ((archivedData as any[]) || []).filter(p =>
    section === 'dev' ? isDevProjectType(p.projectType) : p.projectType === 'SMM')
  const restoreMut = useMutation({
    mutationFn: (pid: string) => projectsApi.restore(pid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['smm-archived'] }); qc.invalidateQueries({ queryKey: ['smm-calendar'] }); toast.success('Проект возвращён') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось вернуть'),
  })

  const cards = useMemo<SmmCard[]>(() => {
    assignProjectColors(projects.map(p => p.id))
    const backlogBy = new Map<string, number>()
    for (const b of backlog) backlogBy.set(b.projectId, (backlogBy.get(b.projectId) ?? 0) + 1)
    // Опубликовано за месяц по проекту (рилсы/посты) — для % успеваемости.
    const doneBy = new Map<string, number>()
    for (const e of events) {
      if (e.kind === 'publication' && e.status === 'published'
          && (e.contentType === 'reel' || e.contentType === 'video' || e.contentType === 'design')) {
        doneBy.set(e.projectId, (doneBy.get(e.projectId) ?? 0) + 1)
      }
    }
    return projects.map(p => {
      const norm = (p.normReels ?? 0) + (p.normPosts ?? 0)
      const done = doneBy.get(p.id) ?? 0
      const pct = norm > 0 ? Math.min(100, Math.round(done / norm * 100)) : null
      return {
        id: p.id, name: p.name, color: projColor(p.id),
        day: p.cycleStartDay ?? null,
        reels: p.normReels ?? 0, posts: p.normPosts ?? 0,
        norm, left: backlogBy.get(p.id) ?? 0, pct,
      }
    })
  }, [projects, backlog, events])
  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])

  // Состав dev-проектов для стека аватаров (только раздел «Разработка»).
  // GET /projects отдаёт manager + members (до 5) + membersCount по контракту.
  // SMM-ветка запрос не делает, её рендер не меняется.
  const { data: devTeamList } = useQuery<any[]>({
    queryKey: ['projects', 'dev-team'],
    queryFn: () => projectsApi.list(),
    enabled: section === 'dev',
    retry: false,
  })
  const devTeamById = useMemo(() => {
    const m = new Map<string, { manager: DevTeamPerson | null; members: DevTeamPerson[]; membersCount: number }>()
    if (!Array.isArray(devTeamList)) return m
    for (const p of devTeamList) {
      if (!p?.id) continue
      const ms = Array.isArray(p.members) ? p.members : []
      m.set(p.id, {
        manager: p.manager ?? null,
        members: ms,
        membersCount: typeof p.membersCount === 'number' ? p.membersCount : ms.length,
      })
    }
    return m
  }, [devTeamList])

  const layerCls = (active: boolean) =>
    clsx('transition-all duration-300 ease-out', active
      ? 'opacity-100 scale-100'
      : 'opacity-0 scale-[.99] pointer-events-none absolute inset-0')

  return (
    <div className="space-y-5">
      {/* Навигация по разделу «Разработка» — в сайдбаре (DEV_SUBNAV),
          in-page полосы табов нет (убрана как дубль). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-title">Проекты</h1>
        <div className="flex items-center gap-2">
          {canSeeLoad && (
            <button onClick={toggleSchema} title="Кто ведёт какие проекты"
              className={clsx('inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-xl border transition',
                view === 'schema'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800')}>
              <Network size={16} /> Схема
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowCreate(true)}
              className="btn-primary inline-flex items-center gap-1.5">
              <Plus size={16} /> Добавить проект
            </button>
          )}
        </div>
      </div>

      {/* Плавное переключение: сетка проектов ↔ схема нагрузки (Вариант А). */}
      <div className="relative">
        {/* Слой «сетка проектов» */}
        <div className={layerCls(view === 'grid')}>
          {/* Вкладки «Активные / Архив» — архив показывается только по клику. */}
          {canCreate && archived.length > 0 && (
            <div className="inline-flex bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-1 gap-1 mb-4">
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
              {cards.map(c => {
                const team = devTeamById.get(c.id)
                return (
                  <button key={c.id} type="button" onClick={() => navigate(`${base}/projects/${c.id}`)}
                    className={CARD_CLS + ' text-left w-full hover:border-gray-300 dark:hover:border-gray-600'}>
                    <SmmProjectCardBox c={c} />
                    {/* Состав dev-проекта: стек команды + кто ведёт. Только раздел
                        «Разработка» — в SMM-ветке условие ложно и DOM не меняется. */}
                    {section === 'dev' && team && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 min-w-0">
                        <DevTeamStack manager={team.manager} members={team.members} membersCount={team.membersCount} />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Слой «схема нагрузки» — монтируется после первого открытия (для плавного crossfade). */}
        {schemaSeen && (
          <div className={layerCls(view === 'schema')}>
            <SmmSpecialistBoard cardById={id => cardById.get(id) ?? null} />
          </div>
        )}
      </div>

      {showCreate && <SmmProjectCreateModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
