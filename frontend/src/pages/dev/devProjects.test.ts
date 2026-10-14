import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DevTask } from '@/pages/dev-board/devBoardTypes'
import {
  deadlineInfo, longDay, nearestDeadlines, openByAssignee, overdueWord, projectTaskCounts,
  shortDay, stageOf, taskStats, tasksWord, timeProgress,
} from './devProjects'

// Страницы раздела «Разработка» (свои с 14.10.2026, отдельно от СММ):
// этап, срок сдачи и задачи доски считаются одинаково на списке и в проекте.

const TODAY = new Date(2026, 9, 14) // 14 октября 2026

let seq = 0
const task = (over: Partial<DevTask> = {}): DevTask => ({
  id: `t${++seq}`, title: `Задача ${seq}`, description: null, status: 'todo', priority: 'medium',
  taskType: 'feature', assigneeId: null, assignee: null, createdById: 'u0', createdBy: null,
  projectId: 'p1', project: null, position: 0, storyPoints: null, tags: null, deadline: null,
  completedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  parentTaskId: null, subtasksCount: 0, subtasksDone: 0, ...over,
})

describe('этап проекта', () => {
  it('номер 1..6 — этап с процентом, без номера — не задан', () => {
    expect(stageOf(3)).toMatchObject({ num: 3, pct: 50, label: 'Активная фаза производства' })
    expect(stageOf(null)).toBeNull()
    expect(stageOf(0)).toBeNull()
    expect(stageOf(7)).toBeNull()
  })
})

describe('сроки проекта', () => {
  it('срок сдачи: через N дней, сегодня, просрочено', () => {
    expect(deadlineInfo('2026-10-16', TODAY)).toEqual({ days: 2, overdue: false, text: 'через 2 дня' })
    expect(deadlineInfo('2026-10-30', TODAY)?.text).toBe('через 16 дней')
    expect(deadlineInfo('2026-10-15', TODAY)?.text).toBe('через 1 день')
    expect(deadlineInfo('2026-10-14', TODAY)).toEqual({ days: 0, overdue: false, text: 'сегодня' })
    expect(deadlineInfo('2026-10-10', TODAY)).toEqual({ days: -4, overdue: true, text: 'просрочено на 4 дня' })
    expect(deadlineInfo(null, TODAY)).toBeNull()
  })

  it('полоска времени: прошло дней из всего срока', () => {
    expect(timeProgress('2026-09-01', '2026-10-30', TODAY)).toEqual({ passed: 43, total: 59, pct: 73 })
    // после сдачи полоска полная, до старта — пустая
    expect(timeProgress('2026-09-01', '2026-10-10', TODAY)?.pct).toBe(100)
    expect(timeProgress('2026-11-01', '2026-12-01', TODAY)?.pct).toBe(0)
    expect(timeProgress(null, '2026-10-30', TODAY)).toBeNull()
    expect(timeProgress('2026-10-30', '2026-10-01', TODAY)).toBeNull()
  })

  it('даты по-русски, год — только если не текущий', () => {
    expect(shortDay('2026-10-16', TODAY)).toBe('16 окт')
    expect(shortDay('2027-01-05T10:00:00.000Z', TODAY)).toBe('5 янв 2027')
    expect(longDay('2026-09-01', TODAY)).toBe('1 сентября')
    expect(longDay(null, TODAY)).toBe('—')
  })
})

describe('задачи доски на страницах проектов', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 14, 12)) })
  afterEach(() => { vi.useRealTimers() })

  const tasks = [
    task({ status: 'backlog' }),
    task({ status: 'in_progress', assigneeId: 'u1', deadline: '2026-10-13T00:00:00.000Z' }),
    task({ status: 'testing', assigneeId: 'u2', deadline: '2026-10-15T00:00:00.000Z' }),
    task({ status: 'todo', assigneeId: 'u1', deadline: '2026-10-17T00:00:00.000Z' }),
    task({ status: 'done', assigneeId: 'u1', deadline: '2026-10-01T00:00:00.000Z' }),
    // подзадача не считается — она внутри карточки, как на доске
    task({ status: 'todo', parentTaskId: 't2', deadline: '2026-10-12T00:00:00.000Z' }),
    task({ status: 'todo', projectId: 'p2', deadline: '2026-10-11T00:00:00.000Z' }),
  ]

  it('по колонкам, выполнено и просрочено', () => {
    const s = taskStats(tasks.filter(t => t.projectId === 'p1'))
    expect(s.by).toEqual({ backlog: 1, todo: 1, in_progress: 1, testing: 1, done: 1 })
    expect(s).toMatchObject({ total: 5, done: 1, open: 4, overdue: 1 })
  })

  it('ближайшие дедлайны — открытые, по сроку, просроченные первыми', () => {
    const near = nearestDeadlines(tasks.filter(t => t.projectId === 'p1'))
    expect(near.map(t => t.deadline?.slice(0, 10))).toEqual(['2026-10-13', '2026-10-15', '2026-10-17'])
  })

  it('открытые задачи по исполнителю и по проекту', () => {
    expect(Object.fromEntries(openByAssignee(tasks))).toEqual({ u1: 2, u2: 1 })
    expect(Object.fromEntries(projectTaskCounts(tasks))).toEqual({
      p1: { open: 4, overdue: 1 },
      p2: { open: 1, overdue: 1 },
    })
  })

  it('подписи с числом', () => {
    expect([tasksWord(1), tasksWord(2), tasksWord(5), tasksWord(12)]).toEqual(['1 задача', '2 задачи', '5 задач', '12 задач'])
    expect([overdueWord(1), overdueWord(3), overdueWord(5)]).toEqual(['1 просрочена', '3 просрочены', '5 просрочено'])
  })
})
