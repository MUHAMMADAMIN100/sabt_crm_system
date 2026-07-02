// ВСЕ производные показатели считаются здесь из журнала транзакций.

import type {
  Account,
  Transaction,
  Client,
  PlannedPayment,
  Debt,
  Group,
} from '../db/types';
import { ymOf, contractDay, dueDateForMonth, shiftYm } from './format';

/** Влияние транзакции на счёт: +приход / −расход. */
export function effectOnAccount(t: Transaction, accountId: string): number {
  let v = 0;
  if (t.accountTo === accountId) v += t.amount;
  if (t.accountFrom === accountId) v -= t.amount;
  return v;
}

export function accountBalance(acc: Account, txns: Transaction[]): number {
  return txns.reduce((s, t) => s + effectOnAccount(t, acc.id), acc.openingBalance);
}

export function totalBalance(accounts: Account[], txns: Transaction[]): number {
  return accounts.reduce((s, a) => s + accountBalance(a, txns), 0);
}

/** Транзакции выбранного месяца (yyyy-mm). */
export function monthTxns(txns: Transaction[], ym: string): Transaction[] {
  return txns.filter((t) => ymOf(t.date) === ym);
}

export function sumByType(txns: Transaction[], type: 'income' | 'expense'): number {
  return txns.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
}

/** Сумма по направлению/части (group) за переданный набор транзакций. */
export function sumByGroup(txns: Transaction[], group: Group): number {
  return txns.filter((t) => t.group === group).reduce((s, t) => s + t.amount, 0);
}

export interface GroupTotal {
  group: Group;
  total: number;
}

export function incomeByGroup(txns: Transaction[]): GroupTotal[] {
  return (['smm', 'development', 'design'] as Group[]).map((group) => ({ group, total: sumByGroup(txns, group) }));
}

export function expenseByGroup(txns: Transaction[]): GroupTotal[] {
  return (['salary', 'rent_subs', 'debts'] as Group[]).map((group) => ({ group, total: sumByGroup(txns, group) }));
}

/** Получено за месяц по направлению — по плановым оплатам со статусом received
 *  (учитывает и оплаты без операции в журнале). */
export function receivedMonthByGroup(planned: PlannedPayment[], clients: Client[], group: Group, ym: string): number {
  const ids = new Set(clients.filter((c) => c.group === group && c.status !== 'archived').map((c) => c.id));
  return planned
    .filter((p) => p.ym === ym && p.clientId && ids.has(p.clientId) && p.status === 'received')
    .reduce((s, p) => s + p.amount, 0);
}

/** Получено на счёт за месяц по направлению — только оплаты с реальной операцией (без «освоено вне счёта»). */
export function cashReceivedMonthByGroup(planned: PlannedPayment[], clients: Client[], group: Group, ym: string): number {
  const ids = new Set(clients.filter((c) => c.group === group && c.status !== 'archived').map((c) => c.id));
  return planned
    .filter((p) => p.ym === ym && p.clientId && ids.has(p.clientId) && p.status === 'received' && p.receivedTxId)
    .reduce((s, p) => s + p.amount, 0);
}

export interface CatTotal {
  categoryId: string | undefined;
  total: number;
}

/** Разбивка по гибким категориям (для дашборда), по типу операции. */
export function byCategory(txns: Transaction[], type: 'income' | 'expense'): CatTotal[] {
  const map = new Map<string | undefined, number>();
  for (const t of txns) if (t.type === type) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
  return [...map.entries()]
    .map(([categoryId, total]) => ({ categoryId, total }))
    .sort((a, b) => b.total - a.total);
}

// ---------- Месячная динамика (для переключателя и графиков) ----------

export interface MonthRow {
  ym: string;
  income: number;
  expense: number;
  profit: number;
}

export function monthlySeries(txns: Transaction[]): MonthRow[] {
  const map = new Map<string, { income: number; expense: number }>();
  for (const t of txns) {
    if (t.type === 'transfer') continue;
    const ym = ymOf(t.date);
    const cur = map.get(ym) ?? { income: 0, expense: 0 };
    if (t.type === 'income') cur.income += t.amount;
    else cur.expense += t.amount;
    map.set(ym, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => ({ ym, income: v.income, expense: v.expense, profit: v.income - v.expense }));
}

// ---------- SMM: план оплат / дебиторка ----------

/** Оплачено по проекту = сумма доходных транзакций клиента. */
export function clientPaid(clientId: string, txns: Transaction[]): number {
  return txns.filter((t) => t.clientId === clientId && t.type === 'income').reduce((s, t) => s + t.amount, 0);
}

export interface SmmMonthRow {
  client: Client;
  payments: PlannedPayment[]; // плановые оплаты этого месяца (part 1 / part 2)
  received: number;
  fullyPaid: boolean;
}

/** Сводка SMM за месяц: проекты, их части оплат и статус полной оплаты. */
export function smmMonth(clients: Client[], planned: PlannedPayment[], ym: string): SmmMonthRow[] {
  return clients
    .filter((c) => c.group === 'smm')
    .map((client) => {
      const payments = planned
        .filter((p) => p.clientId === client.id && p.ym === ym)
        .sort((a, b) => a.partNo - b.partNo);
      const received = payments.filter((p) => p.status === 'received').reduce((s, p) => s + p.amount, 0);
      return { client, payments, received, fullyPaid: client.tariff > 0 && received >= client.tariff };
    });
}

/** Ожидается ко взысканию (expected) по всем плановым оплатам. */
export function totalExpected(planned: PlannedPayment[]): number {
  return planned.filter((p) => p.status === 'expected').reduce((s, p) => s + p.amount, 0);
}

/** Напоминание по циклу оплаты SMM-проекта (привязка ко дню контракта).
 *  Цикл: день 0 — Часть 1; день 24 — остаток (Часть 2); ~день 30 — новый цикл.
 *  Возвращает 'оплату' (пора получить оплату), 'остаток' (пора получить вторую часть) или null. */
export function smmPaymentAlert(client: Client, planned: PlannedPayment[], today: string): 'оплату' | 'остаток' | null {
  const day = contractDay(client.contractDate);
  if (day === null || client.tariff <= 0 || !client.contractDate) return null;
  // anchor = последний «день контракта», который уже наступил (начало текущего цикла)
  const todayYm = ymOf(today);
  let anchor = dueDateForMonth(todayYm, day);
  if (anchor > today) anchor = dueDateForMonth(shiftYm(todayYm, -1), day);
  if (anchor < client.contractDate) return null; // цикл ещё не начался
  const anchorYm = ymOf(anchor);
  const recv = planned
    .filter((p) => p.clientId === client.id && p.ym === anchorYm && p.status === 'received')
    .reduce((s, p) => s + p.amount, 0);
  if (recv >= client.tariff) return null; // за цикл уже оплачено полностью
  if (recv <= 0) return 'оплату'; // ничего не получено, день оплаты настал
  const daysIn = Math.floor((new Date(today).getTime() - new Date(anchor).getTime()) / 86_400_000);
  return daysIn >= 24 ? 'остаток' : null; // оплачена половина: остаток после 24-го дня
}

// ---------- Долги ----------

export function debtRemaining(d: Debt, txns: Transaction[]): number {
  const repaid = txns.filter((t) => t.debtId === d.id).reduce((s, t) => s + t.amount, 0);
  return Math.max(0, d.totalAmount - d.paidBefore - repaid);
}
