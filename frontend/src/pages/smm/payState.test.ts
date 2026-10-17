import { describe, expect, it } from 'vitest'
import { payStateText } from './payState'

const TODAY = '2026-10-12'

describe('payStateText — состояние словами', () => {
  const at = (state: string, date: string, paidAt: string | null = null) =>
    payStateText({ state: state as any, date, paidAt }, TODAY)

  it('просрочка и ожидание склоняются по числу дней', () => {
    expect(at('late', '2026-10-11')).toBe('просрочено 1 день')
    expect(at('late', '2026-10-08')).toBe('просрочено 4 дня')
    expect(at('late', '2026-09-30')).toBe('просрочено 12 дней')
    expect(at('wait', '2026-10-13')).toBe('завтра')
    expect(at('wait', '2026-10-17')).toBe('через 5 дней')
    expect(at('wait', '2026-11-02')).toBe('через 21 день')
  })

  it('оплаченное называет день получения, а не срок', () => {
    expect(at('paid', '2026-10-14', '2026-10-10')).toBe('оплачено 10 октября')
  })
})
