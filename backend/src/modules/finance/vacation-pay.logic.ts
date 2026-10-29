/** Отпуск в зарплате (29.10.2026, вариант Б).
 *
 *  Отпуск «за свой счёт» сам в зарплату не вычитается: ведомость лишь
 *  подсказывает сумму, а владелец решает — «Удержать» или «Не удерживать».
 *  Сумма = оклад ÷ рабочие дни месяца по графику × рабочие дни отпуска в этом
 *  месяце. Отпуск через два месяца делится: каждый месяц — своя подсказка в
 *  своей ведомости. Оплачиваемый отпуск зарплату не меняет, только виден. */

/** Строка графика смены (work_schedules): с какого дня действует и чья. */
export interface ScheduleRowLike {
  userId: string | null;
  validFrom: string;
  workdays: string | null;
  followsCompany?: boolean | null;
}

/** Решение владельца по отпуску за месяц. Даты — та часть отпуска, что
 *  попала в месяц, когда решали: поменяли даты — решение больше не про то. */
export interface VacationDecision {
  decision: 'withheld' | 'dismissed';
  from: string;
  until: string;
  entryId?: string | null;
  amount?: number;
}

export interface VacationRecordLike {
  id: string;
  userId: string | null;
  dateFrom: string;
  dateUntil: string;
  paid: boolean;
  decisions?: Record<string, VacationDecision> | null;
}

export type VacationHintState = 'pending' | 'withheld' | 'dismissed' | 'paid';

export interface VacationHint {
  vacationId: string;
  /** Весь отпуск — для пометки «в отпуске до 9 нояб.». */
  from: string;
  until: string;
  /** Часть отпуска в этом месяце. */
  monthFrom: string;
  monthUntil: string;
  paid: boolean;
  /** Рабочих дней отпуска в месяце и всего рабочих дней месяца по графику. */
  days: number;
  monthWorkdays: number;
  salary: number;
  amount: number;
  state: VacationHintState;
  /** Удержали раньше, а даты отпуска потом поменялись — запись заменим. */
  previousEntryId: string | null;
  previousAmount: number | null;
}

const DEFAULT_WORKDAYS = '1,2,3,4,5,6';

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
export const monthBounds = (ym: string) => ({ from: `${ym}-01`, to: `${ym}-${pad(daysInMonth(ym))}` });

/** День недели 1 (пн) … 7 (вс). */
const dowOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Строка графика, действовавшая в этот день: ближайшая снизу по validFrom. */
function rowFor(rows: ScheduleRowLike[], userId: string | null, iso: string): ScheduleRowLike | null {
  let best: ScheduleRowLike | null = null;
  for (const r of rows) {
    if (r.userId !== userId) continue;
    const vf = String(r.validFrom).slice(0, 10);
    if (vf > iso) continue;
    if (!best || vf >= String(best.validFrom).slice(0, 10)) best = r;
  }
  return best;
}

/** Рабочий ли день у человека по его графику на этот день (как в табеле:
 *  личный сильнее общего, «как у всех» — снова общий). */
export function isWorkdayFor(rows: ScheduleRowLike[], userId: string | null, iso: string): boolean {
  const mine = userId ? rowFor(rows, userId, iso) : null;
  const row = mine && !mine.followsCompany ? mine : rowFor(rows, null, iso);
  const days = (row?.workdays || DEFAULT_WORKDAYS).split(',').map(x => Number(x.trim()));
  return days.includes(dowOf(iso));
}

/** Рабочих дней по графику в промежутке «с — по» включительно. */
export function workdaysBetween(rows: ScheduleRowLike[], userId: string | null, from: string, until: string): number {
  let n = 0;
  for (let d = from; d <= until; d = nextDay(d)) if (isWorkdayFor(rows, userId, d)) n++;
  return n;
}

/** Часть отпуска, попавшая в месяц, или null. */
export function clipToMonth(from: string, until: string, ym: string): { from: string; until: string } | null {
  const b = monthBounds(ym);
  const f = from > b.from ? from : b.from;
  const u = until < b.to ? until : b.to;
  return f <= u ? { from: f, until: u } : null;
}

/** Сколько отпуск стоит в месяце: оклад ÷ рабочие дни месяца × рабочие дни
 *  отпуска. Округляем до сомони — копейки в отпускных никому не нужны. */
export function vacationMonthCost(
  rows: ScheduleRowLike[], userId: string | null, salary: number, from: string, until: string, ym: string,
): { monthFrom: string; monthUntil: string; days: number; monthWorkdays: number; amount: number } | null {
  const part = clipToMonth(from, until, ym);
  if (!part) return null;
  const b = monthBounds(ym);
  const monthWorkdays = workdaysBetween(rows, userId, b.from, b.to);
  const days = workdaysBetween(rows, userId, part.from, part.until);
  const amount = monthWorkdays > 0 && salary > 0 ? Math.round((salary / monthWorkdays) * days) : 0;
  return { monthFrom: part.from, monthUntil: part.until, days, monthWorkdays, amount };
}

/** Подсказка по отпуску для строки ведомости. existingEntryIds — записи
 *  «Отпускные» этого месяца: удалили запись — подсказка снова ждёт решения. */
export function vacationHint(
  v: VacationRecordLike, rows: ScheduleRowLike[], salary: number, ym: string, existingEntryIds: Set<string>,
): VacationHint | null {
  const cost = vacationMonthCost(rows, v.userId, salary, v.dateFrom, v.dateUntil, ym);
  if (!cost || cost.days <= 0) return null;
  const d = v.decisions?.[ym] ?? null;
  const sameDates = !!d && d.from === cost.monthFrom && d.until === cost.monthUntil;
  const entryAlive = !!d?.entryId && existingEntryIds.has(d.entryId);
  let state: VacationHintState = 'pending';
  if (v.paid) state = 'paid';
  else if (d && sameDates && d.decision === 'dismissed') state = 'dismissed';
  else if (d && sameDates && d.decision === 'withheld' && entryAlive) state = 'withheld';
  const stale = state === 'pending' && d?.decision === 'withheld' && entryAlive;
  return {
    vacationId: v.id,
    from: v.dateFrom,
    until: v.dateUntil,
    paid: !!v.paid,
    salary,
    ...cost,
    state,
    previousEntryId: stale ? (d!.entryId as string) : null,
    previousAmount: stale ? Number(d!.amount) || null : null,
  };
}
