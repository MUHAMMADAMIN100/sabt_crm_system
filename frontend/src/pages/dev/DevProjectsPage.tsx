// «Разработка → Проекты» (макет 14.10.2026). Своя страница раздела вместо
// списка SMM-проектов: раньше карточка dev-проекта показывала «цикл»,
// «рилс · пост» и норму. Теперь — тип, этап с процентом, срок сдачи,
// команда и задачи доски.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, LayoutGrid, Loader2, Plus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { devTrackerApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import { Avatar } from '@/components/ui'
import { selectDevProjects, type DevTask } from '@/pages/dev-board/devBoardTypes'
import DevProjectCreateModal from './components/DevProjectCreateModal'
import { DevTypeChip } from './components/DevTypeChip'
import { deadlineInfo, overdueWord, projectTaskCounts, shortDay, stageOf, tasksWord } from './devProjects'

type Person = { id: string; name: string; avatar?: string | null }
type DevProject = {
  id: string; name: string; projectType?: string | null; devStage?: number | null
  endDate?: string | null; manager?: Person | null; members?: Person[]; membersCount?: number
}

/** Стек аватаров команды: проект-менеджер первым, без повторов. */
function TeamStack({ p }: { p: DevProject }) {
  const seen = new Set<string>()
  const people = [p.manager, ...(p.members ?? [])].filter((x): x is Person => {
    if (!x?.id || seen.has(x.id)) return false
    seen.add(x.id)
    return true
  })
  if (!people.length) return null
  const shown = people.slice(0, 4)
  // Сервер держит проект-менеджера в составе, поэтому membersCount — это
  // вся команда; в members приходят только первые пятеро.
  const total = Math.max(people.length, p.membersCount ?? 0)
  const rest = total - shown.length
  return (
    <span className="flex items-center" title={people.map(x => x.name).join(', ')}>
      {shown.map((x, i) => (
        <span key={x.id} className={clsx('rounded-full ring-2 ring-surface-50 dark:ring-surface-800', i > 0 && '-ml-1.5')}>
          <Avatar name={x.name} src={x.avatar || undefined} size={24} />
        </span>
      ))}
      {rest > 0 && <span className="-ml-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-surface-200 px-1 text-[10px] font-bold text-surface-600 ring-2 ring-surface-50 dark:bg-surface-700 dark:text-surface-300 dark:ring-surface-800">+{rest}</span>}
    </span>
  )
}

export default function DevProjectsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canCreate = userCan(user, 'projects.create')
  const canArchive = userCan(user, 'projects.archive')
  const seesBoard = userCan(user, 'dev-tracker.view')
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [showCreate, setShowCreate] = useState(false)

  // Сервер сам отдаёт команде разработки только dev-проекты; руководству —
  // все, поэтому отбираем dev-типы здесь.
  const { data: list, isLoading } = useQuery<DevProject[]>({
    queryKey: ['projects', 'dev-section'],
    queryFn: () => projectsApi.list(),
  })
  const projects = useMemo(() => selectDevProjects(list ?? [])
    .sort((a, b) => a.name.localeCompare(b.name, 'ru')), [list])

  const { data: archivedList } = useQuery<DevProject[]>({
    queryKey: ['projects', 'dev-section', 'archived'],
    queryFn: () => projectsApi.list({ archived: 'true' }),
    enabled: canArchive,
  })
  const archived = useMemo(() => selectDevProjects(archivedList ?? [])
    .sort((a, b) => a.name.localeCompare(b.name, 'ru')), [archivedList])
  const restoreMut = useMutation({
    mutationFn: (pid: string) => projectsApi.restore(pid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Проект возвращён') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось вернуть'),
  })

  // Задачи доски — одним запросом на все проекты (тот же список, что у доски).
  const { data: tasks } = useQuery<DevTask[]>({
    queryKey: ['dev-tracker', 'list', 'by-project'],
    queryFn: () => devTrackerApi.list(),
    enabled: seesBoard,
    staleTime: 60_000,
    retry: false,
  })
  const counts = useMemo(() => projectTaskCounts(Array.isArray(tasks) ? tasks : []), [tasks])

  const showArchive = canArchive && archived.length > 0

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-surface-500">Разработка</span>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <h1 className="page-title">Проекты</h1>
          {showArchive && (
            <div className="inline-flex gap-1 rounded-[10px] border border-surface-200 bg-surface-200/70 p-[3px] dark:border-surface-700 dark:bg-surface-800">
              {([['active', 'Активные', LayoutGrid, projects.length], ['archived', 'Архив', Archive, archived.length]] as const).map(([k, label, Ic, n]) => (
                <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
                  className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors',
                    tab === k
                      ? 'bg-surface-50 text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-50'
                      : 'text-surface-500 hover:text-surface-800 dark:hover:text-surface-200')}>
                  <Ic size={14} /> {label} <span className="tabular-nums opacity-70">{n}</span>
                </button>
              ))}
            </div>
          )}
          {canCreate && (
            <button type="button" onClick={() => setShowCreate(true)}
              className="ml-auto inline-flex items-center gap-1.5 min-h-[36px] rounded-[10px] px-4 text-sm font-semibold text-white bg-[#2D5DA8] hover:bg-[#244C8C]">
              <Plus size={16} /> Проект
            </button>
          )}
        </div>
      </div>

      {tab === 'archived' && showArchive ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {archived.map(p => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-100/60 px-3 py-2.5 dark:border-surface-700 dark:bg-surface-900/40">
              <span className="flex-1 truncate text-sm font-semibold text-surface-600 dark:text-surface-300">{p.name}</span>
              <button type="button" onClick={() => restoreMut.mutate(p.id)} disabled={restoreMut.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-surface-300 px-2.5 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-50 disabled:opacity-60 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700">
                <RotateCcw size={13} /> Вернуть
              </button>
            </div>
          ))}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-surface-400" /></div>
      ) : !projects.length ? (
        <p className="py-16 text-center text-sm text-surface-500">Проектов разработки пока нет</p>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))' }}>
          {projects.map(p => {
            const stage = stageOf(p.devStage)
            const dl = deadlineInfo(p.endDate)
            const c = counts.get(p.id)
            return (
              <button key={p.id} type="button" onClick={() => navigate(`/dev/projects/${p.id}`)}
                className="card flex flex-col gap-3 text-left hover:border-surface-400 dark:hover:border-surface-500">
                <div className="flex w-full items-start gap-2.5">
                  <h2 className="min-w-0 flex-1 text-[16px] font-semibold leading-snug text-surface-900 dark:text-surface-50">{p.name}</h2>
                  <DevTypeChip type={p.projectType} />
                </div>
                <div className="flex w-full flex-col gap-1.5">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate text-surface-600 dark:text-surface-300">
                      {stage ? `Этап ${stage.num} · ${stage.label}` : 'Этап не задан'}
                    </span>
                    <span className="font-semibold tabular-nums text-surface-900 dark:text-surface-100">{stage ? `${stage.pct} %` : '—'}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                    <div className="h-full rounded-full bg-[#2D5DA8] dark:bg-[#6F95D6]" style={{ width: `${stage?.pct ?? 0}%` }} />
                  </div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
                  {dl ? (
                    <>
                      <span className={clsx('font-semibold', dl.overdue ? 'text-red-600 dark:text-red-400' : 'text-surface-900 dark:text-surface-100')}>Сдача {shortDay(p.endDate)}</span>
                      <span className={dl.overdue ? 'text-red-600 dark:text-red-400' : 'text-surface-500'}>{dl.text}</span>
                    </>
                  ) : (
                    <span className="text-surface-500">Срок сдачи не задан</span>
                  )}
                  <span className="ml-auto flex items-center gap-2.5">
                    <TeamStack p={p} />
                    {seesBoard && (
                      <span className="text-surface-600 dark:text-surface-300">
                        {tasksWord(c?.open ?? 0)}
                        {!!c?.overdue && <> · <b className="font-semibold text-red-600 dark:text-red-400">{overdueWord(c.overdue)}</b></>}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {showCreate && <DevProjectCreateModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
