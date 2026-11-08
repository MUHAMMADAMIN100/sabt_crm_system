import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import {
  BATCH_MS, OWN_WAIT_MS, PROJECTS_LIST_MIN_GAP_MS,
  createTaskChangeSync, planTaskChangeBatch,
  type ReceivedTaskChange,
} from './taskChangeSync'

const ME = 'me'
const ev = (at: number, payload: ReceivedTaskChange['payload']): ReceivedTaskChange => ({ at, payload })

describe('planTaskChangeBatch', () => {
  it('чужая правка: карточка только своего проекта, список проектов — по виду правки', () => {
    const r = planTaskChangeBatch([
      ev(0, { projectId: 'p1', actorId: 'other', kind: 'status' }),
      ev(10, { projectId: 'p2', actorId: 'other', kind: 'edit' }),
    ], [], ME, 400)
    expect(r.scope).toEqual({ tasks: true, projects: ['p1', 'p2'], projectsList: true, ownTasks: false, content: false })
  })

  it('правка полей не трогает список проектов', () => {
    const r = planTaskChangeBatch([ev(0, { projectId: 'p1', actorId: 'other', kind: 'edit' })], [], ME, 400)
    expect(r.scope?.projectsList).toBe(false)
  })

  it('старое событие без полей обновляет всё, как раньше', () => {
    const r = planTaskChangeBatch([ev(0, {})], [], ME, 400)
    expect(r.scope).toEqual({ tasks: true, projects: 'all', projectsList: true, ownTasks: true, content: false })
  })

  it('задача без проекта (null) карточки проектов не трогает', () => {
    const r = planTaskChangeBatch([ev(0, { projectId: null, actorId: 'other', kind: 'create' })], [], ME, 400)
    expect(r.scope?.projects).toEqual([])
  })

  it('личная задача обновляет свои заметки', () => {
    const r = planTaskChangeBatch([ev(0, { projectId: null, actorId: 'bot', kind: 'create', personal: true })], [], ME, 400)
    expect(r.scope?.ownTasks).toBe(true)
  })

  it('карточка контента без задачи: только экраны контента, без задач и проектов', () => {
    const r = planTaskChangeBatch([ev(0, { projectId: 'p1', actorId: 'other', kind: 'content', content: true })], [], ME, 400)
    expect(r.scope).toEqual({ tasks: false, projects: [], projectsList: false, ownTasks: false, content: true })
  })

  it('контент-план со своей задачей: и задачи, и контент', () => {
    const r = planTaskChangeBatch([ev(0, { projectId: 'p1', actorId: 'other', kind: 'create', content: true })], [], ME, 400)
    expect(r.scope).toMatchObject({ tasks: true, projects: ['p1'], projectsList: true, content: true })
  })

  it('свою правку контента не пропускаем и не ждём: отметка покрывает только задачи', () => {
    const r = planTaskChangeBatch([ev(1000, { projectId: 'p1', actorId: ME, kind: 'content', content: true })], [{ at: 1100 }], ME, 1400)
    expect(r.scope?.content).toBe(true)
    expect(r.usedMarks).toEqual([])
  })

  it('(а) вкладка обновила всё ПОСЛЕ прихода события — пропускаем, чьё бы оно ни было', () => {
    const r = planTaskChangeBatch([ev(0, { projectId: 'p1', actorId: 'other', kind: 'status' })], [{ at: 200 }], ME, 400)
    expect(r.scope).toBeNull()
  })

  it('(б) эхо своей правки, ответ пришёл раньше сокета — пропускаем', () => {
    const r = planTaskChangeBatch([ev(1000, { projectId: 'p1', actorId: ME, kind: 'status' })], [{ at: 900 }], ME, 1400)
    expect(r.scope).toBeNull()
    expect(r.usedMarks).toHaveLength(1)
  })

  it('одно местное обновление гасит только одно эхо (вторая вкладка того же человека)', () => {
    const r = planTaskChangeBatch([
      ev(1000, { projectId: 'p1', actorId: ME, kind: 'status' }),
      ev(1100, { projectId: 'p1', actorId: ME, kind: 'status' }),
    ], [{ at: 900 }], ME, 1000 + OWN_WAIT_MS + 500)
    expect(r.scope).not.toBeNull()
  })

  it('эхо, покрытое по (а), занимает отметку — следующее своё событие не проглатывается', () => {
    const sync = planTaskChangeBatch(
      [ev(950, { projectId: 'p1', actorId: ME, kind: 'status' })],   // эхо пришло раньше ответа
      [{ at: 1000 }], ME, 1350,
    )
    expect(sync.scope).toBeNull()
    expect(sync.usedMarks).toEqual([{ at: 1000 }])
    // Через секунду — задача из Telegram от того же человека: отметка уже занята.
    const voice = planTaskChangeBatch([ev(2000, { projectId: null, actorId: ME, kind: 'create', personal: true })],
      [], ME, 2000 + OWN_WAIT_MS)
    expect(voice.scope?.ownTasks).toBe(true)
  })

  it('своё событие о другом проекте эхом не считаем', () => {
    const r = planTaskChangeBatch(
      [ev(1000, { projectId: 'p2', actorId: ME, kind: 'edit' })],
      [{ at: 900, projectId: 'p1' }], ME, 1000 + OWN_WAIT_MS,
    )
    expect(r.scope?.projects).toEqual(['p2'])
  })

  it('своё событие без местного обновления: сначала ждём ответ, потом обрабатываем', () => {
    const e = ev(1000, { projectId: 'p1', actorId: ME, kind: 'status' })
    const early = planTaskChangeBatch([e], [], ME, 1400)
    expect(early.scope).toBeNull()
    expect(early.wait).toEqual([e])
    const late = planTaskChangeBatch([e], [], ME, 1000 + OWN_WAIT_MS)
    expect(late.scope).not.toBeNull()
    expect(late.wait).toEqual([])
  })
})

describe('createTaskChangeSync', () => {
  let qc: { invalidateQueries: ReturnType<typeof vi.fn> }
  const calls = (key: string) =>
    qc.invalidateQueries.mock.calls.filter(([f]: any[]) => f?.queryKey?.[0] === key).length

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'))
    qc = { invalidateQueries: vi.fn() }
  })
  afterEach(() => { vi.useRealTimers() })

  it('пачка событий за 400 мс — одно обновление', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: 'a', kind: 'status' })
    vi.advanceTimersByTime(100)
    sync.receive({ projectId: 'p1', actorId: 'b', kind: 'status' })
    vi.advanceTimersByTime(100)
    sync.receive({ projectId: 'p2', actorId: 'c', kind: 'edit' })
    expect(calls('tasks')).toBe(0)
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls('tasks')).toBe(1)
    expect(calls('projects')).toBe(1)
    expect(calls('project')).toBe(2)       // ['project','p1'] и ['project','p2']
  })

  it('список проектов — не чаще раза в 10 с, последнее изменение не теряется', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: 'a', kind: 'status' })
    vi.advanceTimersByTime(BATCH_MS)
    sync.receive({ projectId: 'p1', actorId: 'a', kind: 'status' })
    vi.advanceTimersByTime(BATCH_MS)
    sync.receive({ projectId: 'p1', actorId: 'a', kind: 'create' })
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls('tasks')).toBe(3)
    expect(calls('projects')).toBe(1)
    vi.advanceTimersByTime(PROJECTS_LIST_MIN_GAP_MS)
    expect(calls('projects')).toBe(2)       // хвостовое — после окна
  })

  it('эхо своей правки после местного обновления не перезапрашивает ничего', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.markLocal('p1')
    vi.advanceTimersByTime(150)
    sync.receive({ projectId: 'p1', actorId: ME, kind: 'status' })
    vi.advanceTimersByTime(BATCH_MS + OWN_WAIT_MS)
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
  })

  it('сокет быстрее ответа: ждём ответ, и он гасит эхо', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: ME, kind: 'status' })
    vi.advanceTimersByTime(700)
    sync.markLocal('p1')                    // onSuccess мутации
    vi.advanceTimersByTime(OWN_WAIT_MS)
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
  })

  it('эхо, потом задача из Telegram от того же человека — задача обновляется', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: ME, kind: 'status' })   // эхо своей правки
    vi.advanceTimersByTime(50)
    sync.markLocal()                                                  // ответ сервера
    vi.advanceTimersByTime(BATCH_MS)
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    sync.receive({ projectId: null, actorId: ME, kind: 'create', personal: true })
    vi.advanceTimersByTime(BATCH_MS + OWN_WAIT_MS)
    expect(calls('tasks')).toBe(1)
    expect(calls('own-tasks')).toBe(1)
  })

  it('пачка переносов в умном календаре — одно обновление календаря, задачи не трогаем', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    for (let i = 0; i < 5; i++) sync.receive({ projectId: 'p1', actorId: 'other', kind: 'content', content: true })
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls('smm-calendar')).toBe(1)
    expect(calls('calendar')).toBe(1)
    expect(calls('tasks')).toBe(0)
    expect(calls('project')).toBe(0)
    expect(calls('projects')).toBe(0)
  })

  it('задачи и контент в одной пачке — общий ключ обновляется один раз', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: 'other', kind: 'status' })
    sync.receive({ projectId: 'p1', actorId: 'other', kind: 'content', content: true })
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls('calendar')).toBe(1)
    expect(calls('kpi-all')).toBe(1)
    expect(calls('tasks')).toBe(1)
    expect(calls('smm-calendar')).toBe(1)
  })

  it('своя правка с другого устройства — обновляем, хоть и чуть позже', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: ME, kind: 'status' })
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls('tasks')).toBe(0)
    vi.advanceTimersByTime(OWN_WAIT_MS)
    expect(calls('tasks')).toBe(1)
  })

  it('чужая правка не ждёт вместе с моей', () => {
    const sync = createTaskChangeSync(qc as unknown as QueryClient, () => ME)
    sync.receive({ projectId: 'p1', actorId: ME, kind: 'status' })
    vi.advanceTimersByTime(BATCH_MS)        // моё ждёт ответа
    sync.receive({ projectId: 'p2', actorId: 'other', kind: 'edit' })
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls('tasks')).toBe(1)
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project', 'p2'] })
  })
})
