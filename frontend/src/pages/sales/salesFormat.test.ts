import { describe, it, expect } from 'vitest'
import type { Handoff } from '@/types/sales'
import {
  dayLabel, dushanbeDay, handedOverAgo, handoffAmount, handoffProjectUrl, instagramHandle, money,
  percentOf, periodLabel, periodRange, plural,
} from './salesFormat'
import { amountDraft, devTypeFromProduct, handoffClientInfo, handoffLinkFields, parseAmount } from './handoffPrefill'

// Пробелы в числах ru-RU — неразрывные; сравниваем с обычными.
const flat = (s: string) => s.replace(/\s/g, ' ')

describe('Продажи: периоды аналитики (по Душанбе, 15.11.2026)', () => {
  it('месяц — весь календарный месяц', () => {
    expect(periodRange('month', '2026-11-15')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('month', '2028-02-03')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('квартал — три месяца, в которые попадает день', () => {
    expect(periodRange('quarter', '2026-11-15')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('quarter', '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
  })

  it('год — с 1 января по 31 декабря', () => {
    expect(periodRange('year', '2026-11-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('подписи периода', () => {
    expect(periodLabel('month', '2026-11-15')).toBe('ноябрь 2026')
    expect(periodLabel('quarter', '2026-11-15')).toBe('IV квартал 2026')
    expect(periodLabel('year', '2026-11-15')).toBe('2026 год')
  })

  it('день по Душанбе (UTC+5), а не по часам браузера', () => {
    expect(dushanbeDay(new Date('2026-11-15T18:59:00Z'))).toBe('2026-11-15')
    expect(dushanbeDay(new Date('2026-11-15T20:30:00Z'))).toBe('2026-11-16')
    expect(dushanbeDay('2026-11-15T19:00:00.000Z')).toBe('2026-11-16')
  })
})

describe('Продажи: подписи', () => {
  it('русское множественное число', () => {
    expect(plural(1, 'день', 'дня', 'дней')).toBe('день')
    expect(plural(2, 'день', 'дня', 'дней')).toBe('дня')
    expect(plural(5, 'день', 'дня', 'дней')).toBe('дней')
    expect(plural(11, 'день', 'дня', 'дней')).toBe('дней')
    expect(plural(21, 'день', 'дня', 'дней')).toBe('день')
    expect(plural(22, 'день', 'дня', 'дней')).toBe('дня')
    expect(plural(112, 'день', 'дня', 'дней')).toBe('дней')
  })

  it('«передано N дней назад» — по календарным дням Душанбе', () => {
    expect(handedOverAgo('2026-11-15T04:00:00Z', '2026-11-15')).toBe('передано сегодня')
    expect(handedOverAgo('2026-11-14T10:00:00Z', '2026-11-15')).toBe('передано вчера')
    expect(handedOverAgo('2026-11-13T10:00:00Z', '2026-11-15')).toBe('передано 2 дня назад')
    expect(handedOverAgo('2026-11-10T10:00:00Z', '2026-11-15')).toBe('передано 5 дней назад')
    // 14.11 в 20:00 UTC — уже 15.11 в Душанбе.
    expect(handedOverAgo('2026-11-14T20:00:00Z', '2026-11-15')).toBe('передано сегодня')
  })

  it('деньги — «12 300 с.»', () => {
    expect(flat(money(12300))).toBe('12 300 с.')
    expect(flat(money('4500.6'))).toBe('4 501 с.')
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
  })

  it('сумма заявки: SMM — в месяц, разработка — за проект', () => {
    expect(flat(handoffAmount(3000, 'smm'))).toBe('3 000 с./мес')
    expect(flat(handoffAmount(12000, 'development'))).toBe('12 000 с.')
    expect(handoffAmount(null, 'smm')).toBe('—')
  })

  it('проценты без деления на ноль', () => {
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(3, 0)).toBe(0)
  })

  it('дата YYYY-MM-DD — «20 ноября», чужой год — с годом', () => {
    expect(dayLabel('2026-11-20', '2026-11-15')).toBe('20 ноября')
    expect(dayLabel('2027-01-05', '2026-11-15')).toBe('5 января 2027')
    expect(dayLabel(null, '2026-11-15')).toBe('—')
  })

  it('Instagram из ссылки или @имени', () => {
    expect(instagramHandle('https://www.instagram.com/yalla.coffee/')).toEqual({ handle: '@yalla.coffee', url: 'https://instagram.com/yalla.coffee' })
    expect(instagramHandle('@shop')?.handle).toBe('@shop')
    expect(instagramHandle('  ')).toBeNull()
  })

  it('ссылка на проект по направлению заявки', () => {
    expect(handoffProjectUrl({ direction: 'smm', projectId: 'p1' })).toBe('/smm/projects/p1')
    expect(handoffProjectUrl({ direction: 'development', projectId: 'p2' })).toBe('/dev/projects/p2')
    expect(handoffProjectUrl({ direction: 'smm', projectId: null })).toBeNull()
  })
})

describe('Продажи: проект по заявке — что подставляется', () => {
  const handoff: Handoff = {
    leadId: 'lead-1',
    leadName: 'Yalla Coffee',
    direction: 'development',
    product: 'Лендинг',
    amount: 12000,
    firstPaymentAt: '2026-11-20',
    note: 'Срочно',
    sendBrief: true,
    handoffAt: '2026-11-14T10:00:00Z',
    manager: { id: 'user-1', name: 'Аня' },
    projectId: null,
    contactPerson: ' Рустам ',
    contactPhone: '+992 900 00 00 00',
    contactInstagram: '',
  }

  it('контакты клиента — в формате clientInfo, пустые не пишем', () => {
    expect(handoffClientInfo(handoff)).toEqual({ companyName: 'Yalla Coffee', contactPerson: 'Рустам', phone: '+992 900 00 00 00' })
  })

  it('лид и менеджер, который продал', () => {
    expect(handoffLinkFields(handoff)).toEqual({ leadId: 'lead-1', salesManagerId: 'user-1' })
    expect(handoffLinkFields({ ...handoff, manager: null })).toEqual({ leadId: 'lead-1' })
  })

  it('тип разработки из продукта заявки', () => {
    expect(devTypeFromProduct('Лендинг')).toBe('Лендинг')
    expect(devTypeFromProduct(' телеграм бот ')).toBe('Телеграм бот')
    expect(devTypeFromProduct('Разработка')).toBe('Web сайт')
    expect(devTypeFromProduct('SMM Старт')).toBeNull()
    expect(devTypeFromProduct(null)).toBeNull()
  })

  it('сумма для поля ввода и обратно', () => {
    expect(amountDraft(12000.4)).toBe('12000')
    expect(amountDraft(0)).toBe('')
    expect(amountDraft(null)).toBe('')
    expect(parseAmount('12 000')).toBe(12000)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('0')).toBeNull()
  })
})
