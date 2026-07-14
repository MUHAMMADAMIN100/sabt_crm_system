import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { PageLoader } from '@/components/ui'
import { CalendarDays, Plus } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'

/** Этапы разработки — бизнес-вехи с процентом готовности портфеля.
 *  Проценты в названиях колонок намеренно: открыв доску, сразу видно,
 *  сколько проектов «на экваторе» (50%), а сколько на финишной (90%). */
export const DEV_STAGES: { num: number; pct: number; label: string; hint: string }[] = [
  { num: 1, pct: 10, label: 'Сбор требований и ТЗ', hint: 'Требования, интервью, рамки проекта (Scope of Work), утверждение ТЗ. Результат: подписанное ТЗ, зафиксированные бюджет и сроки.' },
  { num: 2, pct: 25, label: 'Проектирование и Концепт', hint: 'Архитектура, прототипы, дизайн-концепции, блок-схемы. Результат: утверждённый прототип/макет, готовый к реализации.' },
  { num: 3, pct: 50, label: 'Активная фаза производства', hint: 'Разработка, вёрстка, сборка, программирование. Результат: готовое «ядро», черновая версия продукта.' },
  { num: 4, pct: 75, label: 'Внутренняя приёмка и QA', hint: 'Тестирование внутри команды, поиск багов, проверка соответствия ТЗ. Результат: стабильный проект, готовый к показу заказчику.' },
  { num: 5, pct: 90, label: 'Демонстрация и Согласование', hint: 'Презентация клиенту, сбор обратной связи, финальные косметические правки. Результат: финальное «да» от клиента.' },
  { num: 6, pct: 100, label: 'Внедрение и Передача', hint: 'Продакшн, передача доступов, акты сдачи-приёмки, обучение команды клиента. Результат: проект в реальной эксплуатации.' },
]

/** Типы dev-проектов — зеркало DEV_PROJECT_TYPES бэка (common/sales-segment). */
const DEV_TYPES = ['Web сайт', 'Лендинг', 'Телеграм бот', 'CRM система', 'Интернет магазин']

/** Кто двигает карточки — зеркало @Roles на PATCH /projects/:id/dev-stage. */
const MOVE_ROLES = ['admin', 'founder', 'co_founder', 'pm_dev']

const clampStage = (v: any): number => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 1
}

/** Доска «Разработка»: канбан dev-проектов по 6 бизнес-этапам.
 *  Перетаскивание (или селект на карточке) переводит проект на этап. */
export default function DevProjectsBoard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  // Вторая роль тоже даёт право — зеркально RolesGuard бэка (role ИЛИ secondaryRole).
  const canMove = MOVE_ROLES.includes(user?.role || '') || MOVE_ROLES.includes(user?.secondaryRole || '')

  const queryKey = ['projects', 'dev-board']
  const { data: projects, isLoading, isError, refetch } = useQuery({
    queryKey,
    // Для pm_dev бэкенд сам отдаёт только dev-проекты; для топ-ролей фильтруем тип на клиенте.
    queryFn: () => projectsApi.list(),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  })

  const devProjects = useMemo(
    () => (projects || []).filter((p: any) => DEV_TYPES.includes(p.projectType) && !p.isArchived),
    [projects],
  )

  // Оптимистичные перемещения — оверлеем поверх данных, а не записью в кэш:
  // сокет-рефетч (projects:changed прилетает на любую правку проектов/задач)
  // иначе возвращал карточку в старую колонку, пока PATCH ещё в полёте.
  const [pending, setPending] = useState<Record<string, number>>({})
  const stageOf = (p: any) => pending[p.id] ?? clampStage(p.devStage)

  const byStage = useMemo(() => {
    const map: Record<number, any[]> = {}
    for (const s of DEV_STAGES) map[s.num] = []
    for (const p of devProjects) map[stageOf(p)].push(p)
    for (const k of Object.keys(map)) map[Number(k)].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devProjects, pending])

  const dropPending = (id: string) => setPending(s => { const n = { ...s }; delete n[id]; return n })
  const moveMut = useMutation({
    mutationFn: ({ id, devStage }: { id: string; devStage: number }) => projectsApi.setDevStage(id, devStage),
    onMutate: ({ id, devStage }) => setPending(s => ({ ...s, [id]: devStage })),
    onError: (e: any, { id }) => {
      dropPending(id)
      toast.error(e?.response?.data?.message || 'Не удалось сменить этап')
    },
    // Оверлей снимаем только когда свежие данные уже в кэше — без прыжка назад.
    onSuccess: async (_d, { id }) => {
      await qc.invalidateQueries({ queryKey: ['projects'] })
      dropPending(id)
    },
  })

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<number | null>(null)
  // «+» в заголовке колонки: выбрать проект и поставить на этот этап без dnd.
  const [addStage, setAddStage] = useState<number | null>(null)

  const handleDrop = (stageNum: number) => {
    setDragOverStage(null)
    if (!dragId) return
    const project = devProjects.find((p: any) => p.id === dragId)
    setDragId(null)
    if (!project || stageOf(project) === stageNum) return
    moveMut.mutate({ id: project.id, devStage: stageNum })
  }

  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : null

  if (isLoading) return <PageLoader />
  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
        <span>Не удалось загрузить проекты разработки.</span>
        <button type="button" className="btn-primary text-sm" onClick={() => refetch()}>Повторить</button>
      </div>
    )
  }

  return (
    <>
      <p className="text-xs text-surface-500 dark:text-surface-400">
        Этапы разработки · {canMove ? 'перетащите карточку на этап или добавьте проект через «+» в колонке · ' : ''}клик — открыть проект · наведите на заголовок колонки, чтобы увидеть описание этапа
      </p>
      <div className="flex gap-3 overflow-x-auto pb-3 items-start">
        {DEV_STAGES.map(stage => {
          const items = byStage[stage.num] || []
          return (
            <div
              key={stage.num}
              // dropEffect='move' + preventDefault на drop подтверждают браузеру
              // успешный перенос — иначе он играет анимацию «возврата призрака»
              // (~300 мс), и перенос выглядит как лаг.
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stage.num) }}
              onDragLeave={() => setDragOverStage(prev => (prev === stage.num ? null : prev))}
              onDrop={e => { e.preventDefault(); handleDrop(stage.num) }}
              className={clsx(
                'w-[250px] shrink-0 rounded-xl p-2 transition-colors',
                dragOverStage === stage.num
                  ? 'bg-surface-100 dark:bg-surface-700/50 ring-2 ring-primary-400 dark:ring-primary-500'
                  : 'bg-surface-50 dark:bg-surface-800/50',
              )}
            >
              <div className="flex items-center justify-between px-1 pb-2 gap-1" title={stage.hint}>
                <span className="text-xs font-semibold text-surface-700 dark:text-surface-200 truncate">
                  <span className="text-primary-600 dark:text-primary-400">[{stage.pct}%]</span> {stage.label}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-semibold w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 inline-flex items-center justify-center">{items.length}</span>
                  {canMove && (
                    <button type="button" title="Поставить проект на этот этап" onClick={() => setAddStage(stage.num)}
                      className="w-5 h-5 inline-flex items-center justify-center rounded text-surface-400 hover:text-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">
                      <Plus size={12} />
                    </button>
                  )}
                </span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {items.length === 0
                  ? <p className="text-[11px] text-surface-300 dark:text-surface-600 text-center py-4 select-none">Пусто</p>
                  : items.map((p: any) => (
                    <div
                      key={p.id}
                      draggable={canMove}
                      // setData обязателен — без него Firefox вообще не начинает dnd.
                      onDragStart={e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; setDragId(p.id) }}
                      onDragEnd={() => { setDragId(null); setDragOverStage(null) }}
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className={clsx(
                        'rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 p-2.5 shadow-sm cursor-pointer',
                        'hover:border-primary-400 dark:hover:border-primary-500 transition-colors',
                        dragId === p.id && 'opacity-50',
                      )}
                    >
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 leading-snug">{p.name}</p>
                      <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5">{p.projectType}{p.manager?.name ? ` · ${p.manager.name}` : ''}</p>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-surface-500 dark:text-surface-400">
                        <span className="inline-flex items-center gap-1">
                          {p.endDate && <><CalendarDays size={11} /> {fmtDate(p.endDate)}</>}
                        </span>
                        <span title="Прогресс по задачам проекта">{Number(p.progress) || 0}% задач</span>
                      </div>
                      {/* Селект — только на мобильных: там нет перетаскивания.
                          На десктопе этап меняют dnd или «+» в колонке. */}
                      {canMove && (
                        <select
                          value={stageOf(p)}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); moveMut.mutate({ id: p.id, devStage: Number(e.target.value) }) }}
                          className="sm:hidden mt-2 w-full text-[11px] rounded-md border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-700 text-surface-600 dark:text-surface-300 px-1.5 py-1"
                          title="Сменить этап"
                        >
                          {DEV_STAGES.map(s => <option key={s.num} value={s.num}>[{s.pct}%] {s.label}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )
        })}
      </div>

      {addStage !== null && (
        <AddToStageModal
          stage={DEV_STAGES.find(s => s.num === addStage)!}
          projects={devProjects}
          stageOf={stageOf}
          onClose={() => setAddStage(null)}
          onPick={id => { moveMut.mutate({ id, devStage: addStage }); setAddStage(null) }}
        />
      )}
    </>
  )
}

/** «+» в колонке: выбрать dev-проект из списка и поставить на этот этап. */
function AddToStageModal({ stage, projects, stageOf, onPick, onClose }: {
  stage: { num: number; pct: number; label: string }
  projects: any[]
  stageOf: (p: any) => number
  onPick: (id: string) => void
  onClose: () => void
}) {
  // По умолчанию — первый проект, который ещё не на этом этапе.
  const candidates = projects.filter(p => stageOf(p) !== stage.num)
  const [selected, setSelected] = useState<string>(candidates[0]?.id ?? '')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Поставить проект на этап"
        className="w-full max-w-sm rounded-xl bg-white dark:bg-surface-800 shadow-xl p-4 space-y-3"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
          На этап <span className="text-primary-600 dark:text-primary-400">[{stage.pct}%]</span> {stage.label}
        </h3>
        {candidates.length === 0 ? (
          <p className="text-sm text-surface-500 dark:text-surface-400">Все проекты разработки уже на этом этапе.</p>
        ) : (
          <select value={selected} onChange={e => setSelected(e.target.value)} autoFocus
            className="w-full text-sm rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-700 text-surface-800 dark:text-surface-100 px-2.5 py-2">
            {candidates.map(p => {
              const cur = DEV_STAGES.find(s => s.num === stageOf(p))
              return <option key={p.id} value={p.id}>{p.name} · {p.projectType} — сейчас [{cur?.pct}%]</option>
            })}
          </select>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors">
            Отмена
          </button>
          <button type="button" disabled={!selected || candidates.length === 0}
            onClick={() => selected && onPick(selected)}
            className="btn-primary text-sm disabled:opacity-50">
            Поставить на этап
          </button>
        </div>
      </div>
    </div>
  )
}
