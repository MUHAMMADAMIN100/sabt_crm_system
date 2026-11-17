/** TikTok (решение владельца 14.11.2026): всё, что выходит в Instagram,
 *  дублируется в TikTok — у всех SMM-проектов, у некоторых его выключают.
 *  Сторис — без TikTok. Публикации раньше этого дня TikTok не ждут: иначе
 *  весь закрытый план разом стал бы «не сделан».
 *  Instagram — это status «published», TikTok — content_plan_items.tiktokAt.
 *
 *  17.11.2026 (docs/SMM_DELEGATION_SPEC.md §2): переключение действует С ДНЯ
 *  ИЗМЕНЕНИЯ, а не задним числом. Журнал — smmData.tiktokLog; smmData.tiktokOff
 *  по-прежнему пишется = текущее состояние (совместимость). Пустой журнал —
 *  состояние !tiktokOff на всём периоде с TIKTOK_FROM, как раньше. */
export const TIKTOK_FROM = '2026-11-15';

/** Запись журнала TikTok проекта (smmData.tiktokLog). */
export interface TiktokLogEntry {
  /** С какого дня действует, 'YYYY-MM-DD' по Душанбе. */
  from: string;
  on: boolean;
  /** Кто переключил (id пользователя); null — запись-затравка из tiktokOff. */
  by: string | null;
  byName: string | null;
  /** Когда переключили, ISO. */
  at: string;
}

/** Период, когда TikTok у проекта выключен: [from, to), to = null — по сей день. */
export interface TiktokOffRange {
  from: string;
  to: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Журнал из smmData: только корректные записи, по возрастанию from,
 *  на один день — одна запись (последняя). */
export function tiktokLogOf(smmData: unknown): TiktokLogEntry[] {
  const raw = (smmData as any)?.tiktokLog;
  if (!Array.isArray(raw)) return [];
  const byDay = new Map<string, TiktokLogEntry>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.from !== 'string' || !DAY_RE.test(e.from) || typeof e.on !== 'boolean') continue;
    byDay.set(e.from, {
      from: e.from,
      on: e.on,
      by: typeof e.by === 'string' ? e.by : null,
      byName: typeof e.byName === 'string' ? e.byName : null,
      at: typeof e.at === 'string' ? e.at : '',
    });
  }
  return [...byDay.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Включён ли TikTok у проекта на дату `date` ('YYYY-MM-DD'): последняя
 *  запись журнала с from <= date; до первой записи — включён. */
export function tiktokOnAt(smmData: unknown, date: string): boolean {
  const log = tiktokLogOf(smmData);
  if (!log.length) return !((smmData as any)?.tiktokOff === true && date >= TIKTOK_FROM);
  let on = true;
  for (const e of log) {
    if (e.from > date) break;
    on = e.on;
  }
  return on;
}

/** Периоды выключенного TikTok — для SQL (jsonb_to_recordset): публикация
 *  с датой d не ждёт TikTok, если from <= d и (to = null или d < to). */
export function tiktokOffRanges(smmData: unknown): TiktokOffRange[] {
  const log = tiktokLogOf(smmData);
  if (!log.length) {
    return (smmData as any)?.tiktokOff === true ? [{ from: TIKTOK_FROM, to: null }] : [];
  }
  const out: TiktokOffRange[] = [];
  let on = true;
  let openFrom: string | null = null;
  for (const e of log) {
    if (e.on === on) continue;
    if (!e.on) {
      openFrom = e.from;
    } else {
      out.push({ from: openFrom as string, to: e.from });
      openFrom = null;
    }
    on = e.on;
  }
  if (openFrom) out.push({ from: openFrom, to: null });
  return out;
}

/** Нужна ли публикации с датой `date` отметка TikTok: с TIKTOK_FROM, не
 *  сторис и TikTok у проекта включён НА ЭТУ ДАТУ. */
export function tiktokNeeded(smmData: unknown, date?: string | null, contentType?: string | null): boolean {
  if (!date || date < TIKTOK_FROM || contentType === 'story') return false;
  return tiktokOnAt(smmData, date);
}

/** Журнал после переключения TikTok в день `day` (сегодня по Душанбе):
 *  - пустой журнал при tiktokOff = true сначала засеивается записью
 *    { from: TIKTOK_FROM, on: false } — прошлое остаётся выключенным;
 *  - запись этого дня заменяется новой;
 *  - совпало с состоянием до этого дня — запись дня не нужна (удаляется).
 *  Пустой результат = TikTok включён (tiktokOff писать не нужно). */
export function toggleTiktokLog(
  smmData: unknown,
  on: boolean,
  day: string,
  meta: { by: string | null; byName: string | null; at: string },
): TiktokLogEntry[] {
  let log = tiktokLogOf(smmData);
  if (!log.length && (smmData as any)?.tiktokOff === true) {
    log = [{ from: TIKTOK_FROM, on: false, by: null, byName: null, at: meta.at }];
  }
  // Записи этого дня (и «будущие», которых быть не должно) — заменяем.
  const kept = log.filter(e => e.from < day);
  const before = kept.length ? kept[kept.length - 1].on : true;
  if (before !== on) kept.push({ from: day, on, by: meta.by, byName: meta.byName, at: meta.at });
  return kept;
}
