/** Рассрочки сотрудников: чистая арифметика без БД.
 *
 *  Удержание месяца M — это min(план месяца, остаток). Остаток считается
 *  от полной суммы минус «возвращено до CRM», минус платежи мимо зарплаты,
 *  минус удержания предыдущих месяцев. Выплаченный месяц берёт сумму из
 *  снимка зарплаты (salarySnapshots[M].installments[id]) — он не меняется,
 *  что бы потом ни поправили в рассрочке. */

export interface InstallmentLike {
  id: string;
  name: string;
  totalAmount: number | string;
  monthlyAmount: number | string;
  startYm: string;
  paidBefore?: number | string | null;
  overrides?: Record<string, number> | null;
  payments?: Array<{ id: string; date: string; amount: number | string; note?: string | null; txId?: string | null }> | null;
}

export type SalarySnapshots = Record<string, any> | null | undefined;

export interface DeductionPart { id: string; name: string; amount: number }

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Предохранитель от бесконечного цикла: 20 лет помесячно. */
const MAX_MONTHS = 240;

export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Плановое удержание месяца без учёта остатка: своя сумма месяца или обычная. */
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

/** Удержано из выплаченных зарплат за всё время. */
export function salaryPaid(inst: InstallmentLike, snaps: SalarySnapshots): number {
  if (!snaps) return 0;
  let sum = 0;
  for (const [ym, s] of Object.entries(snaps)) {
    if (!YM_RE.test(ym) || ym < inst.startYm) continue;
    sum += Number(s?.installments?.[inst.id]) || 0;
  }
  return r2(sum);
}

export interface MonthStep { ym: string; amount: number; frozen: boolean }

/** Помесячный путь рассрочки от первого месяца до untilYm включительно.
 *  worked(ym) = false — сотрудника нет в ведомости этого месяца, удерживать
 *  не из чего (уволен, ещё не принят). */
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

/** Удержание по одной рассрочке за месяц (для ведомости). */
export function deductionOf(
  inst: InstallmentLike, snaps: SalarySnapshots, ym: string, worked?: (ym: string) => boolean,
): number {
  if (ym < inst.startYm) return 0;
  const { steps } = walk(inst, snaps, ym, worked);
  return steps.length && steps[steps.length - 1].ym === ym ? steps[steps.length - 1].amount : 0;
}

/** Все удержания сотрудника за месяц, по рассрочкам. */
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

export interface InstallmentSummary {
  paid: number;
  remaining: number;
  progress: number;
  /** Месяц последнего удержания по плану; null — по плану не закрывается. */
  endYm: string | null;
  /** Сколько ещё удержаний впереди (не считая выплаченных месяцев). */
  paymentsLeft: number;
  next: { ym: string; amount: number } | null;
  done: boolean;
}

/** Итог по рассрочке: сколько вернули, сколько осталось, до какого месяца. */
export function summarize(
  inst: InstallmentLike, snaps: SalarySnapshots, worked?: (ym: string) => boolean,
): InstallmentSummary {
  const total = r2(inst.totalAmount);
  const paid = r2(manualPaid(inst) + salaryPaid(inst, snaps));
  const remaining = r2(Math.max(0, total - paid));
  const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  if (remaining <= 0.005) {
    return { paid, remaining: 0, progress: total > 0 ? 100 : 0, endYm: null, paymentsLeft: 0, next: null, done: true };
  }
  // Будущее считаем по плану: прошлые невыплаченные месяцы тоже впереди
  // (зарплату за них ещё выдадут), уволенным — не удерживаем.
  let left = r2(total - manualPaid(inst));
  let endYm: string | null = null;
  let next: { ym: string; amount: number } | null = null;
  let paymentsLeft = 0;
  let ym = inst.startYm;
  if (!YM_RE.test(ym || '')) return { paid, remaining, progress, endYm: null, paymentsLeft: 0, next: null, done: false };
  for (let i = 0; i < MAX_MONTHS && left > 0.005; i++, ym = shiftYm(ym, 1)) {
    const fz = frozenFor(inst, snaps, ym);
    let amount: number;
    if (fz != null) amount = fz;
    else if (worked && !worked(ym) && hasEnded(worked, ym)) break;
    else if (worked && !worked(ym)) amount = 0;
    else amount = Math.min(plannedFor(inst, ym), Math.max(0, left));
    amount = r2(Math.max(0, amount));
    left = r2(left - amount);
    if (fz == null && amount > 0) {
      paymentsLeft++;
      if (!next) next = { ym, amount };
      endYm = ym;
    }
  }
  return { paid, remaining, progress, endYm: left <= 0.005 ? endYm : null, paymentsLeft, next, done: false };
}

/** Сотрудник ушёл насовсем: ни в этом, ни в следующие 12 месяцев его нет. */
function hasEnded(worked: (ym: string) => boolean, ym: string): boolean {
  for (let k = 0; k < 12; k++) if (worked(shiftYm(ym, k))) return false;
  return true;
}
