// TikTok (решение владельца 14.11.2026, вариант А): всё, что выходит в
// Instagram, дублируется в TikTok. У публикации две отметки: Instagram — это
// статус «Опубликовано», TikTok — отдельная отметка (tiktokAt). Нужен ли
// TikTok, решает сервер (поле tiktok у события): по умолчанию у всех
// проектов, у некоторых его выключают; сторис — без TikTok.

/** Вышло в Instagram. */
export const igDone = (e: any): boolean => e?.status === 'published'
/** TikTok нужен, а отметки ещё нет. */
export const tiktokPending = (e: any): boolean => !!e?.tiktok && !e?.tiktokAt
/** Публикация сделана: вышла в Instagram и, если нужен, в TikTok. */
export const pubDone = (e: any): boolean => igDone(e) && !tiktokPending(e)
