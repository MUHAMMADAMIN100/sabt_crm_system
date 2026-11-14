/** TikTok (решение владельца 14.11.2026): всё, что выходит в Instagram,
 *  дублируется в TikTok — у всех SMM-проектов, у некоторых его выключают
 *  (smmData.tiktokOff). Сторис — без TikTok. Публикации раньше этого дня
 *  TikTok не ждут: иначе весь закрытый план разом стал бы «не сделан».
 *  Instagram — это status «published», TikTok — content_plan_items.tiktokAt. */
export const TIKTOK_FROM = '2026-11-15';

/** Нужна ли публикации отметка TikTok. */
export function tiktokNeeded(projectOff: boolean, date?: string | null): boolean {
  return !projectOff && !!date && date >= TIKTOK_FROM;
}
