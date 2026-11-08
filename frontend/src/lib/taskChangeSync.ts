import type { QueryClient } from '@tanstack/react-query'

/**
 * Обновление данных после «задачи изменились» (08.11.2026, третья волна).
 *
 * Событие tasks:changed приходит всем при любой правке задачи — перетаскивание
 * на доске, бот, контент-план. Раньше каждое событие у каждого сотрудника
 * перезапрашивало ~35 запросов, включая полный список проектов, а автор правки
 * получал всё дважды: своё обновление + эхо события. Теперь:
 *   · события за BATCH_MS собираются в одно обновление;
 *   · эхо своей правки из этой вкладки пропускается — она уже всё обновила;
 *   · карточка проекта — только того, чей проект, если он известен;
 *   · тяжёлый список проектов (счётчики задач, прогресс) — только когда они
 *     могли измениться и не чаще раза в PROJECTS_LIST_MIN_GAP_MS.
 */

/** content — тронуты только карточки контент-плана, сами задачи нет. */
export type TaskChangeKind = 'create' | 'delete' | 'status' | 'move' | 'edit' | 'bulk' | 'content'

/** Тело события с сервера (backend/src/modules/gateway/tasks-changed.ts).
 *  Все поля необязательны: без них обновляем всё, как раньше. */
export interface TaskChangePayload {
  /** string — проект задачи; null — задача без проекта; нет поля — неизвестно. */
  projectId?: string | null
  taskId?: string | null
  actorId?: string | null
  kind?: TaskChangeKind
  /** Событие про личные задачи — пришло только их владельцу. */
  personal?: boolean
  /** Из контент-плана: обновить умный календарь и экраны контента. */
  content?: boolean
}

export interface ReceivedTaskChange { at: number; payload: TaskChangePayload }

/** Вкладка сама обновила данные задач (invalidateAfterTaskChange). */
export interface LocalTaskInvalidation { at: number; projectId?: string }

export interface TaskInvalidationScope {
  /** Задачи и всё, что из них считается (TASK_QUERY_KEYS). */
  tasks: boolean
  /** Карточки ['project', id]: все или только перечисленные. */
  projects: 'all' | string[]
  /** Тяжёлый список ['projects']. */
  projectsList: boolean
  /** Свои заметки панели ['own-tasks']. */
  ownTasks: boolean
  /** Умный календарь и экраны контент-плана (CONTENT_QUERY_KEYS). */
  content: boolean
}

export const BATCH_MS = 400
/** Ответ на свою правку пришёл раньше события — эхо узнаём в этом окне. */
export const OWN_ECHO_WINDOW_MS = 3000
/** Событие о своей правке пришло раньше ответа — столько ждём ответ.
 *  Сервер шлёт событие прямо перед ответом, обычно ответ отстаёт на
 *  100–300 мс; больше не ждём, чтобы своя правка с телефона не запаздывала. */
export const OWN_WAIT_MS = 1000
export const PROJECTS_LIST_MIN_GAP_MS = 10_000

/** Всё, что зависит от задач, кроме проектов: их обновляем по scope. */
export const TASK_QUERY_KEYS: readonly string[] = [
  'tasks', 'my-tasks', 'task', 'overview', 'task-status', 'task-priority',
  'tasks-review', 'tasks-overdue', 'task-results', 'task-checklist', 'task-files',
  'employee-tasks', 'analytics-dashboard', 'analytics-workload', 'employee-workload',
  'employee-efficiency', 'emp-eff', 'emp-activity', 'proj-perf', 'calendar',
  'unread-count', 'reports',
  // KPI и риски считаются из задач.
  'kpi-all', 'kpi-user', 'kpi-details', 'risks-projects', 'risks-employees',
  'workload-employees-all', 'workload-pm-all', 'workload-employees',
  // React Query сравнивает ключи поэлементно — префикс их не покрывает.
  'workload-pm', 'workload-team-all',
  // Кабинет поручений: выданная задача должна появиться у исполнителя сразу.
  'tasks-from-management', 'tasks-assigned-by-me',
]

/** Всё, что считается из карточек контент-плана (рилсы, посты, съёмки).
 *  Раньше tasks:changed их не трогал вовсе — умный календарь у остальных
 *  обновлялся только по своим действиям (08.11.2026). */
export const CONTENT_QUERY_KEYS: readonly string[] = [
  'smm-calendar', 'smm-calendar-overdue', 'content-plan', 'plan-fact',
  'my-work', 'my-work-overdue', 'producer-shoots', 'smm-control',
  // Съёмки в общем календаре, SMM-часть KPI, аналитики и рисков.
  'calendar', 'kpi-all', 'kpi-user', 'kpi-details', 'analytics-dashboard',
  'risks-projects', 'risks-employees',
]

/** Местное обновление после правки задачи (invalidateAfterTaskChange) —
 *  им и помечаем свои правки. Контент оно не трогает. */
export const FULL_SCOPE: TaskInvalidationScope = { tasks: true, projects: 'all', projectsList: true, ownTasks: true, content: false }

const sameProject = (m: LocalTaskInvalidation, e: ReceivedTaskChange) =>
  typeof m.projectId !== 'string' || typeof e.payload.projectId !== 'string' || m.projectId === e.payload.projectId

/**
 * Что делать с накопленными событиями. Чистая функция — её и тестируем.
 *
 * Событие пропускаем, если вкладка уже обновила всё сама:
 *   (а) местное обновление было ПОСЛЕ прихода события — оно взяло с сервера
 *       данные новее события, чьё бы оно ни было;
 *   (б) событие о правке этого же пользователя, а местное обновление было
 *       незадолго ДО него (ответ сервера пришёл раньше сокета). Каждое местное
 *       обновление «гасит» не больше одного своего события (по (а) тоже):
 *       если тот же человек правит и со второй вкладки, телефона или из
 *       Telegram, лишнее событие обработается как обычно.
 * Событие о своей правке, которое пришло раньше ответа сервера, немного ждём
 * (wait) — вдруг ответ вот-вот придёт и обновит всё сам.
 * События контент-плана (content) не пропускаем и не ждём: местная отметка
 * покрывает только задачи, а экраны контента правки отмечать не умеют.
 */
export function planTaskChangeBatch(
  events: ReceivedTaskChange[],
  marks: LocalTaskInvalidation[],
  myId: string | null | undefined,
  now: number,
): { scope: TaskInvalidationScope | null; wait: ReceivedTaskChange[]; usedMarks: LocalTaskInvalidation[] } {
  const used = new Set<LocalTaskInvalidation>()
  const wait: ReceivedTaskChange[] = []
  const todo: ReceivedTaskChange[] = []
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.payload.content) { todo.push(e); continue }
    const mine = !!myId && e.payload.actorId === myId
    if (!mine) {
      if (marks.some(m => m.at >= e.at)) continue                                 // (а)
      todo.push(e)
      continue
    }
    // Своё событие «гасит» местное обновление, даже если покрыто по (а):
    // иначе отметка осталась бы свободной и по (б) проглотила бы следующее
    // своё событие — например, задачу, надиктованную в Telegram.
    const after = marks.find(m => !used.has(m) && m.at >= e.at)
    if (after) { used.add(after); continue }                                      // (а)
    if (marks.some(m => m.at >= e.at)) continue                                   // (а), отметка уже занята
    const before = marks.find(m => !used.has(m) && e.at - m.at <= OWN_ECHO_WINDOW_MS && sameProject(m, e))
    if (before) { used.add(before); continue }                                    // (б)
    if (now - e.at < OWN_WAIT_MS) { wait.push(e); continue }
    todo.push(e)
  }
  if (!todo.length) return { scope: null, wait, usedMarks: [...used] }

  const ids = new Set<string>()
  let tasks = false
  let allProjects = false
  let projectsList = false
  let ownTasks = false
  let content = false
  for (const { payload: p } of todo) {
    if (p.content) content = true
    // Тронуты только карточки контента — задачи и проекты не перезапрашиваем.
    if (p.kind === 'content') continue
    tasks = true
    if (p.projectId === undefined) allProjects = true                           // проект неизвестен
    else if (typeof p.projectId === 'string' && p.projectId) ids.add(p.projectId)
    // Счётчики задач и прогресс в списке проектов не меняет только правка полей.
    if (p.kind !== 'edit') projectsList = true
    if (p.personal || !p.kind || p.kind === 'move' || p.kind === 'bulk') ownTasks = true
  }
  return {
    scope: { tasks, projects: allProjects ? 'all' : [...ids], projectsList, ownTasks, content },
    wait,
    usedMarks: [...used],
  }
}

export interface TaskChangeSync {
  /** Пришло событие tasks:changed. */
  receive(payload: TaskChangePayload | null | undefined): void
  /** Вкладка сама обновила данные задач после своей правки. */
  markLocal(projectId?: string): void
  /** Обновить ['projects'] — сразу или в конце окна PROJECTS_LIST_MIN_GAP_MS. */
  requestProjectsList(): void
  /** Выход/размонтирование: сбросить таймеры и очередь. */
  reset(): void
}

/** Ключи по scope. requestProjectsList — троттлинг списка проектов. */
export function invalidateTaskQueries(
  qc: QueryClient,
  scope: TaskInvalidationScope,
  requestProjectsList: () => void,
): void {
  // Без повторов: второй invalidate того же ключа отменил бы уже начатый
  // перезапрос и отправил его заново.
  const keys = new Set<string>()
  if (scope.tasks) TASK_QUERY_KEYS.forEach(k => keys.add(k))
  if (scope.content) CONTENT_QUERY_KEYS.forEach(k => keys.add(k))
  for (const key of keys) qc.invalidateQueries({ queryKey: [key] })
  if (scope.tasks) {
    if (scope.projects === 'all') qc.invalidateQueries({ queryKey: ['project'] })
    else for (const id of scope.projects) qc.invalidateQueries({ queryKey: ['project', id] })
  }
  if (scope.ownTasks) qc.invalidateQueries({ queryKey: ['own-tasks'] })
  if (scope.projectsList) requestProjectsList()
}

export function createTaskChangeSync(qc: QueryClient, getMyId: () => string | null | undefined): TaskChangeSync {
  let pending: ReceivedTaskChange[] = []
  let marks: LocalTaskInvalidation[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushAt = 0
  let listTimer: ReturnType<typeof setTimeout> | null = null
  let lastListAt = Number.NEGATIVE_INFINITY

  const fireProjectsList = () => {
    lastListAt = Date.now()
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const requestProjectsList = () => {
    if (listTimer) return                       // уже назначено — придёт свежее
    const wait = lastListAt + PROJECTS_LIST_MIN_GAP_MS - Date.now()
    if (wait <= 0) { fireProjectsList(); return }
    listTimer = setTimeout(() => { listTimer = null; fireProjectsList() }, wait)
  }

  // Обновление не позже чем через ms. Уже назначенное раньше — оставляем;
  // назначенное позже (ждём ответ на свою правку) — переносим ближе, чтобы
  // чужие правки не ждали вместе с ним.
  const schedule = (ms: number) => {
    const delay = Math.max(0, ms)
    const at = Date.now() + delay
    if (flushTimer && flushAt <= at) return
    if (flushTimer) clearTimeout(flushTimer)
    flushAt = at
    flushTimer = setTimeout(flush, delay)
  }

  function flush() {
    flushTimer = null
    const now = Date.now()
    const { scope, wait, usedMarks } = planTaskChangeBatch(pending, marks, getMyId(), now)
    marks = marks.filter(m => !usedMarks.includes(m) && now - m.at <= OWN_ECHO_WINDOW_MS + OWN_WAIT_MS)
    pending = wait
    if (scope) invalidateTaskQueries(qc, scope, requestProjectsList)
    if (pending.length) schedule(Math.min(...pending.map(e => e.at + OWN_WAIT_MS)) - now)
  }

  return {
    receive(payload) {
      pending.push({ at: Date.now(), payload: payload && typeof payload === 'object' ? payload : {} })
      schedule(BATCH_MS)
    },
    markLocal(projectId) {
      const now = Date.now()
      marks = [...marks.filter(m => now - m.at <= OWN_ECHO_WINDOW_MS + OWN_WAIT_MS), { at: now, projectId }]
    },
    requestProjectsList,
    reset() {
      if (flushTimer) clearTimeout(flushTimer)
      if (listTimer) clearTimeout(listTimer)
      flushTimer = null
      listTimer = null
      pending = []
      marks = []
      lastListAt = Number.NEGATIVE_INFINITY
    },
  }
}

/** Один экземпляр на QueryClient: его делят useSocket и invalidateAfterTaskChange. */
const instances = new WeakMap<QueryClient, TaskChangeSync>()
let myIdGetter: () => string | null | undefined = () => null

/** useSocket сообщает, как узнать текущего пользователя (без импорта стора сюда). */
export function setTaskChangeUserGetter(fn: () => string | null | undefined): void {
  myIdGetter = fn
}

export function getTaskChangeSync(qc: QueryClient): TaskChangeSync {
  let sync = instances.get(qc)
  if (!sync) {
    sync = createTaskChangeSync(qc, () => myIdGetter())
    instances.set(qc, sync)
  }
  return sync
}
