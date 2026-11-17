import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { tasksApi } from '@/services/api.service'
import { useSocketConnected } from '@/lib/socketState'
import { useAuthStore } from '@/store/auth.store'
import { Avatar, EmptyState, PageLoader } from '@/components/ui'
import QuickTaskSheet from '@/components/tasks/QuickTaskSheet'
import useNarrow from '@/hooks/useNarrow'
import { usePatchUrl, useUrlState } from '@/lib/urlState'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { normalizeTaskStatus } from '@/lib/taskStatus'
import { groupAssigned, groupMine, isSmmSpecialist, peopleLabel, serverMessage, taskAssignees } from '@/lib/taskCabinet'
import { dueLabel, whenLabel } from '@/lib/taskDue'
import type { CabinetTask, TaskPerson } from '@/types/taskCabinet'
import TaskReviewPanel from './TaskReviewPanel'

/**
 * Раздел «Задачи» — кабинет поручений для всех, кроме руководителей
 * разработки (у них полный список, TasksPage). Минималистичный, по макету
 * владельца (docs/SMM_DELEGATION_SPEC.md, 17.11.2026):
 *  · «Мне» — что поставили мне: «Сделать» (одна кнопка «Начать»/«Готово»),
 *    «Сдано, ждёт проверки», «Готово» (свёрнуто);
 *  · «Я поставил» — что поставил я: «Ждут вашей проверки», «В работе»,
 *    «Готово» (свёрнуто). Клик по задаче — проверка: панель справа на
 *    компьютере, экран поверх на телефоне.
 * Строка — аватар, название, «имя · срок». Без цветных плашек статусов:
 * просрочку выдаёт только красный срок.
 */

type Tab = 'auto' | 'mine' | 'assigned'
const TABS = ['auto', 'mine', 'assigned'] as const
/** Сколько строк «Готово» показывать за раз. */
const DONE_PAGE = 30

type StatusChange = { id: string; status: 'in_progress' | 'done'; projectId?: string | null }

// ─── Строки ──────────────────────────────────────────────────────────

function RowBody({ person, title, meta, extra }: {
  person: TaskPerson | null | undefined; title: string; meta: ReactNode; extra?: ReactNode
}) {
  return (
    <>
      <Avatar name={person?.name || undefined} src={person?.avatar || undefined} size={36} />
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[15px] font-medium text-surface-900 dark:text-surface-50 truncate">{title}</span>
        <span className="text-[13px] text-surface-500 dark:text-surface-400 truncate">{meta}</span>
        {extra}
      </span>
    </>
  )
}

/** «до 21 ноября» — красным, если просрочено. */
function Due({ deadline, now }: { deadline?: string | null; now: Date }) {
  const d = dueLabel(deadline, now)
  return <span className={d.late ? 'text-red-600 dark:text-red-400' : undefined}>{d.text}</span>
}

/** Чем закончилась задача: «принято 12 ноября», «готово вчера», «отменена». */
function finishedText(t: CabinetTask, now: Date): string {
  if (normalizeTaskStatus(t.status) === 'cancelled') return 'отменена'
  const reviewed = whenLabel(t.reviewedAt, now)
  if (reviewed) return `принято ${reviewed}`
  const done = whenLabel(t.completedAt, now)
  return done ? `готово ${done}` : 'готово'
}

const rowLine = 'flex items-center gap-3 min-h-[64px] lg:min-h-[60px] py-2 lg:py-0.5 border-b border-surface-200 dark:border-surface-800 last:border-b-0 lg:border-b-0'
const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500'
/** Нажимаемая часть строки. На компьютере — подсветка с полями в 12 px за
 *  край колонки (текст остаётся вровень с заголовком группы); справа поле
 *  только если за строкой нет кнопки статуса. */
const rowHit = (withAction: boolean, active = false) => clsx(
  'flex-1 min-w-0 flex items-center gap-3 text-left min-h-[48px] rounded-xl transition-colors lg:py-2 lg:pl-3 lg:-ml-3',
  withAction ? 'lg:pr-2' : 'lg:pr-3 lg:-mr-3',
  active ? 'lg:bg-surface-50 lg:dark:bg-surface-800' : 'lg:hover:bg-surface-50/70 lg:dark:hover:bg-surface-800/60',
  focusRing,
)

/** Одна кнопка статуса у исполнителя: новая → «Начать», в работе → «Готово». */
function StatusButton({ t, pending, disabled, onChange }: {
  t: CabinetTask; pending: boolean; disabled: boolean; onChange: (v: StatusChange) => void
}) {
  const s = normalizeTaskStatus(t.status)
  if (s !== 'new' && s !== 'in_progress') return null
  const next = s === 'new' ? 'in_progress' : 'done'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange({ id: t.id, status: next, projectId: t.projectId ?? t.project?.id ?? null })}
      className={clsx('shrink-0 min-h-[44px] lg:min-h-[36px] px-4 text-sm', next === 'done' ? 'btn-primary' : 'btn-secondary')}
    >{pending ? '…' : next === 'done' ? 'Готово' : 'Начать'}</button>
  )
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-1 text-[13px] font-semibold text-surface-500 dark:text-surface-400">{title} · {count}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

/** «Готово · N — показать»: свёрнуто по умолчанию, длинный хвост — порциями. */
function DoneGroup({ items, render }: { items: CabinetTask[]; render: (t: CabinetTask) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(DONE_PAGE)
  if (!items.length) return null
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={clsx('self-start min-h-[44px] lg:min-h-[36px] text-sm lg:text-[13px] font-semibold text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 rounded', focusRing)}
      >Готово · {items.length} — {open ? 'скрыть' : 'показать'}</button>
      {open && (
        <div className="flex flex-col">
          {items.slice(0, limit).map(render)}
          {items.length > limit && (
            <button
              type="button"
              onClick={() => setLimit(l => l + DONE_PAGE)}
              className="self-start min-h-[44px] text-sm font-medium text-primary-600 dark:text-primary-300 hover:underline"
            >Показать ещё</button>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Страница ────────────────────────────────────────────────────────

export default function ManagementTasksPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const canCreate = isSmmSpecialist(user)
  // Панель проверки справа — с ширины компьютера (lg), ниже — экран поверх.
  const narrow = useNarrow(992)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Вкладка и открытая задача — в адресе: «Назад» с карточки задачи
  // возвращает туда же, а на телефоне «Назад» закрывает экран проверки.
  const [tabParam] = useUrlState<Tab>('tab', 'auto', TABS)
  const patchUrl = usePatchUrl()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('task')
  // Экран проверки на телефоне открыт отдельным шагом истории — закрываем
  // его шагом «Назад», а не заменой адреса.
  const pushedRef = useRef(false)
  useEffect(() => { if (!selectedId) pushedRef.current = false }, [selectedId])
  // Вкладка «по делу» выбирается один раз за визит: иначе после «Принять»
  // у последней задачи страница сама перескакивала бы на «Мне».
  const autoTabRef = useRef<'mine' | 'assigned' | null>(null)

  // Раз в минуту опрашиваем только без связи с сервером (08.11.2026): при
  // живом сокете оба списка обновляет событие tasks:changed.
  const live = useSocketConnected()
  const pollEvery = live ? false : 60_000
  const mineQ = useQuery({
    queryKey: ['tasks-from-management'],
    queryFn: () => tasksApi.fromManagement(),
    refetchInterval: pollEvery,
  })
  const assignedQ = useQuery({
    queryKey: ['tasks-assigned-by-me'],
    queryFn: () => tasksApi.assignedByMe(),
    refetchInterval: pollEvery,
  })

  const statusMut = useMutation({
    mutationFn: (v: StatusChange) => tasksApi.update(v.id, { status: v.status }),
    onSuccess: (_d, v) => {
      invalidateAfterTaskChange(qc, v.projectId ?? undefined)
      toast.success(v.status === 'done' ? 'Готово — отмечено' : 'Взяли в работу')
    },
    onError: (e: unknown) => toast.error(serverMessage(e, 'Не удалось обновить статус')),
  })

  const openTask = useCallback((id: string) => {
    pushedRef.current = narrow
    setParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('task', id)
      p.set('tab', 'assigned')
      return p
    }, { replace: !narrow })
  }, [narrow, setParams])

  const closeTask = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false
      navigate(-1)
      return
    }
    setParams(prev => {
      const p = new URLSearchParams(prev)
      p.delete('task')
      return p
    }, { replace: true })
  }, [navigate, setParams])

  if (mineQ.isLoading || assignedQ.isLoading) return <PageLoader />

  const now = new Date()
  const mine: CabinetTask[] = Array.isArray(mineQ.data) ? mineQ.data : []
  const assigned: CabinetTask[] = Array.isArray(assignedQ.data) ? assignedQ.data : []
  const mineG = groupMine(mine, now)
  const assignedG = groupAssigned(assigned, now)

  // Вкладку «Я поставил» видит тот, кто ставит задачи: SMM-специалист — всегда,
  // остальные — по факту выданных задач (ставят и руководители, и менеджеры).
  const showAssigned = canCreate || assigned.length > 0
  // Без явного выбора открываем то, где есть дело: проверка — важнее.
  if (!autoTabRef.current) {
    autoTabRef.current =
      assignedG.review.length > 0 || (mineG.todo.length === 0 && assignedG.work.length > 0) ? 'assigned' : 'mine'
  }
  const tab: 'mine' | 'assigned' = !showAssigned ? 'mine' : tabParam === 'auto' ? autoTabRef.current : tabParam
  const selected = tab === 'assigned' && selectedId ? assigned.find(t => t.id === selectedId) ?? null : null

  const switchTab = (v: 'mine' | 'assigned') => patchUrl({ tab: v, task: null })
  const myId = user?.id
  const pendingId = statusMut.isPending ? statusMut.variables?.id : undefined
  const statusButton = (t: CabinetTask) => (
    <StatusButton
      t={t}
      pending={pendingId === t.id}
      disabled={statusMut.isPending}
      onChange={v => statusMut.mutate(v)}
    />
  )

  // ── «Мне» ──
  const mineRow = (t: CabinetTask, meta: ReactNode, withAction: boolean) => {
    const returned = withAction && (t.reworkCount ?? 0) > 0 && !!t.returnReason
    return (
      <div key={t.id} className={rowLine}>
        <Link to={`/tasks/${t.id}`} className={rowHit(withAction)}>
          <RowBody
            person={t.createdBy}
            title={t.title}
            meta={<>{t.createdBy?.name || 'Руководитель'} · {meta}</>}
            extra={returned ? (
              <span className="text-[13px] text-surface-600 dark:text-surface-300 truncate">Поправить: {t.returnReason}</span>
            ) : undefined}
          />
        </Link>
        {withAction && statusButton(t)}
      </div>
    )
  }

  const mineView = mine.length === 0 ? (
    <EmptyState
      title="Задач пока нет"
      description="Здесь появятся задачи, которые вам поставят руководители и SMM-специалисты."
    />
  ) : (
    <div className="flex flex-col gap-6">
      {mineG.todo.length > 0 ? (
        <Group title="Сделать" count={mineG.todo.length}>
          {mineG.todo.map(t => mineRow(t, <Due deadline={t.deadline} now={now} />, true))}
        </Group>
      ) : (
        <p className="text-sm text-surface-500 dark:text-surface-400">Сейчас делать нечего — всё сдано.</p>
      )}
      {mineG.submitted.length > 0 && (
        <Group title="Сдано, ждёт проверки" count={mineG.submitted.length}>
          {mineG.submitted.map(t => mineRow(t, `сдано ${whenLabel(t.completedAt, now)}`.trim(), false))}
        </Group>
      )}
      <DoneGroup items={mineG.done} render={t => mineRow(t, finishedText(t, now), false)} />
    </div>
  )

  // ── «Я поставил» ──
  const assignedRow = (t: CabinetTask, meta: ReactNode) => {
    const people = taskAssignees(t)
    const active = selected?.id === t.id
    // Задача «себе» — закрыть её можно прямо из строки, как в «Мне».
    const s = normalizeTaskStatus(t.status)
    const mineToo = !!myId && people.some(p => p.id === myId) && (s === 'new' || s === 'in_progress')
    return (
      <div key={t.id} className={rowLine}>
        <button
          type="button"
          onClick={() => openTask(t.id)}
          aria-current={active ? 'true' : undefined}
          className={rowHit(mineToo, active)}
        >
          <RowBody person={people[0]} title={t.title} meta={<>{peopleLabel(people)} · {meta}</>} />
          {!mineToo && <ChevronRight size={18} className="shrink-0 text-surface-400" aria-hidden="true" />}
        </button>
        {mineToo && statusButton(t)}
      </div>
    )
  }

  const createButton = canCreate ? (
    <button type="button" onClick={() => setSheetOpen(true)} className="btn-primary min-h-[44px] px-5 text-sm">
      <Plus size={16} /> Задача
    </button>
  ) : undefined

  const assignedList = assigned.length === 0 ? (
    <EmptyState
      title="Вы пока не ставили задач"
      description={canCreate
        ? 'Поставьте задачу дизайнеру, видеографу, монтажёру, продюсеру или себе — она появится здесь.'
        : 'Поставленные вами задачи появятся здесь.'}
      action={createButton}
    />
  ) : (
    <div className="flex flex-col gap-6">
      {assignedG.review.length > 0 && (
        <Group title="Ждут вашей проверки" count={assignedG.review.length}>
          {assignedG.review.map(t => assignedRow(t, `сдано ${whenLabel(t.completedAt, now)}`.trim()))}
        </Group>
      )}
      {assignedG.work.length > 0 && (
        <Group title="В работе" count={assignedG.work.length}>
          {assignedG.work.map(t => assignedRow(t, <Due deadline={t.deadline} now={now} />))}
        </Group>
      )}
      {assignedG.review.length === 0 && assignedG.work.length === 0 && (
        <p className="text-sm text-surface-500 dark:text-surface-400">Открытых задач нет — всё принято.</p>
      )}
      <DoneGroup items={assignedG.done} render={t => assignedRow(t, finishedText(t, now))} />
    </div>
  )

  const mineCount = mineG.todo.length
  const assignedCount = assignedG.review.length + assignedG.work.length

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="page-title flex-1 min-w-0">Задачи</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Новая задача"
            className="btn-primary shrink-0 w-11 h-11 p-0 sm:w-auto sm:h-auto sm:min-h-[40px] sm:px-4"
          >
            <Plus size={20} className="sm:hidden" aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">+ Задача</span>
          </button>
        )}
      </div>

      {showAssigned && (
        <div
          role="tablist"
          aria-label="Чьи задачи"
          className="grid grid-cols-2 sm:inline-grid gap-1 p-1 rounded-xl bg-surface-200/70 dark:bg-surface-800"
        >
          {([['mine', `Мне · ${mineCount}`], ['assigned', `Я поставил · ${assignedCount}`]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => switchTab(v)}
              className={clsx(
                'min-h-[44px] sm:min-h-[36px] px-4 rounded-[9px] text-[15px] sm:text-sm font-semibold whitespace-nowrap transition-colors',
                tab === v
                  ? 'bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-surface-50 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
                focusRing,
              )}
            >{label}</button>
          ))}
        </div>
      )}

      {tab === 'mine' ? mineView : !narrow && assigned.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] gap-6 items-start">
          <div className="min-w-0">{assignedList}</div>
          <aside className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl">
            {selected ? (
              <TaskReviewPanel key={selected.id} task={selected} variant="side" onClose={closeTask} />
            ) : (
              <div className="card rounded-2xl p-6 text-sm text-surface-500 dark:text-surface-400">
                Выберите задачу — здесь появится её результат и кнопки «Принять» и «Вернуть».
              </div>
            )}
          </aside>
        </div>
      ) : assignedList}

      {narrow && selected && (
        <TaskReviewPanel key={selected.id} task={selected} variant="screen" onClose={closeTask} />
      )}

      {canCreate && <QuickTaskSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />}
    </div>
  )
}
