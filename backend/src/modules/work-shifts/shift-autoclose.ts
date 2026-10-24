/**
 * Забытая смена: человек нажал «Начать», а «Завершить» — нет.
 *
 * Правило владельца (24.10.2026): такая смена закрывается ровно в 23:59 по
 * Душанбе того дня, когда началась. Пометка «закрыта автоматически»
 * остаётся — руководитель видит, что время не подтверждено нажатием, а
 * сотрудник может поправить его через запрос на исправление.
 *
 * Раньше конец брали по последней активности в CRM. Она обновлялась только
 * пока вкладка была на экране, поэтому у тех, кто работает в Figma, на
 * съёмке или с телефона, смены выходили «08:57 — 08:57».
 *
 * Здесь — чистые правила без базы, чтобы их можно было проверить тестами.
 */

/** Таджикистан живёт в UTC+5 круглый год, перевода часов нет. Смещение
 *  пишем явно: сервер на проде в UTC, и setHours() давал бы 23:59 по
 *  Гринвичу, то есть 04:59 следующего утра по Душанбе. */
const DUSHANBE_OFFSET = '+05:00';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

const dushanbeDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(d);

/** 23:59 по Душанбе в день `date` ('YYYY-MM-DD'). */
export function dayEndDushanbe(date: string): Date {
  return new Date(`${date.slice(0, 10)}T23:59:00${DUSHANBE_OFFSET}`);
}

/** День смены по календарю Душанбе. Обычно это колонка date; если её нет
 *  или она странная — считаем по началу смены. */
function shiftDay(shift: { startedAt: Date | string; date?: string | null }): string {
  const raw = shift.date == null ? '' : String(shift.date);
  return ISO_DAY.test(raw) ? raw.slice(0, 10) : dushanbeDay(new Date(shift.startedAt));
}

/** Когда закрыть забытую смену: 23:59 её дня. Начали уже после 23:59 —
 *  концом становится само начало, отрицательных часов не бывает. */
export function forgottenShiftEnd(shift: { startedAt: Date | string; date?: string | null }): Date {
  const end = dayEndDushanbe(shiftDay(shift));
  const started = new Date(shift.startedAt);
  return end.getTime() < started.getTime() ? started : end;
}

/** Открытые смены прошлых дней: их ночной крон пропустил — например, сервер
 *  перезапускался ровно в 23:59. Сегодняшние не трогаем, они ещё идут. */
export function staleOpenShifts<T extends { date?: string | null; startedAt?: Date | string }>(
  open: T[], today: string,
): T[] {
  return open.filter(s => {
    const raw = s.date == null ? '' : String(s.date);
    const day = ISO_DAY.test(raw) ? raw.slice(0, 10) : (s.startedAt ? dushanbeDay(new Date(s.startedAt)) : today);
    return day < today;
  });
}
