import { db } from './db';
import { DEFAULT_CATEGORIES } from '../lib/constants';
import {
  INITIAL_ACCOUNTS, INITIAL_CLIENTS, INITIAL_EMPLOYEES,
  INITIAL_SUBSCRIPTIONS, INITIAL_DEBTS, INITIAL_PLANNED_PAYMENTS,
} from './initialData';

// Сид при первом запуске: таксономия категорий (17) + начальные данные агентства
// WebRand — счета, проекты/клиенты, сотрудники, аренда/подписки, долги и плановые
// оплаты (см. initialData.ts). Журнал операций (transactions) остаётся пустым —
// доходы/расходы добавляются вручную или импортом JSON (Настройки → Импорт JSON).

let seedPromise: Promise<void> | null = null;
export function seedIfEmpty(): Promise<void> {
  if (!seedPromise) seedPromise = runSeed();
  return seedPromise;
}

async function runSeed(): Promise<void> {
  if (await db.meta.get('seeded')) return;

  await db.transaction(
    'rw',
    [db.categories, db.accounts, db.clients, db.employees, db.subscriptions, db.debts, db.plannedPayments, db.meta],
    async () => {
      await db.categories.bulkAdd(DEFAULT_CATEGORIES);
      await db.accounts.bulkAdd(INITIAL_ACCOUNTS);
      await db.clients.bulkAdd(INITIAL_CLIENTS);
      await db.employees.bulkAdd(INITIAL_EMPLOYEES);
      await db.subscriptions.bulkAdd(INITIAL_SUBSCRIPTIONS);
      await db.debts.bulkAdd(INITIAL_DEBTS);
      await db.plannedPayments.bulkAdd(INITIAL_PLANNED_PAYMENTS);
      await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
    },
  );
}
