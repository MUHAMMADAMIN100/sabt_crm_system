/** Рассрочки сотрудников: чистая арифметика без БД.
 *
 *  Два способа возврата (решение владельца 27.10.2026 — у каждой рассрочки свой):
 *  - «из зарплаты» (salary): удержание месяца M = min(план месяца, остаток),
 *    деньги удерживаются в день выплаты зарплаты — 10-го числа месяца M+1.
 *    Выплаченный месяц берёт сумму из снимка зарплаты
 *    (salarySnapshots[M].installments[id]) — она не меняется задним числом;
 *  - «платит отдельно» (separate): сотрудник вносит деньги к своему числу.
 *    Платежи покрывают график по порядку («водопадом»): лишнее закрывает
 *    следующие месяцы, недостача висит на самом раннем — он и просрочен. */

export interface InstallmentLike {
  id: string;
  name: string;
  totalAmount: number | string;
  monthlyAmount: number | string;
  startYm: string;
  paidBefore?: number | string | null;
  overrides?: Record<string, number> | null;
  payments?: Array<{ id: string; date: string; amount: number | string; note?: string | null; txId?: string | null }> | null;
  method?: string | null;
  dueDay?: number | null;
  /** Перенесённая дата платежа месяца: { 'YYYY-MM': 'YYYY-MM-DD' }. */
  dueDates?: Record<string, string> | null;
}

export type SalarySnapshots = Record<string, any> | null | undefined;

export interface DeductionPart { id: string; name: string; amount: number }

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Предохранитель от бесконечного цикла: 20 лет помесячно. */
const MAX_MONTHS = 240;
/** День выплаты зарплаты — в этот день удерживаем рассрочку «из зарплаты». */
export const SALARY_PAY_DAY = 10;

export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayOf(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const isSeparate = (inst: InstallmentLike): boolean => inst.method === 'separate';

/** Дата платежа за месяц ym. Из зарплаты — день выплаты (10-е следующего
 *  месяца); отдельно — перенесённая дата или своё число месяца. */
export function dueDateOf(inst: InstallmentLike, ym: string): string {
  if (!isSeparate(inst)) return `${shiftYm(ym, 1)}-${String(SALARY_PAY_DAY).padStart(2, '0')}`;
  const moved = inst.dueDates?.[ym];
  if (moved && DATE_RE.test(moved)) return moved;
  const day = Math.min(Math.max(1, Math.trunc(Number(inst.dueDay) || 1)), lastDayOf(ym));
  return `${ym}-${String(day).padStart(2, '0')}`;
}

/** Плановая сумма месяца без учёта остатка: своя сумма месяца или обычная. */
export function plannedFor(inst: InstallmentLike, ym: string): number {
  if (!YM_RE.test(inst.startYm || '') || ym < inst.startYm) return 0;
  const own = inst.overrides?.[ym];
  if (own != null && Number.isFinite(Number(own))) return Math.max(0, r2(own));
  return Math.max(0, r2(inst.monthlyAmount));
}

/** Месяц пропущен владельцем (своя сумма = 0). */
export function isSkipped(inst: InstallmentLike, ym: string): boolean {
  const own = inst.overrides?.[ym];
  return own != null && Number(own) === 0;
}

/** Удержано в выплаченном месяце; null — месяц ещё не выплачен. */
export function frozenFor(inst: InstallmentLike, snaps: SalarySnapshots, ym: string): number | null {
  const s = snaps?.[ym];
  if (!s) return null;
  return r2(Number(s.installments?.[inst.id]) || 0);
}

/** Возвращено мимо зарплаты: до CRM + платежи вручную. */
export function manualPaid(inst: InstallmentLike): number {
  const pays = (inst.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return r2((Number(inst.paidBefore) || 0) + pays);
}

/** Удержано из выплаченных зарплат за всё время (и при смене способа тоже). */
export function salaryPaid(inst: InstallmentLike, snaps: SalarySnapshots): number {
  if (!snaps) return 0;
  let sum = 0;
  for (const [ym, s] of Object.entries(snaps)) {
    if (!YM_RE.test(ym)) continue;
    sum += Number(s?.installments?.[inst.id]) || 0;
  }
  return r2(sum);
}

export interface MonthStep { ym: string; amount: number; frozen: boolean }

/** Помесячный путь удержаний из зарплаты до untilYm включительно.
 *  worked(ym) = false — сотрудника нет в ведомости этого месяца. */
export function walk(
  inst: InstallmentLike, snaps: SalarySnapshots, untilYm: string,
  worked?: (ym: string) => boolean,
): { steps: MonthStep[]; left: number } {
  let left = r2((Number(inst.totalAmount) || 0) - manualPaid(inst));
  const steps: MonthStep[] = [];
  if (!YM_RE.test(inst.startYm || '') || !YM_RE.test(untilYm || '')) return { steps, left };
  let ym = inst.startYm;
  for (let i = 0; i < MAX_MONTHS && ym <= untilYm; i++, ym = shiftYm(ym, 1)) {
    const fz = frozenFor(inst, snaps, ym);
    let amount: number;
    if (fz != null) amount = fz;
    else if (worked && !worked(ym)) amount = 0;
    else amount = Math.min(plannedFor(inst, ym), Math.max(0, left));
    amount = r2(Math.max(0, amount));
    left = r2(left - amount);
    steps.push({ ym, amount, frozen: fz != null });
  }
  return { steps, left };
}

/** Удержание по одной рассрочке за месяц (для ведомости). «Отдельно» — 0. */
export function deductionOf(
  inst: InstallmentLike, snaps: SalarySnapshots, ym: string, worked?: (ym: string) => boolean,
): number {
  if (isSeparate(inst) || ym < inst.startYm) return 0;
  const { steps } = walk(inst, snaps, ym, worked);
  return steps.length && steps[steps.length - 1].ym === ym ? steps[steps.length - 1].amount : 0;
}

/** Все удержания сотрудника из зарплаты за месяц, по рассрочкам. */
export function deductionParts(
  insts: InstallmentLike[], snaps: SalarySnapshots, ym: string, worked?: (ym: string) => boolean,
): DeductionPart[] {
  return insts
    .map(i => ({ id: i.id, name: i.name, amount: deductionOf(i, snaps, ym, worked) }))
    .filter(p => p.amount > 0);
}

/** Удержание не может быть больше, чем человеку причитается: остаток месяца
 *  (оклад + бонус − штраф − отпускные). Не хватило — урезаем по порядку,
 *  недобранное уйдёт в следующие месяцы само (остаток просто больше). */
export function capParts(parts: DeductionPart[], available: number): DeductionPart[] {
  let room = Math.max(0, r2(available));
  const out: DeductionPart[] = [];
  for (const p of parts) {
    const amount = r2(Math.min(p.amount, room));
    room = r2(room - amount);
    if (amount > 0) out.push({ ...p, amount });
  }
  return out;
}

export const sumParts = (parts: DeductionPart[]): number => r2(parts.reduce((s, p) => s + p.amount, 0));

/** Снимок удержаний месяца для salarySnapshots[ym].installments. */
export function partsToSnapshot(parts: DeductionPart[]): Record<string, number> | undefined {
  if (!parts.length) return undefined;
  return Object.fromEntries(parts.map(p => [p.id, p.amount]));
}

// ─── График с датами ─────────────────────────────────────────────

/** done — оплачено; planned — впереди; overdue — дата прошла, денег нет
 *  (только «отдельно»); waiting — дата выплаты ЗП прошла, но месяц ещё не
 *  выплачен (вина не сотрудника); skip — месяц пропущен владельцем. */
export type EntryStatus = 'done' | 'planned' | 'overdue' | 'waiting' | 'skip';

export interface ScheduleEntry {
  ym: string;
  date: string;
  amount: number;
  /** Сколько из суммы уже покрыто. */
  paid: number;
  /** Сколько ещё должны за этот месяц. */
  outstanding: number;
  status: EntryStatus;
  /** Сумма зафиксирована выплаченной зарплатой. */
  frozen: boolean;
  /** Своя сумма на месяц (не обычная). */
  custom: boolean;
}

/** Полный график от первого месяца до последнего платежа. Месяцы, где
 *  удерживать не из чего (сотрудник не в ведомости), в график не попадают. */
export function schedule(
  inst: InstallmentLike, snaps: SalarySnapshots, today: string, worked?: (ym: string) => boolean,
): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  if (!YM_RE.test(inst.startYm || '')) return out;
  const custom = (ym: string) => inst.overrides?.[ym] != null && Number(inst.overrides[ym]) > 0;

  if (!isSeparate(inst)) {
    let left = r2((Number(inst.totalAmount) || 0) - manualPaid(inst));
    let ym = inst.startYm;
    for (let i = 0; i < MAX_MONTHS; i++, ym = shiftYm(ym, 1)) {
      const fz = frozenFor(inst, snaps, ym);
      const date = dueDateOf(inst, ym);
      if (fz != null) {
        left = r2(left - fz);
        if (fz > 0) out.push({ ym, date, amount: fz, paid: fz, outstanding: 0, status: 'done', frozen: true, custom: custom(ym) });
        if (left <= 0.005) break;
        continue;
      }
      if (left <= 0.005) break;
      if (worked && !worked(ym)) {
        if (hasEnded(worked, ym)) break;
        continue;
      }
      if (isSkipped(inst, ym)) {
        out.push({ ym, date, amount: 0, paid: 0, outstanding: 0, status: 'skip', frozen: false, custom: false });
        continue;
      }
      const amount = r2(Math.min(plannedFor(inst, ym), left));
      if (!(amount > 0)) continue;
      left = r2(left - amount);
      out.push({
        ym, date, amount, paid: 0, outstanding: amount,
        status: date < today ? 'waiting' : 'planned', frozen: false, custom: custom(ym),
      });
    }
    return out;
  }

  // «Отдельно»: план по месяцам, деньги покрывают его по порядку.
  const pays = r2((inst.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  let planLeft = r2((Number(inst.totalAmount) || 0) - (Number(inst.paidBefore) || 0) - salaryPaid(inst, snaps));
  let cover = pays;
  let ym = inst.startYm;
  for (let i = 0; i < MAX_MONTHS && planLeft > 0.005; i++, ym = shiftYm(ym, 1)) {
    const date = dueDateOf(inst, ym);
    if (isSkipped(inst, ym)) {
      out.push({ ym, date, amount: 0, paid: 0, outstanding: 0, status: 'skip', frozen: false, custom: false });
      continue;
    }
    const amount = r2(Math.min(plannedFor(inst, ym), planLeft));
    if (!(amount > 0)) continue;
    planLeft = r2(planLeft - amount);
    const paid = r2(Math.min(amount, Math.max(0, cover)));
    cover = r2(cover - paid);
    const outstanding = r2(amount - paid);
    const status: EntryStatus = outstanding <= 0.005 ? 'done' : date < today ? 'overdue' : 'planned';
    out.push({ ym, date, amount, paid, outstanding: outstanding <= 0.005 ? 0 : outstanding, status, frozen: false, custom: custom(ym) });
  }
  return out;
}

export interface InstallmentSummary {
  paid: number;
  remaining: number;
  progress: number;
  /** Дата последнего платежа по плану; null — по плану не закрывается. */
  endDate: string | null;
  endYm: string | null;
  /** Сколько платежей ещё впереди (включая просроченные). */
  paymentsLeft: number;
  /** Ближайший платёж, который ещё не наступил. */
  next: { ym: string; date: string; amount: number } | null;
  /** Просрочено (только «отдельно»): сумма, число платежей, с какой даты. */
  overdue: { amount: number; count: number; since: string; ym: string } | null;
  done: boolean;
}

/** Итог по рассрочке: сколько вернули, сколько осталось, когда платить. */
export function summarize(
  inst: InstallmentLike, snaps: SalarySnapshots, worked?: (ym: string) => boolean,
  today = new Date().toISOString().slice(0, 10),
): InstallmentSummary {
  const total = r2(inst.totalAmount);
  const paid = r2(manualPaid(inst) + salaryPaid(inst, snaps));
  const remaining = r2(Math.max(0, total - paid));
  const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  if (remaining <= 0.005) {
    return { paid, remaining: 0, progress: total > 0 ? 100 : 0, endDate: null, endYm: null, paymentsLeft: 0, next: null, overdue: null, done: true };
  }
  const plan = schedule(inst, snaps, today, worked);
  const open = plan.filter(e => e.outstanding > 0);
  const late = open.filter(e => e.status === 'overdue');
  const ahead = open.find(e => e.status !== 'overdue');
  // Закрывается ли рассрочка по плану: сумма графика покрывает остаток.
  const planned = r2(open.reduce((s, e) => s + e.outstanding, 0));
  const closes = planned >= remaining - 0.005;
  const last = closes && open.length ? open[open.length - 1] : null;
  return {
    paid, remaining, progress,
    endDate: last?.date ?? null,
    endYm: last?.ym ?? null,
    paymentsLeft: open.length,
    next: ahead ? { ym: ahead.ym, date: ahead.date, amount: ahead.outstanding } : null,
    overdue: late.length
      ? { amount: r2(late.reduce((s, e) => s + e.outstanding, 0)), count: late.length, since: late[0].date, ym: late[0].ym }
      : null,
    done: false,
  };
}

/** Сотрудник ушёл насовсем: ни в этом, ни в следующие 12 месяцев его нет. */
function hasEnded(worked: (ym: string) => boolean, ym: string): boolean {
  for (let k = 0; k < 12; k++) if (worked(shiftYm(ym, k))) return false;
  return true;
}
