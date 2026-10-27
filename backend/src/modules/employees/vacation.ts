/** Отпуск сотрудника (27.10.2026): статус «В отпуске» с датами «с — по».
 *  Пока отпуск идёт, в CRM открыт только профиль, Telegram и пуши не шлём,
 *  карточки СММ сами не назначаем. После даты «по» статус сам возвращается
 *  в «Активный» (VacationScheduler), но и до того по датам видно, что отпуск
 *  кончился — доступ открывается вовремя, даже если крон опоздал. */

/** Сегодня по Душанбе — сервер живёт в UTC. */
export function dushanbeToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

/** 'YYYY-MM-DD' из того, что вернул драйвер (строка или Date). */
export function ymd(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(v);
  }
  return null;
}

export interface VacationNow { from: string | null; until: string | null }

/** Идёт ли отпуск сегодня. Статус «В отпуске» с будущей датой «с» — ещё нет. */
export function vacationNow(
  e: { status?: string | null; vacationFrom?: unknown; vacationUntil?: unknown } | null | undefined,
  today = dushanbeToday(),
): VacationNow | null {
  if (!e || e.status !== 'vacation') return null;
  const from = ymd(e.vacationFrom);
  const until = ymd(e.vacationUntil);
  if (from && today < from) return null;
  if (until && today > until) return null;
  return { from, until };
}

/** SQL-условие «сейчас в отпуске» для таблицы employees (алиас и параметр даты). */
export const VACATION_NOW_SQL = (alias: string, param: string) =>
  `${alias}.status = 'vacation' AND (${alias}."vacationFrom" IS NULL OR ${alias}."vacationFrom" <= ${param}) AND (${alias}."vacationUntil" IS NULL OR ${alias}."vacationUntil" >= ${param})`;
