import { describe, it, expect } from 'vitest'
import { checkinLabel, dayMonthLabel, daysLabel, mondayOf, pluralRu } from '@/lib/goals'

describe('Компас: склонения', () => {
  it('pluralRu — один, несколько, много', () => {
    expect(pluralRu(1, 'день', 'дня', 'дней')).toBe('день')
    expect(pluralRu(2, 'день', 'дня', 'дней')).toBe('дня')
    expect(pluralRu(5, 'день', 'дня', 'дней')).toBe('дней')
    expect(pluralRu(11, 'день', 'дня', 'дней')).toBe('дней')
    expect(pluralRu(21, 'день', 'дня', 'дней')).toBe('день')
    expect(pluralRu(104, 'день', 'дня', 'дней')).toBe('дня')
    expect(pluralRu(0, 'день', 'дня', 'дней')).toBe('дней')
  })

  it('daysLabel — «до конца N дней»', () => {
    expect(daysLabel(1)).toBe('1 день')
    expect(daysLabel(3)).toBe('3 дня')
    expect(daysLabel(14)).toBe('14 дней')
  })
})

describe('Компас: даты', () => {
  it('dayMonthLabel — «16 ноября»', () => {
    expect(dayMonthLabel('2026-11-16')).toBe('16 ноября')
    expect(dayMonthLabel('2026-01-05')).toBe('5 января')
  })

  it('mondayOf — понедельник недели', () => {
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    expect(mondayOf('2026-11-18')).toBe('2026-11-16')
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26')
  })
})

describe('Компас: подпись отметки недели', () => {
  it('нет отметки — «не отмечен»', () => {
    expect(checkinLabel(null, '2026-11-18')).toBe('не отмечен')
  })

  it('отметка этой недели — день недели по Душанбе', () => {
    expect(checkinLabel({ weekStart: '2026-11-16', at: '2026-11-16T05:30:00.000Z' }, '2026-11-18')).toBe('статус: пн')
    // 20:00 UTC — уже 01:00 вторника в Душанбе.
    expect(checkinLabel({ weekStart: '2026-11-16', at: '2026-11-16T20:00:00.000Z' }, '2026-11-18')).toBe('статус: вт')
  })

  it('отметка прошлой недели — дата', () => {
    expect(checkinLabel({ weekStart: '2026-11-09', at: '2026-11-10T04:00:00.000Z' }, '2026-11-18')).toBe('статус: 10 ноября')
  })
})
