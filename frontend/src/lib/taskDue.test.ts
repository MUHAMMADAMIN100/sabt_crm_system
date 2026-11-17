import { describe, expect, it } from 'vitest'
import {
  addDays, dayMonth, daysBetween, deadlineIso, dueCaption, dueLabel, dushanbeParts, dushanbeToday,
  pluralRu, resolveDue, whenLabel,
} from './taskDue'

// 08:00 UTC = 13:00 в Душанбе, вторник 17 ноября 2026.
const NOW = new Date('2026-11-17T08:00:00Z')

describe('Душанбе: день и время', () => {
  it('сдвиг +5 часов, без часового пояса устройства', () => {
    expect(dushanbeParts(new Date('2026-11-17T20:30:00Z'))).toEqual({ ymd: '2026-11-18', hm: '01:30' })
    expect(dushanbeToday(new Date('2026-11-17T18:59:00Z'))).toBe('2026-11-17')
    expect(dushanbeToday(new Date('2026-11-17T19:00:00Z'))).toBe('2026-11-18')
  })

  it('addDays и daysBetween — через границы месяца, года, високосный день', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 7)).toBe('2027-01-07')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-11-17', -1)).toBe('2026-11-16')
    expect(daysBetween('2026-11-17', '2026-11-24')).toBe(7)
    expect(daysBetween('2026-11-24', '2026-11-17')).toBe(-7)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })

  it('dayMonth — год только если он не текущий', () => {
    expect(dayMonth('2026-11-18')).toBe('18 ноября')
    expect(dayMonth('2026-01-05', '2026-11-17')).toBe('5 января')
    expect(dayMonth('2027-01-05', '2026-11-17')).toBe('5 января 2027')
  })

  it('pluralRu', () => {
    expect(pluralRu(1, 'день', 'дня', 'дней')).toBe('день')
    expect(pluralRu(2, 'день', 'дня', 'дней')).toBe('дня')
    expect(pluralRu(5, 'день', 'дня', 'дней')).toBe('дней')
    expect(pluralRu(11, 'день', 'дня', 'дней')).toBe('дней')
    expect(pluralRu(21, 'день', 'дня', 'дней')).toBe('день')
    expect(pluralRu(22, 'день', 'дня', 'дней')).toBe('дня')
    expect(pluralRu(112, 'день', 'дня', 'дней')).toBe('дней')
  })
})

describe('Быстрая форма: кнопки «Срок»', () => {
  it('Сегодня / Завтра / Через неделю — до 18:00', () => {
    expect(resolveDue('today', NOW)).toEqual({ date: '2026-11-17', time: '18:00' })
    expect(resolveDue('tomorrow', NOW)).toEqual({ date: '2026-11-18', time: '18:00' })
    expect(resolveDue('week', NOW)).toEqual({ date: '2026-11-24', time: '18:00' })
  })

  it('«Сегодня» с 18:00 по Душанбе — до конца дня, чтобы не родилась просроченной', () => {
    // 12:59 UTC = 17:59 Душанбе.
    expect(resolveDue('today', new Date('2026-11-17T12:59:00Z'))).toEqual({ date: '2026-11-17', time: '18:00' })
    // 13:00 UTC = 18:00, 14:00 UTC = 19:00.
    expect(resolveDue('today', new Date('2026-11-17T13:00:00Z'))).toEqual({ date: '2026-11-17', time: '23:59' })
    expect(resolveDue('today', new Date('2026-11-17T14:00:00Z'))).toEqual({ date: '2026-11-17', time: '23:59' })
  })

  it('«Завтра» считается от дня в Душанбе, а не на устройстве', () => {
    // 20:00 UTC 17-го — в Душанбе уже 01:00 18-го.
    expect(resolveDue('tomorrow', new Date('2026-11-17T20:00:00Z'))).toEqual({ date: '2026-11-19', time: '18:00' })
  })

  it('«Дата…»: день обязателен, время по умолчанию 18:00', () => {
    expect(resolveDue('date', NOW, { date: '2026-12-05', time: '' })).toEqual({ date: '2026-12-05', time: '18:00' })
    expect(resolveDue('date', NOW, { date: '2026-12-05', time: '10:30' })).toEqual({ date: '2026-12-05', time: '10:30' })
    expect(resolveDue('date', NOW, { date: '' })).toBeNull()
    expect(resolveDue('date', NOW)).toBeNull()
  })

  it('deadlineIso — время Душанбе в UTC', () => {
    expect(deadlineIso('2026-11-18', '18:00')).toBe('2026-11-18T13:00:00.000Z')
    expect(deadlineIso('2026-11-18', '23:59')).toBe('2026-11-18T18:59:00.000Z')
    expect(deadlineIso('2026-11-18', '03:00')).toBe('2026-11-17T22:00:00.000Z')
  })

  it('dueCaption — подпись под кнопками', () => {
    expect(dueCaption('2026-11-17', '18:00', NOW)).toBe('сегодня, до 18:00')
    expect(dueCaption('2026-11-18', '18:00', NOW)).toBe('18 ноября, до 18:00')
    expect(dueCaption('2027-01-05', '12:00', NOW)).toBe('5 января 2027, до 12:00')
  })
})

describe('Строки «Задач»: срок и «когда»', () => {
  it('dueLabel — без срока, будущее, просрочка', () => {
    expect(dueLabel(null, NOW)).toEqual({ text: 'без срока', late: false })
    expect(dueLabel('не дата', NOW)).toEqual({ text: 'без срока', late: false })
    // 13:00 UTC = 18:00 Душанбе.
    expect(dueLabel('2026-11-17T13:00:00Z', NOW)).toEqual({ text: 'сегодня до 18:00', late: false })
    expect(dueLabel('2026-11-18T13:00:00Z', NOW)).toEqual({ text: 'завтра до 18:00', late: false })
    expect(dueLabel('2026-11-21T13:00:00Z', NOW)).toEqual({ text: 'до 21 ноября', late: false })
    // Сегодня в 10:00 по Душанбе — уже прошло.
    expect(dueLabel('2026-11-17T05:00:00Z', NOW)).toEqual({ text: 'просрочено сегодня', late: true })
    expect(dueLabel('2026-11-16T13:00:00Z', NOW)).toEqual({ text: 'просрочено на 1 день', late: true })
    expect(dueLabel('2026-11-14T13:00:00Z', NOW)).toEqual({ text: 'просрочено на 3 дня', late: true })
    expect(dueLabel('2026-11-12T13:00:00Z', NOW)).toEqual({ text: 'просрочено на 5 дней', late: true })
  })

  it('whenLabel — сегодня / вчера / дата, по Душанбе', () => {
    expect(whenLabel('2026-11-17T10:40:00Z', NOW, true)).toBe('сегодня в 15:40')
    expect(whenLabel('2026-11-16T10:00:00Z', NOW)).toBe('вчера')
    expect(whenLabel('2026-11-10T10:00:00Z', NOW)).toBe('10 ноября')
    // 19:30 UTC 16-го — в Душанбе уже 00:30 17-го.
    expect(whenLabel('2026-11-16T19:30:00Z', NOW)).toBe('сегодня')
    expect(whenLabel(null, NOW)).toBe('')
  })
})
