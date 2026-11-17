import { describe, expect, it } from 'vitest'
import {
  assigneeNotes, groupAssigned, groupMine, isAwaitingReview, isSmmSpecialist, peopleLabel, serverMessage, taskAssignees,
} from './taskCabinet'
import type { CabinetTask } from '@/types/taskCabinet'

// 13:00 в Душанбе, 17 ноября 2026.
const NOW = new Date('2026-11-17T08:00:00Z')
const task = (over: Partial<CabinetTask>): CabinetTask => ({ id: 'x', title: 'Задача', status: 'new', ...over })

const LIST: CabinetTask[] = [
  task({ id: 'a', status: 'in_progress', deadline: '2026-11-21T13:00:00Z' }),
  task({ id: 'b', status: 'new', deadline: '2026-11-16T13:00:00Z' }),
  task({ id: 'c', status: 'new', deadline: null }),
  task({ id: 'd', status: 'done', awaitingReview: true, completedAt: '2026-11-17T10:40:00Z' }),
  task({ id: 'e', status: 'done', awaitingReview: true, completedAt: '2026-11-16T09:00:00Z' }),
  task({ id: 'f', status: 'done', awaitingReview: false, completedAt: '2026-11-14T09:00:00Z', reviewedAt: '2026-11-15T09:00:00Z' }),
  task({ id: 'g', status: 'cancelled', updatedAt: '2026-11-16T09:00:00Z' }),
  // Старый статус «на проверке» = в работе.
  task({ id: 'h', status: 'review', deadline: '2026-11-18T13:00:00Z' }),
]
const ids = (l: CabinetTask[]) => l.map(t => t.id)

describe('группы раздела «Задачи»', () => {
  it('«Я поставил»: проверка (кто сдал раньше — выше) → в работе по сроку → готово, свежие сверху', () => {
    const g = groupAssigned(LIST, NOW)
    expect(ids(g.review)).toEqual(['e', 'd'])
    // Просроченная первой, без срока — последней.
    expect(ids(g.work)).toEqual(['b', 'h', 'a', 'c'])
    // g закончилась 16-го (обновлена), f — принята 15-го.
    expect(ids(g.done)).toEqual(['g', 'f'])
  })

  it('«Мне»: сделать → сдано, ждёт проверки (свежие сверху) → готово', () => {
    const g = groupMine(LIST, NOW)
    expect(ids(g.todo)).toEqual(['b', 'h', 'a', 'c'])
    expect(ids(g.submitted)).toEqual(['d', 'e'])
    expect(ids(g.done)).toEqual(['g', 'f'])
  })

  it('пустой список — пустые группы', () => {
    expect(groupAssigned([], NOW)).toEqual({ review: [], work: [], done: [] })
    expect(groupMine([], NOW)).toEqual({ todo: [], submitted: [], done: [] })
  })
})

describe('«Ждёт проверки»', () => {
  const base = { status: 'done', createdById: 'u1', assigneeId: 'u2' }

  it('поле сервера главнее', () => {
    expect(isAwaitingReview(task({ ...base, completedAt: '2026-11-16T10:00:00Z', awaitingReview: false }), NOW)).toBe(false)
    expect(isAwaitingReview(task({ status: 'done', awaitingReview: true }), NOW)).toBe(true)
  })

  it('без поля — то же правило, что на сервере: done, не принята, 14 дней, автор ≠ исполнитель', () => {
    expect(isAwaitingReview(task({ ...base, completedAt: '2026-11-10T10:00:00Z' }), NOW)).toBe(true)
    // Почти 16 дней назад — окно в 14 дней прошло.
    expect(isAwaitingReview(task({ ...base, completedAt: '2026-11-01T10:00:00Z' }), NOW)).toBe(false)
    expect(isAwaitingReview(task({ ...base, completedAt: '2026-11-16T10:00:00Z', reviewedAt: '2026-11-16T12:00:00Z' }), NOW)).toBe(false)
    expect(isAwaitingReview(task({ ...base, assigneeId: 'u1', completedAt: '2026-11-16T10:00:00Z' }), NOW)).toBe(false)
    expect(isAwaitingReview(task({ ...base, status: 'in_progress', completedAt: '2026-11-16T10:00:00Z' }), NOW)).toBe(false)
  })
})

describe('исполнители и подписи', () => {
  it('taskAssignees — task_assignees с user, плоская форма, старое поле assignee; без повторов', () => {
    expect(taskAssignees(task({
      assignees: [
        { userId: 'u1', user: { id: 'u1', name: 'Нигина', avatar: null } },
        { userId: 'u2', user: { id: 'u2', name: 'Фарход' } },
        { userId: 'u1', user: { id: 'u1', name: 'Нигина' } },
      ],
    }))).toEqual([
      { id: 'u1', name: 'Нигина', avatar: null },
      { id: 'u2', name: 'Фарход', avatar: null },
    ])
    expect(taskAssignees(task({ assignees: [{ id: 'u3', name: 'Шахзод', avatar: 'a.png' }] })))
      .toEqual([{ id: 'u3', name: 'Шахзод', avatar: 'a.png' }])
    expect(taskAssignees(task({ assignees: [], assignee: { id: 'u4', name: 'Мадина' } })))
      .toEqual([{ id: 'u4', name: 'Мадина', avatar: null }])
  })

  it('peopleLabel', () => {
    expect(peopleLabel([])).toBe('Без исполнителя')
    expect(peopleLabel([{ id: '1', name: 'Нигина' }])).toBe('Нигина')
    expect(peopleLabel([{ id: '1', name: 'Нигина' }, { id: '2', name: 'Фарход' }, { id: '3', name: 'Шахзод' }])).toBe('Нигина +2')
  })

  it('assigneeNotes — только непустые заметки', () => {
    expect(assigneeNotes(task({
      assignees: [
        { userId: 'u1', user: { id: 'u1', name: 'Нигина' }, note: '  Сделала в двух вариантах  ' },
        { userId: 'u2', user: { id: 'u2', name: 'Фарход' }, note: '' },
      ],
    }))).toEqual([{ name: 'Нигина', note: 'Сделала в двух вариантах' }])
  })

  it('serverMessage — строка, список проверок, иначе запасной текст', () => {
    expect(serverMessage({ response: { data: { message: 'Нет доступа' } } }, 'x')).toBe('Нет доступа')
    expect(serverMessage({ response: { data: { message: ['title should not be empty', 'deadline must be a date'] } } }, 'x'))
      .toBe('title should not be empty; deadline must be a date')
    expect(serverMessage({ response: { data: { message: '' } } }, 'запасной')).toBe('запасной')
    expect(serverMessage(new Error('boom'), 'запасной')).toBe('запасной')
    expect(serverMessage(undefined, 'запасной')).toBe('запасной')
  })

  it('isSmmSpecialist — основной или второй ролью', () => {
    expect(isSmmSpecialist({ role: 'smm_specialist' })).toBe(true)
    expect(isSmmSpecialist({ role: 'designer', secondaryRole: 'smm_specialist' })).toBe(true)
    expect(isSmmSpecialist({ role: 'smm_director' })).toBe(false)
    expect(isSmmSpecialist(null)).toBe(false)
  })
})
