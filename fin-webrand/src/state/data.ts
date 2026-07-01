import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db/db';
import type { Transaction, PlannedPayment } from '../db/types';
import { currentYm, shiftYm } from '../lib/format';
import { CAT } from '../lib/constants';

const incomeCat = (group?: string) =>
  group === 'development' ? CAT.development : group === 'design' ? CAT.design : CAT.smm;

// Живые запросы: любая запись в БД автоматически обновляет UI и сводки.

export const useAccounts = () => useLiveQuery(() => db.accounts.orderBy('order').toArray(), [], []);
export const useCategories = () => useLiveQuery(() => db.categories.orderBy('order').toArray(), [], []);
export const useTransactions = () =>
  useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [], []);
export const useClients = () => useLiveQuery(() => db.clients.toArray(), [], []);
export const usePlannedPayments = () => useLiveQuery(() => db.plannedPayments.toArray(), [], []);
export const useEmployees = () => useLiveQuery(() => db.employees.toArray(), [], []);
export const useSubscriptions = () => useLiveQuery(() => db.subscriptions.toArray(), [], []);
export const useDebts = () => useLiveQuery(() => db.debts.toArray(), [], []);

export async function addTransaction(t: Omit<Transaction, 'id' | 'createdAt'>): Promise<string> {
  const id = uid();
  await db.transactions.add({ ...t, id, createdAt: new Date().toISOString() });
  await syncSmmPartLink(id);
  return id;
}

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
  await db.transactions.update(id, patch);
  await syncSmmPartLink(id);
}

/** Синхронизирует авто-плановую оплату SMM (часть 1/2) с операцией из журнала,
 *  чтобы она отображалась в таблице SMM. Категории cat-smm-part1 / cat-smm-part2 + проект. */
async function syncSmmPartLink(txId: string): Promise<void> {
  const tx = await db.transactions.get(txId);
  const existing = (await db.plannedPayments.filter((p) => p.auto === true && p.receivedTxId === txId).toArray())[0];
  const partNo: 1 | 2 | null = tx?.categoryId === 'cat-smm-part2' ? 2 : tx?.categoryId === 'cat-smm-part1' ? 1 : null;
  const shouldExist = !!(tx && tx.type === 'income' && tx.clientId && partNo);

  if (shouldExist && tx && partNo) {
    const data = { clientId: tx.clientId, ym: tx.date.slice(0, 7), partNo, amount: tx.amount, status: 'received' as const, receivedTxId: txId, auto: true };
    if (existing) await db.plannedPayments.update(existing.id, data);
    else await db.plannedPayments.add({ id: uid(), ...data });
  } else if (existing) {
    await db.plannedPayments.delete(existing.id);
  }
}

/** Отменить оплату подписки/аренды за месяц: удалить её расходы за этот ym. */
export async function cancelSubscriptionMonth(subscriptionId: string, ym: string): Promise<void> {
  const all = await db.transactions.toArray();
  for (const t of all) if (t.subscriptionId === subscriptionId && t.date.slice(0, 7) === ym) await deleteTransaction(t.id);
}

/** Отменить выплату ЗП сотруднику за месяц: удалить его зарплатные расходы за этот ym. */
export async function cancelSalaryMonth(employeeId: string, ym: string): Promise<void> {
  const all = await db.transactions.toArray();
  for (const t of all) if (t.employeeId === employeeId && t.group === 'salary' && t.date.slice(0, 7) === ym) await deleteTransaction(t.id);
}

/** Отменить оплату по проекту: удалить все его доходные операции (с откатом планов). */
export async function deleteClientIncome(clientId: string): Promise<void> {
  const txs = await db.transactions.where('clientId').equals(clientId).toArray();
  for (const t of txs) if (t.type === 'income') await deleteTransaction(t.id);
}

/** Архивировать проект — больше с ним не работаем. Уходит из активных таблиц, данные сохраняются. */
export async function archiveClient(clientId: string): Promise<void> {
  await db.clients.update(clientId, { status: 'archived' });
}

/** Вернуть проект из архива в активные. */
export async function unarchiveClient(clientId: string): Promise<void> {
  await db.clients.update(clientId, { status: 'active' });
}

/** Удалить проект целиком: клиент + его плановые оплаты + доходные операции. */
export async function deleteClient(clientId: string): Promise<void> {
  await deleteClientIncome(clientId);
  const plans = await db.plannedPayments.where('clientId').equals(clientId).toArray();
  await db.transaction('rw', [db.clients, db.plannedPayments], async () => {
    for (const p of plans) await db.plannedPayments.delete(p.id);
    await db.clients.delete(clientId);
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  // если транзакция была получением плановой оплаты — вернуть её в «ожидается»
  // (receivedTxId не проиндексирован — используем filter, не where)
  const linked = await db.plannedPayments.filter((p) => p.receivedTxId === id).toArray();
  await db.transaction('rw', [db.transactions, db.plannedPayments], async () => {
    for (const p of linked) {
      if (p.auto) await db.plannedPayments.delete(p.id); // авто-связь из журнала — удаляем
      else await db.plannedPayments.update(p.id, { status: 'expected', receivedTxId: undefined });
    }
    await db.transactions.delete(id);
  });
}

/** Запланировать ожидаемую оплату (expected) на месяц — для графика поступлений. */
export async function addPlannedPayment(clientId: string, ym: string, partNo: 1 | 2, amount: number): Promise<void> {
  await db.plannedPayments.add({ id: uid(), clientId, ym, partNo, amount, status: 'expected' });
}

// ---------- Долги: график погашения по месяцам ----------

/** Запланировать платёж по долгу на месяц (expected). */
export async function addDebtPlan(debtId: string, ym: string, amount: number): Promise<void> {
  await db.plannedPayments.add({ id: uid(), debtId, ym, partNo: 1, amount, status: 'expected' });
}

/** Авто-распределить остаток долга по месяцам (платёж/мес), начиная с текущего месяца.
 *  Уже оплаченные платежи сохраняются; перегенерируются только ожидаемые. */
export async function regenerateDebtSchedule(debtId: string): Promise<void> {
  const debt = await db.debts.get(debtId);
  if (!debt) return;
  const monthly = debt.monthlyPayment ?? 0;
  const plans = await db.plannedPayments.filter((p) => p.debtId === debtId).toArray();
  // удалить старые ожидаемые, оставить оплаченные
  for (const p of plans.filter((p) => p.status === 'expected')) await db.plannedPayments.delete(p.id);
  if (monthly <= 0) return; // без платежа/мес график не строим

  const received = plans.filter((p) => p.status === 'received');
  const receivedSum = received.reduce((s, p) => s + p.amount, 0);
  const receivedMonths = new Set(received.map((p) => p.ym));
  let remaining = Math.max(0, debt.totalAmount - debt.paidBefore - receivedSum);

  const newPlans: PlannedPayment[] = [];
  let ym = currentYm();
  let guard = 0;
  while (remaining > 0 && guard < 240) {
    guard++;
    if (!receivedMonths.has(ym)) {
      const amount = Math.min(monthly, remaining);
      newPlans.push({ id: uid(), debtId, ym, partNo: 1, amount, status: 'expected' });
      remaining -= amount;
    }
    ym = shiftYm(ym, 1);
  }
  if (newPlans.length) await db.plannedPayments.bulkAdd(newPlans);
}

/** Записать погашение долга сразу: сумма + дата + счёт → расход и оплата (received). */
export async function addPaidDebt(debtId: string, ym: string, amount: number, accountId: string, date: string): Promise<void> {
  await db.transaction('rw', [db.transactions, db.plannedPayments, db.debts], async () => {
    const debt = await db.debts.get(debtId);
    const txId = uid();
    const ppId = uid();
    await db.transactions.add({
      id: txId, date, type: 'expense', amount, group: 'debts', categoryId: CAT.debt, accountFrom: accountId,
      debtId, comment: `Погашение: ${debt?.name ?? ''}`, createdAt: new Date().toISOString(),
    });
    await db.plannedPayments.add({ id: ppId, debtId, ym, partNo: 1, amount, status: 'received', receivedTxId: txId });
  });
}

/** Отметить плановый платёж по долгу погашённым: создать расход + связать. */
export async function payDebtPlanned(p: PlannedPayment, accountId: string, date: string): Promise<void> {
  await db.transaction('rw', [db.transactions, db.plannedPayments, db.debts], async () => {
    const debt = p.debtId ? await db.debts.get(p.debtId) : undefined;
    const id = uid();
    await db.transactions.add({
      id, date, type: 'expense', amount: p.amount, group: 'debts', categoryId: CAT.debt, accountFrom: accountId,
      debtId: p.debtId, comment: `Погашение: ${debt?.name ?? ''}`, createdAt: new Date().toISOString(),
    });
    await db.plannedPayments.update(p.id, { status: 'received', receivedTxId: id });
  });
}

/** Записать оплату сразу: сумма + дата + счёт → доход и оплата (received). Направление берётся от проекта. */
export async function addReceivedPart(
  clientId: string, ym: string, partNo: 1 | 2, amount: number, accountId: string, date: string,
): Promise<void> {
  await db.transaction('rw', [db.transactions, db.plannedPayments, db.clients], async () => {
    const client = await db.clients.get(clientId);
    const txId = uid();
    const ppId = uid();
    await db.transactions.add({
      id: txId, date, type: 'income', amount, group: client?.group ?? 'smm', categoryId: incomeCat(client?.group), accountTo: accountId,
      clientId, plannedPaymentId: ppId, comment: `Оплата проекта, часть ${partNo}`,
      createdAt: new Date().toISOString(),
    });
    await db.plannedPayments.add({ id: ppId, clientId, ym, partNo, amount, status: 'received', receivedTxId: txId });
  });
}

/** Отметить плановую оплату полученной: создать доход + связать. Направление берётся от проекта. */
export async function receivePlanned(p: PlannedPayment, accountId: string, date: string): Promise<void> {
  await db.transaction('rw', [db.transactions, db.plannedPayments, db.clients], async () => {
    const client = p.clientId ? await db.clients.get(p.clientId) : undefined;
    const id = uid();
    await db.transactions.add({
      id, date, type: 'income', amount: p.amount, group: client?.group ?? 'smm', categoryId: incomeCat(client?.group), accountTo: accountId,
      clientId: p.clientId, plannedPaymentId: p.id, comment: `Оплата проекта, часть ${p.partNo}`,
      createdAt: new Date().toISOString(),
    });
    await db.plannedPayments.update(p.id, { status: 'received', receivedTxId: id });
  });
}

/** Полностью убрать оплату: удалить операцию (если была) и сам платёж — ячейка снова станет «+». */
export async function removePayment(p: PlannedPayment): Promise<void> {
  await db.transaction('rw', [db.transactions, db.plannedPayments], async () => {
    if (p.receivedTxId) await db.transactions.delete(p.receivedTxId);
    await db.plannedPayments.delete(p.id);
  });
}

/** Отменить получение плановой оплаты (вернуть в «ожидается», план сохранить). */
export async function unreceivePlanned(p: PlannedPayment): Promise<void> {
  await db.transaction('rw', [db.transactions, db.plannedPayments], async () => {
    if (p.receivedTxId) await db.transactions.delete(p.receivedTxId);
    await db.plannedPayments.update(p.id, { status: 'expected', receivedTxId: undefined });
  });
}
