import { describe, expect, it } from 'vitest'
import { tiktokCaption, tiktokHistoryLine, tiktokPendingText } from './tiktok'

const TODAY = '2026-11-17'

describe('Профиль проекта: блок «Где публикуем» (17.11.2026)', () => {
  it('подпись: включён — подсказка только тому, кто может переключить', () => {
    expect(tiktokCaption(true, [], TODAY, true))
      .toBe('Рилсы и посты дублируем в TikTok. Выключите, если проект там не выходит — уже прошедшие публикации останутся как есть.')
    expect(tiktokCaption(true, [], TODAY, false)).toBe('Рилсы и посты дублируем в TikTok.')
  })

  it('подпись: выключен — с какого дня', () => {
    expect(tiktokCaption(false, [{ from: '2026-11-17', on: false }], TODAY, true)).toBe('Выключено с сегодняшнего дня.')
    expect(tiktokCaption(false, [{ from: '2026-11-12', on: false }, { from: '2026-11-01', on: true }], TODAY, true))
      .toBe('Выключено с 12 ноября.')
    // Истории нет (выключили до журнала) — без даты.
    expect(tiktokCaption(false, [], TODAY, true)).toBe('Публикации в TikTok не дублируем.')
    expect(tiktokCaption(false, undefined, TODAY, false)).toBe('Публикации в TikTok не дублируем.')
  })

  it('прошлые публикации без отметки TikTok — с согласованием числа', () => {
    expect(tiktokPendingText(0)).toBe('')
    expect(tiktokPendingText(undefined)).toBe('')
    expect(tiktokPendingText(1)).toBe('1 прошлая публикация ещё ждёт отметки TikTok.')
    expect(tiktokPendingText(3)).toBe('3 прошлые публикации ещё ждут отметки TikTok.')
    expect(tiktokPendingText(5)).toBe('5 прошлых публикаций ещё ждут отметки TikTok.')
    expect(tiktokPendingText(11)).toBe('11 прошлых публикаций ещё ждут отметки TikTok.')
    expect(tiktokPendingText(21)).toBe('21 прошлая публикация ещё ждёт отметки TikTok.')
  })

  it('строка истории', () => {
    expect(tiktokHistoryLine({ from: '2026-11-17', on: false, byName: 'Мадина' }, TODAY)).toBe('с 17 ноября — выключен · Мадина')
    expect(tiktokHistoryLine({ from: '2026-11-14', on: true, byName: null }, TODAY)).toBe('с 14 ноября — включён')
    expect(tiktokHistoryLine({ from: '2025-12-01', on: false }, TODAY)).toBe('с 1 декабря 2025 — выключен')
  })
})
