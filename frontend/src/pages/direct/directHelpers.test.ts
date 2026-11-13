import { describe, expect, it } from 'vitest'
import { addressOf, fillTemplate } from './TemplatesManager'
import { compareChats } from './directCache'
import { reminderPresets, remindLabel } from './chatActions'
import type { DirectConversation } from '@/services/direct.api'

describe('шаблоны быстрых ответов', () => {
  it('обращение: имя и фамилия → имя, название бизнеса → целиком', () => {
    expect(addressOf('Фарход Каримов')).toBe('Фарход')
    expect(addressOf('Odil Yusupov')).toBe('Odil')
    expect(addressOf('Ювелирный магазин Золотые')).toBe('Ювелирный магазин Золотые')
    expect(addressOf('Торты и десерты')).toBe('Торты и десерты')
    expect(addressOf('Мадина')).toBe('Мадина')
    expect(addressOf(null)).toBe('')
  })
  it('подстановки {имя} и {менеджер}', () => {
    expect(fillTemplate('Здравствуйте, {имя}! Меня зовут {менеджер}.', { client: 'Фарход Каримов', manager: 'Мадина Сафарова' }))
      .toBe('Здравствуйте, Фарход! Меня зовут Мадина.')
  })
  it('имени клиента нет — без висящей запятой', () => {
    expect(fillTemplate('Здравствуйте, {имя}!', { client: null })).toBe('Здравствуйте!')
    expect(fillTemplate('{имя}, добрый день!', { client: '' })).toBe('добрый день!')
  })
})

const chat = (id: string, minutesAgo: number, pinned = false) =>
  ({ id, pinned, lastMessageAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() }) as unknown as DirectConversation

describe('порядок списка', () => {
  it('закреплённые, потом сработавшие напоминания, потом свежие', () => {
    const list = [chat('old', 60), chat('new', 1), chat('pin', 500, true), chat('due', 300)]
    const reminders = [{ id: 'r', conversationId: 'due', remindAt: new Date(Date.now() - 1000).toISOString(), note: null, fired: true }]
    expect(list.sort(compareChats(reminders)).map(c => c.id)).toEqual(['pin', 'due', 'new', 'old'])
  })
  it('напоминание в будущем порядок не меняет', () => {
    const list = [chat('a', 10), chat('b', 1)]
    const reminders = [{ id: 'r', conversationId: 'a', remindAt: new Date(Date.now() + 3600_000).toISOString(), note: null, fired: false }]
    expect(list.sort(compareChats(reminders)).map(c => c.id)).toEqual(['b', 'a'])
  })
})

describe('напоминания', () => {
  it('варианты: вечером — без «сегодня в 18:00», в понедельник — без «в понедельник»', () => {
    const monday = new Date(2026, 10, 16, 19, 0)
    const labels = reminderPresets(monday).map(p => p.label)
    expect(labels).toContain('Через час')
    expect(labels).not.toContain('Сегодня в 18:00')
    expect(labels).toContain('Завтра в 10:00')
    expect(labels).toContain('В понедельник в 10:00')
    const sunday = new Date(2026, 10, 15, 9, 0)
    expect(reminderPresets(sunday).map(p => p.label)).not.toContain('В понедельник в 10:00')
  })
  it('подпись времени: сегодня, завтра, дата', () => {
    const now = new Date(2026, 10, 13, 12, 0)
    expect(remindLabel(new Date(2026, 10, 13, 18, 0).toISOString(), now)).toBe('сегодня в 18:00')
    expect(remindLabel(new Date(2026, 10, 14, 10, 0).toISOString(), now)).toBe('завтра в 10:00')
    expect(remindLabel(new Date(2026, 10, 20, 9, 30).toISOString(), now)).toMatch(/^20 ноя/)
  })
})
