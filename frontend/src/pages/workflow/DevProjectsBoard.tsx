import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, tasksApi, employeesApi } from '@/services/api.service'
import { PageLoader } from '@/components/ui'
import { CalendarDays, Plus, User as UserIcon } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { projectTypeLabel } from '@/lib/projectType'
import TaskDrawer from '@/components/tasks/TaskDrawer'

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

/** Кого можно назначить исполнителем карточки на доске «Разработка»:
 *  вся команда разработки — разработчики и проект-менеджер по разработке.
 *  Участие в проекте не требуется. */
const DEV_ASSIGNEE_ROLES = ['developer', 'pm_dev']

/** Кто двигает карточки — зеркало @Roles на PATCH /projects/:id/dev-stage. */
const MOVE_ROLES = ['admin', 'founder', 'co_founder', 'dev_director', 'pm_dev', 'developer']

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

  // Карточки этапов — задачи с devStage (создаются «+» в колонке). Живут в
  // разделе «Задачи» как обычные задачи; здесь — их представление на доске.
  const { data: allTasks } = useQuery({
    queryKey: ['tasks', 'dev-board'],
    queryFn: () => tasksApi.list(),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  })
  const devProjectIds = useMemo(() => new Set(devProjects.map((p: any) => p.id)), [devProjects])
  const stageTasks = useMemo(
    () => ((allTasks as any[]) || []).filter((t: any) =>
      Number(t.devStage) >= 1 && t.status !== 'cancelled' && devProjectIds.has(t.projectId)),
    [allTasks, devProjectIds],
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
    // Тай-брейк по id обязателен: одноимённые проекты (три «Архидеи») без него
    // меняются местами после каждого фонового рефетча — «перетаскивается не та».
    for (const k of Object.keys(map)) {
      map[Number(k)].sort((a, b) =>
        String(a.name).localeCompare(String(b.name), 'ru') || String(a.id).localeCompare(String(b.id)))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devProjects, pending])

  const dropPending = (id: string) => setPending(s => { const n = { ...s }; delete n[id]; return n })
  // Счётчик перемещений по id: два быстрых переноса одной карточки подряд —
  // завершение ПЕРВОГО запроса не должно снимать оверлей ВТОРОГО (карточка
  // падала на серверное место, «сбрасывается при переносе через 2 этапа»).
  const moveSeq = useRef<Record<string, number>>({})
  const moveMut = useMutation({
    mutationFn: ({ id, devStage }: { id: string; devStage: number }) => projectsApi.setDevStage(id, devStage),
    onMutate: ({ id, devStage }) => {
      moveSeq.current[id] = (moveSeq.current[id] || 0) + 1
      setPending(s => ({ ...s, [id]: devStage }))
      return { seq: moveSeq.current[id] }
    },
    onError: (e: any, { id }, ctx) => {
      if (ctx?.seq === moveSeq.current[id]) dropPending(id)
      toast.error(e?.response?.data?.message || 'Не удалось сменить этап')
    },
    // Оверлей снимаем только когда свежие данные уже в кэше — без прыжка назад,
    // и только если это ПОСЛЕДНЕЕ перемещение карточки.
    onSuccess: async (_d, { id }, ctx) => {
      await qc.invalidateQueries({ queryKey: ['projects'] })
      if (ctx?.seq === moveSeq.current[id]) dropPending(id)
    },
  })

  // Тот же паттерн оптимистичного оверлея — для карточек-задач этапов.
  const [taskPending, setTaskPending] = useState<Record<string, number>>({})
  const taskStageOf = (t: any) => taskPending[t.id] ?? clampStage(t.devStage)
  const dropTaskPending = (id: string) => setTaskPending(s => { const n = { ...s }; delete n[id]; return n })
  const taskSeq = useRef<Record<string, number>>({})
  const taskMoveMut = useMutation({
    mutationFn: ({ id, devStage }: { id: string; devStage: number }) => tasksApi.update(id, { devStage }),
    onMutate: ({ id, devStage }) => {
      taskSeq.current[id] = (taskSeq.current[id] || 0) + 1
      setTaskPending(s => ({ ...s, [id]: devStage }))
      return { seq: taskSeq.current[id] }
    },
    onError: (e: any, { id }, ctx) => {
      if (ctx?.seq === taskSeq.current[id]) dropTaskPending(id)
      toast.error(e?.response?.data?.message || 'Не удалось сменить этап')
    },
    onSuccess: async (_d, { id }, ctx) => {
      await qc.invalidateQueries({ queryKey: ['tasks', 'dev-board'] })
      if (ctx?.seq === taskSeq.current[id]) dropTaskPending(id)
    },
  })

  const byStageTasks = useMemo(() => {
    const map: Record<number, any[]> = {}
    for (const s of DEV_STAGES) map[s.num] = []
    for (const t of stageTasks) map[taskStageOf(t)].push(t)
    for (const k of Object.keys(map)) {
      map[Number(k)].sort((a, b) =>
        String(a.title).localeCompare(String(b.title), 'ru') || String(a.id).localeCompare(String(b.id)))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageTasks, taskPending])

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<number | null>(null)
  // «+» в заголовке колонки: форма новой карточки этапа (проект, заголовок,
  // дедлайн, исполнители) — создаёт задачу с devStage.
  const [addStage, setAddStage] = useState<number | null>(null)
  // Клик по карточке-задаче — быстрый просмотр в TaskDrawer.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  // Клик по карточке — быстрый просмотр модалкой (полная страница — кнопкой внутри).
  // Храним только id: содержимое всегда берём из свежих данных запроса.
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const openProject = openProjectId ? devProjects.find((p: any) => p.id === openProjectId) ?? null : null
  // Проект исчез с доски (удалили/архивировали/сменили тип) — закрываем модалку,
  // иначе она жила бы на устаревшем снапшоте и мутировала мёртвый проект.
  useEffect(() => {
    if (openProjectId && !openProject && !isLoading) {
      setOpenProjectId(null)
      toast('Проект больше не на доске — карточка закрыта')
    }
  }, [openProjectId, openProject, isLoading])

  const handleDrop = (stageNum: number, e: DragEvent<HTMLDivElement>) => {
    setDragOverStage(null)
    // Два канала id: состояние (надёжно после тика dragstart) и dataTransfer
    // (синхронный канал dnd). Валидируем оба поиском карточки: в dataTransfer
    // при перетаскивании ВЫДЕЛЕННОГО ТЕКСТА карточки прилетает текст, а не id.
    // Префикс «task:» отличает карточку-задачу этапа от карточки проекта.
    const rawIds = [dragId, e.dataTransfer.getData('text/plain')].filter(Boolean) as string[]
    setDragId(null)
    for (const raw of rawIds) {
      if (raw.startsWith('task:')) {
        const t = stageTasks.find((x: any) => x.id === raw.slice(5))
        if (t) {
          if (taskStageOf(t) !== stageNum) taskMoveMut.mutate({ id: t.id, devStage: stageNum })
          return
        }
      } else {
        const project = devProjects.find((p: any) => p.id === raw)
        if (project) {
          if (stageOf(project) !== stageNum) moveMut.mutate({ id: project.id, devStage: stageNum })
          return
        }
      }
    }
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
        Этапы разработки · {canMove ? 'перетащите карточку на этап · «+» в колонке — новая карточка · ' : ''}клик — быстрый просмотр · наведите на заголовок колонки, чтобы увидеть описание этапа
      </p>
      {/* items-start убран намеренно: колонки растягиваются на высоту самой
          высокой (+min-h) и ловят бросок по ВСЕЙ высоте доски. Раньше пустая
          колонка была коробкой ~100px — быстрый бросок падал ниже неё в
          мёртвую зону, и браузер возвращал карточку на место. */}
      <div className="flex gap-3 overflow-x-auto pb-3 items-stretch min-h-[65vh]">
        {DEV_STAGES.map(stage => {
          const items = byStage[stage.num] || []
          const taskItems = byStageTasks[stage.num] || []
          return (
            <div
              key={stage.num}
              // По спецификации dnd колонка — валидная цель, только если отменены
              // И dragenter, И dragover. Без dragenter быстрый бросок (отпускание
              // раньше первого dragover) отклонялся — карточка отскакивала назад.
              // dropEffect='move' + preventDefault на drop гасят анимацию возврата.
              onDragEnter={e => { e.preventDefault(); setDragOverStage(stage.num) }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stage.num) }}
              onDragLeave={() => setDragOverStage(prev => (prev === stage.num ? null : prev))}
              onDrop={e => { e.preventDefault(); handleDrop(stage.num, e) }}
              className={clsx(
                'w-[250px] shrink-0 rounded-xl p-2 transition-colors flex flex-col',
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
                  <span className="text-[10px] font-semibold w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 inline-flex items-center justify-center">{items.length + taskItems.length}</span>
                  {canMove && (
                    <button type="button" title="Новая карточка на этом этапе" onClick={() => setAddStage(stage.num)}
                      className="w-5 h-5 inline-flex items-center justify-center rounded text-surface-400 hover:text-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">
                      <Plus size={12} />
                    </button>
                  )}
                </span>
              </div>
              <div className="space-y-2 min-h-[60px] flex-1">
                {items.length === 0 && taskItems.length === 0
                  ? <p className="text-[11px] text-surface-300 dark:text-surface-600 text-center py-4 select-none">Пусто</p>
                  : items.map((p: any) => (
                    <div
                      key={p.id}
                      draggable={canMove}
                      // setData обязателен — без него Firefox вообще не начинает dnd.
                      // setDragId — отложенно: синхронный ре-рендер (opacity-50 на
                      // перетаскиваемом узле) в тик dragstart в Chrome может
                      // молча отменить начатый перенос.
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', p.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setTimeout(() => setDragId(p.id), 0)
                      }}
                      onDragEnd={() => { setDragId(null); setDragOverStage(null) }}
                      onClick={() => setOpenProjectId(p.id)}
                      className={clsx(
                        // select-none: двойной клик выделял название, и следующий
                        // drag тащил ВЫДЕЛЕНИЕ вместо карточки (в drop приходил
                        // текст, перенос отклонялся или путал карточки).
                        'rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 p-2.5 shadow-sm cursor-pointer select-none',
                        'hover:border-primary-400 dark:hover:border-primary-500 transition-colors',
                        dragId === p.id && 'opacity-50',
                      )}
                    >
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 leading-snug">{p.name}</p>
                      <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5">{projectTypeLabel(p.projectType)}{p.manager?.name ? ` · ${p.manager.name}` : ''}</p>
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
                          className="sm:hidden mt-2 w-full text-[11px] rounded-md border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 px-1.5 py-1"
                          title="Сменить этап"
                        >
                          {DEV_STAGES.map(s => <option key={s.num} value={s.num}>[{s.pct}%] {s.label}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                {/* Карточки-задачи этапа (создаются «+»): заголовок, проект,
                    исполнитель, дедлайн. Клик — быстрый просмотр задачи. */}
                {taskItems.map((t: any) => {
                  const overdue = t.deadline && t.status !== 'done' &&
                    new Date(t.deadline) < new Date(new Date().toDateString())
                  const names: string[] = ((t.assignees || []).map((a: any) => a.user?.name).filter(Boolean))
                  if (names.length === 0 && t.assignee?.name) names.push(t.assignee.name)
                  return (
                    <div
                      key={t.id}
                      draggable={canMove}
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', 'task:' + t.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setTimeout(() => setDragId('task:' + t.id), 0)
                      }}
                      onDragEnd={() => { setDragId(null); setDragOverStage(null) }}
                      onClick={() => setOpenTaskId(t.id)}
                      className={clsx(
                        'rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 border-l-[3px] !border-l-primary-400 p-2.5 shadow-sm cursor-pointer select-none',
                        'hover:border-primary-400 dark:hover:border-primary-500 transition-colors',
                        dragId === 'task:' + t.id && 'opacity-50',
                      )}
                    >
                      <p className={clsx('text-sm font-medium leading-snug',
                        t.status === 'done' ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>
                        {t.title}
                      </p>
                      <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5 truncate">{t.project?.name}</p>
                      <div className="flex items-center justify-between mt-1.5 text-[11px] text-surface-500 dark:text-surface-400 gap-2">
                        <span className="inline-flex items-center gap-1 min-w-0">
                          {names.length > 0 && <>
                            <UserIcon size={11} className="shrink-0" />
                            <span className="truncate">{names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}</span>
                          </>}
                        </span>
                        {t.deadline && (
                          <span className={clsx('inline-flex items-center gap-1 shrink-0', overdue && 'text-red-500 font-semibold')}>
                            <CalendarDays size={11} /> {fmtDate(t.deadline)}
                          </span>
                        )}
                      </div>
                      {canMove && (
                        <select
                          value={taskStageOf(t)}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); taskMoveMut.mutate({ id: t.id, devStage: Number(e.target.value) }) }}
                          className="sm:hidden mt-2 w-full text-[11px] rounded-md border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 px-1.5 py-1"
                          title="Сменить этап"
                        >
                          {DEV_STAGES.map(s => <option key={s.num} value={s.num}>[{s.pct}%] {s.label}</option>)}
                        </select>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {addStage !== null && (
        <NewStageCardModal
          stage={DEV_STAGES.find(s => s.num === addStage)!}
          projects={devProjects}
          onClose={() => setAddStage(null)}
          onCreated={() => { qc.invalidateQueries({ queryKey: ['tasks', 'dev-board'] }); setAddStage(null) }}
        />
      )}

      <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />

      {openProject && (
        <ProjectQuickModal
          project={openProject}
          stageNum={stageOf(openProject)}
          canMove={canMove}
          onStage={n => moveMut.mutate({ id: openProject.id, devStage: n })}
          onOpenPage={() => navigate(`/projects/${openProject.id}`)}
          onClose={() => setOpenProjectId(null)}
        />
      )}
    </>
  )
}

/** Быстрый просмотр проекта с доски: сводка + смена этапа, без ухода со страницы. */
function ProjectQuickModal({ project: p, stageNum, canMove, onStage, onOpenPage, onClose }: {
  project: any
  stageNum: number
  canMove: boolean
  onStage: (n: number) => void
  onOpenPage: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const stage = DEV_STAGES.find(s => s.num === stageNum)
  const progress = Math.max(0, Math.min(100, Number(p.progress) || 0))

  return (
    // mousedown вместо click — иначе выделение описания с отпусканием за
    // краем диалога закрывало модалку. Фон — лёгкое размытие вместо чёрного.
    <div className="fixed inset-0 z-50 bg-surface-900/20 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={p.name}
        className="w-full max-w-md rounded-xl bg-white dark:bg-surface-800 shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100 leading-snug">{p.name}</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{projectTypeLabel(p.projectType)}{p.manager?.name ? ` · менеджер: ${p.manager.name}` : ''}</p>
          </div>
          <button type="button" aria-label="Закрыть" onClick={onClose}
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-surface-400 dark:text-surface-500">Сроки</p>
            <p className="text-surface-800 dark:text-surface-200 mt-0.5">{fmt(p.startDate)} — {fmt(p.endDate)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-surface-400 dark:text-surface-500">Участники</p>
            <p className="text-surface-800 dark:text-surface-200 mt-0.5">{Array.isArray(p.members) ? p.members.length : 0} чел.</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] text-surface-500 dark:text-surface-400 mb-1">
            <span>Прогресс по задачам</span><span>{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Этап разработки</p>
          {canMove ? (
            <select value={stageNum} onChange={e => onStage(Number(e.target.value))}
              className="w-full text-sm rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-100 px-2.5 py-2">
              {DEV_STAGES.map(s => <option key={s.num} value={s.num}>[{s.pct}%] {s.label}</option>)}
            </select>
          ) : (
            <p className="text-sm text-surface-800 dark:text-surface-200">
              <span className="text-primary-600 dark:text-primary-400">[{stage?.pct}%]</span> {stage?.label}
            </p>
          )}
          {stage && <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">{stage.hint}</p>}
        </div>

        {p.description && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Описание</p>
            <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line max-h-32 overflow-y-auto">{p.description}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors">
            Закрыть
          </button>
          <button type="button" onClick={onOpenPage} className="btn-primary text-sm">
            Открыть страницу проекта
          </button>
        </div>
      </div>
    </div>
  )
}

/** «+» в колонке: новая карточка этапа — создаёт ЗАДАЧУ в выбранном проекте
 *  (исполнители получают обычные уведомления о задаче, задача видна в разделе
 *  «Задачи» и на странице проекта) и показывает её карточкой в этой колонке. */
function NewStageCardModal({ stage, projects, onClose, onCreated }: {
  stage: { num: number; pct: number; label: string }
  projects: any[]
  onClose: () => void
  onCreated: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Кандидаты в исполнители — ВСЯ команда разработки, независимо от того,
  // числится человек в участниках проекта или нет: раньше список резался до
  // состава проекта, и в проекте без участников назначить было некого.
  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
  })
  const people = useMemo(() => {
    return (employees || [])
      .filter((e: any) => {
        // Назначать можно только тех, у кого есть учётная запись: в задаче
        // хранится ссылка на пользователя, а не на карточку сотрудника.
        const u = e.user
        if (!u?.id) return false
        if ((e.status || 'active') !== 'active') return false
        if (u.isBlocked || u.isActive === false) return false
        return DEV_ASSIGNEE_ROLES.includes(u.role)
      })
      .map((e: any) => ({
        id: e.user.id,
        name: e.fullName || e.user.name,
        position: e.position || (e.user.role === 'pm_dev' ? 'Проект-менеджер' : 'Разработчик'),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, 'ru'))
  }, [employees])
  const toggleAssignee = (id: string) =>
    setAssignees(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))

  async function save() {
    if (!projectId || !title.trim() || !deadline || busy) return
    setBusy(true)
    try {
      await tasksApi.create({
        projectId,
        title: title.trim(),
        deadline: deadline || undefined,
        assigneeIds: assignees.length ? assignees : undefined,
        devStage: stage.num,
      })
      toast.success('Карточка создана')
      onCreated()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось создать карточку')
      setBusy(false)
    }
  }

  return (
    // Закрытие по mousedown на самом оверлее: click-закрытие ловило отпускание
    // мыши при выделении текста, начатом внутри диалога.
    // Фон — лёгкое размытие вместо чёрного затемнения (как у TaskDrawer).
    <div className="fixed inset-0 z-50 bg-surface-900/20 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={`Новая карточка — ${stage.label}`}
        className="w-full max-w-md rounded-xl bg-white dark:bg-surface-800 shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">
            Новая карточка — <span className="text-primary-600 dark:text-primary-400">[{stage.pct}%]</span> {stage.label}
          </h3>
          <button type="button" aria-label="Закрыть" onClick={onClose}
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">✕</button>
        </div>

        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">Проект *</label>
          <select value={projectId} autoFocus
            onChange={e => setProjectId(e.target.value)}
            className="w-full text-sm rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-100 px-2.5 py-2">
            <option value="">— Выберите проект —</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name} · {p.projectType}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">Заголовок *</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Например: Настроить деплой на прод"
            className="w-full text-sm rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-100 px-2.5 py-2" />
        </div>

        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">Дедлайн *</label>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
            className="w-full text-sm rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-100 px-2.5 py-2" />
        </div>

        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">
            Исполнители <span className="text-surface-400">(можно несколько)</span>
          </label>
          {people.length === 0 ? (
            <p className="text-xs text-surface-400 dark:text-surface-500">
              В команде разработки пока нет сотрудников — карточку можно создать без исполнителя.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {people.map((m: any) => (
                <button key={m.id} type="button" onClick={() => toggleAssignee(m.id)}
                  title={m.position}
                  className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                    assignees.includes(m.id)
                      ? 'bg-primary-600 border-primary-600 text-white'
                      : 'bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:border-primary-400')}>
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors">
            Отмена
          </button>
          <button type="button" disabled={!projectId || !title.trim() || !deadline || busy} onClick={save}
            className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
