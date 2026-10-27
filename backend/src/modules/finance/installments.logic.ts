/** Рассрочки сотрудников: чистая арифметика без БД.
 *
 *  Способ возврата у каждой рассрочки свой (решение владельца 27.10.2026):
 *  - «из зарплаты» (salary): удержание месяца M встаёт в ведомость и
 *    удерживается в день выплаты ЗП — 10-го числа месяца M+1. Выплаченный
 *    месяц берёт сумму из снимка зарплаты (salarySnapshots[M].installments[id])
 *    — она не меняется задним числом. Владелец может отметить месяц
 *    «удержано из зарплаты» (marks) — месяц зелёный, удержание в ведомости
 *    остаётся;
 *  - «платит отдельно» (separate): сотрудник вносит деньги к своему числу.
 *
 *  Деньги, внесённые отдельно (payments), закрывают месяцы, к которым их
 *  привязали при записи (alloc), остаток — ближайшие открытые месяцы по
 *  порядку. Месяц «из зарплаты», закрытый деньгами, из зарплаты уже не
 *  удерживается — иначе сотрудник заплатил бы дважды. */

export interface InstallmentPaymentLike {
  id: string;
  date: string;
  amount: number | string;
  note?: string | null;
  txId?: string | null;
  /** За какие месяцы платёж: [{ ym, amount }]; без него — ближайшие по порядку. */
  alloc?: Array<{ ym: string; amount: number | string }> | null;
}

export interface InstallmentLike {
  id: string;
  name: string;
  totalAmount: number | string;
  monthlyAmount: number | string;
  startYm: string;
  paidBefore?: number | string | null;
  overrides?: Record<string, number> | null;
  payments?: InstallmentPaymentLike[] | null;
  method?: string | null;
  dueDay?: number | null;
  /** Перенесённая дата платежа месяца: { 'YYYY-MM': 'YYYY-MM-DD' }. */
  dueDates?: Record<string, string> | null;
  /** «Удержано из зарплаты» отмечено вручную: { 'YYYY-MM': { date } }. */
  marks?: Record<string, { date?: string | null }> | null;
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
/** Для расчёта удержания дата «сегодня» не нужна — статусы не используются. */
const FAR_FUTURE = '9999-12-31';

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

/** Возвращено мимо зарплаты: до CRM + платежи деньгами. */
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

// ─── График с датами ─────────────────────────────────────────────

/** done — оплачено; planned — впереди; overdue — дата прошла, денег нет
 *  (только «отдельно»); waiting — дата выплаты ЗП прошла, но месяц ещё не
 *  выплачен (вина не сотрудника); skip — месяц пропущен владельцем. */
export type EntryStatus = 'done' | 'planned' | 'overdue' | 'waiting' | 'skip';

export interface ScheduleEntry {
  ym: string;
  date: string;
  amount: number;
  /** Сколько из суммы уже закрыто (деньгами, зарплатой или отметкой). */
  paid: number;
  /** Сколько ещё должны за этот месяц. */
  outstanding: number;
  status: EntryStatus;
  /** Месяц удержан выплаченной зарплатой — сумма зафиксирована. */
  frozen: boolean;
  /** Своя сумма на месяц (не обычная). */
  custom: boolean;
  /** Закрыто деньгами, внесёнными отдельно. */
  cash: number;
  /** Удержано из зарплаты: выплаченной (frozen) или отмеченное вручную. */
  withheld: number;
  /** Отмечено «удержано из зарплаты» вручную (зарплата ещё не выплачена). */
  marked: boolean;
  /** Какие платежи закрыли месяц. */
  paymentIds: string[];
  /** Когда закрыт: дата последнего платежа или отметки. */
  paidAt: string | null;
}

/** Полный график: месяцы, их даты и чем каждый закрыт. Один проход по
 *  месяцам: сначала деньги, привязанные к месяцу, потом отметка «удержано»,
 *  потом свободные деньги (старые платежи без привязки и лишнее) — в
 *  ближайший открытый месяц. Выплаченный месяц стоит удержанное + внесённое
 *  деньгами. Месяцы, где удерживать не из чего (сотрудник не в ведомости),
 *  в график не попадают. */
export function schedule(
  inst: InstallmentLike, snaps: SalarySnapshots, today: string, worked?: (ym: string) => boolean,
): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  if (!YM_RE.test(inst.startYm || '')) return out;
  const salary = !isSeparate(inst);

  type Cash = { id: string; date: string; left: number };
  const allocs = new Map<string, Cash[]>();
  const pool: Cash[] = [];
  const payments = (inst.payments || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const p of payments) {
    let rest = r2(p.amount);
    for (const a of p.alloc || []) {
      const amount = r2(Math.min(Number(a.amount) || 0, rest));
      if (!YM_RE.test(a.ym) || amount <= 0) continue;
      allocs.set(a.ym, [...(allocs.get(a.ym) || []), { id: p.id, date: p.date, left: amount }]);
      rest = r2(rest - amount);
    }
    if (rest > 0.005) pool.push({ id: p.id, date: p.date, left: rest });
  }
  // Месяц выпал из графика — его деньги становятся свободными.
  const release = (ym: string) => { for (const c of allocs.get(ym) || []) if (c.left > 0.005) pool.push(c); };
  const take = (e: ScheduleEntry, c: Cash, room: number): number => {
    const amount = r2(Math.min(room, c.left));
    if (amount <= 0) return 0;
    c.left = r2(c.left - amount);
    e.cash = r2(e.cash + amount);
    if (!e.paymentIds.includes(c.id)) e.paymentIds.push(c.id);
    if (!e.paidAt || c.date > e.paidAt) e.paidAt = c.date;
    return amount;
  };

  // «Отдельно» после смены способа: удержанное раньше из зарплаты уже
  // вернуло часть суммы.
  let planLeft = r2((Number(inst.totalAmount) || 0) - (Number(inst.paidBefore) || 0) - (salary ? 0 : salaryPaid(inst, snaps)));
  let ym = inst.startYm;
  for (let i = 0; i < MAX_MONTHS && planLeft > 0.005; i++, ym = shiftYm(ym, 1)) {
    const date = dueDateOf(inst, ym);
    const fz = salary ? frozenFor(inst, snaps, ym) : null;
    if (fz == null) {
      if (salary && worked && !worked(ym)) {
        release(ym);
        if (hasEnded(worked, ym)) break;
        continue;
      }
      if (isSkipped(inst, ym)) {
        release(ym);
        out.push({
          ym, date, amount: 0, paid: 0, outstanding: 0, status: 'skip', frozen: false, custom: false,
          cash: 0, withheld: 0, marked: false, paymentIds: [], paidAt: null,
        });
        continue;
      }
    }
    const target = r2(Math.min(plannedFor(inst, ym), planLeft));
    const e: ScheduleEntry = {
      ym, date, amount: 0, paid: 0, outstanding: 0, status: 'planned', frozen: fz != null,
      custom: inst.overrides?.[ym] != null && Number(inst.overrides[ym]) > 0,
      cash: 0, withheld: fz ?? 0, marked: false, paymentIds: [], paidAt: null,
    };
    let room = r2(Math.max(0, target - (fz ?? 0)));
    for (const c of allocs.get(ym) || []) {
      room = r2(room - take(e, c, room));
      if (c.left > 0.005) pool.push(c);
    }
    const mark = salary && fz == null ? inst.marks?.[ym] : null;
    if (mark && room > 0.005) {
      e.marked = true;
      e.withheld = room;
      e.paidAt = e.paidAt || mark.date || null;
      room = 0;
    }
    for (const c of pool) {
      if (room <= 0.005) break;
      room = r2(room - take(e, c, room));
    }
    e.amount = fz != null ? r2(fz + e.cash) : target;
    if (!(e.amount > 0)) continue;
    planLeft = r2(planLeft - e.amount);
    out.push(e);
  }
  // Деньги, привязанные к месяцам, которых в графике больше нет (сумму месяцев
  // подняли и рассрочка кончилась раньше), — в ближайшие открытые месяцы.
  const spare = new Set<Cash>(pool);
  for (const list of allocs.values()) for (const c of list) spare.add(c);
  for (const e of out) {
    if (e.status === 'skip') continue;
    if (!e.frozen && !e.marked) {
      let room = r2(e.amount - e.cash);
      for (const c of spare) {
        if (room <= 0.005) break;
        room = r2(room - take(e, c, room));
      }
    }
    e.paid = r2(Math.min(e.amount, e.withheld + e.cash));
    const left = r2(e.amount - e.paid);
    e.outstanding = left > 0.005 ? left : 0;
    e.status = e.outstanding === 0 ? 'done'
      : e.date < today ? (salary ? 'waiting' : 'overdue')
      : 'planned';
  }
  return out;
}

/** Удержание по одной рассрочке из зарплаты за месяц: сумма месяца минус то,
 *  что внесли деньгами. Отметка «удержано» удержание не отменяет. */
export function deductionOf(
  inst: InstallmentLike, snaps: SalarySnapshots, ym: string, worked?: (ym: string) => boolean,
): number {
  if (isSeparate(inst) || ym < inst.startYm) return 0;
  const e = schedule(inst, snaps, FAR_FUTURE, worked).find(x => x.ym === ym && x.status !== 'skip');
  if (!e) return 0;
  return e.frozen ? r2(e.withheld) : r2(Math.max(0, e.amount - e.cash));
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

/** Платёж деньгами → за какие месяцы: сначала выбранный, потом ближайшие
 *  открытые по порядку. Что не легло в график — без привязки. */
export function allocatePayment(
  inst: InstallmentLike, snaps: SalarySnapshots, amount: number, today: string,
  worked?: (ym: string) => boolean, preferYm?: string | null,
): Array<{ ym: string; amount: number }> {
  const open = schedule(inst, snaps, today, worked).filter(e => e.outstanding > 0 && !e.frozen && !e.marked);
  const ordered = preferYm
    ? [...open.filter(e => e.ym === preferYm), ...open.filter(e => e.ym !== preferYm)]
    : open;
  const out: Array<{ ym: string; amount: number }> = [];
  let left = r2(amount);
  for (const e of ordered) {
    if (left <= 0.005) break;
    const take = r2(Math.min(left, e.outstanding));
    if (take > 0) { out.push({ ym: e.ym, amount: take }); left = r2(left - take); }
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
  /** Ближайший платёж, который ещё не просрочен. */
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
  const plan = schedule(inst, snaps, today, worked);
  // Отметки «удержано» — тоже возвращённые деньги, пока зарплату не выплатили
  // (потом сумма берётся из снимка, отметка больше не считается).
  const markPaid = plan.filter(e => e.marked).reduce((s, e) => s + e.withheld, 0);
  const paid = r2(manualPaid(inst) + salaryPaid(inst, snaps) + markPaid);
  const remaining = r2(Math.max(0, total - paid));
  const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  if (remaining <= 0.005) {
    return { paid, remaining: 0, progress: total > 0 ? 100 : 0, endDate: null, endYm: null, paymentsLeft: 0, next: null, overdue: null, done: true };
  }
  const open = plan.filter(e => e.outstanding > 0);
  const late = open.filter(e => e.status === 'overdue');
  const ahead = open.find(e => e.status !== 'overdue');
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
