// TikTok (решение владельца 14.11.2026, вариант А): всё, что выходит в
// Instagram, дублируется в TikTok. У публикации две отметки: Instagram — это
// статус «Опубликовано», TikTok — отдельная отметка (tiktokAt). Нужен ли
// TikTok, решает сервер (поле tiktok у события): по умолчанию у всех
// проектов, у некоторых его выключают; сторис — без TikTok.

import { dayMonth, daysBetween, pluralRu } from '@/lib/taskDue'

/** Вышло в Instagram. */
export const igDone = (e: any): boolean => e?.status === 'published'
/** TikTok нужен, а отметки ещё нет. */
export const tiktokPending = (e: any): boolean => !!e?.tiktok && !e?.tiktokAt
/** Публикация сделана: вышла в Instagram и, если нужен, в TikTok. */
export const pubDone = (e: any): boolean => igDone(e) && !tiktokPending(e)

// ─── Профиль проекта: блок «Где публикуем» (17.11.2026) ───────────────
// TikTok включает и выключает SMM-специалист проекта или руководство;
// изменение действует с дня переключения, прошлые публикации не трогаем
// (docs/SMM_DELEGATION_SPEC.md, раздел 2).

/** Запись истории переключений (сервер: tiktokHistory, новые сверху). */
export interface TiktokChange { from: string; on: boolean; byName?: string | null; at?: string | null }

/** Подпись под переключателем. today — сегодня по Душанбе, 'YYYY-MM-DD'. */
export function tiktokCaption(on: boolean, history: TiktokChange[] | null | undefined, today: string, canToggle: boolean): string {
  if (on) {
    return canToggle
      ? 'Рилсы и посты дублируем в TikTok. Выключите, если проект там не выходит — уже прошедшие публикации останутся как есть.'
      : 'Рилсы и посты дублируем в TikTok.'
  }
  const last = history?.[0]
  if (!last || last.on || !/^\d{4}-\d{2}-\d{2}$/.test(last.from)) return 'Публикации в TikTok не дублируем.'
  return daysBetween(last.from, today) === 0 ? 'Выключено с сегодняшнего дня.' : `Выключено с ${dayMonth(last.from, today)}.`
}

/** «3 прошлые публикации ещё ждут отметки TikTok.»; 0 — пусто. */
export function tiktokPendingText(n: number | null | undefined): string {
  const k = Math.trunc(Number(n) || 0)
  if (k < 1) return ''
  return `${k} ${pluralRu(k, 'прошлая публикация', 'прошлые публикации', 'прошлых публикаций')} ещё ${pluralRu(k, 'ждёт', 'ждут', 'ждут')} отметки TikTok.`
}

/** Строка истории: «с 17 ноября — выключен · Мадина». */
export function tiktokHistoryLine(h: TiktokChange, today: string): string {
  const when = /^\d{4}-\d{2}-\d{2}$/.test(h.from) ? `с ${dayMonth(h.from, today)}` : 'с начала'
  return `${when} — ${h.on ? 'включён' : 'выключен'}${h.byName ? ` · ${h.byName}` : ''}`
}
