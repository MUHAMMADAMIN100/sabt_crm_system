import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Category,
  Transaction,
  Client,
  PlannedPayment,
  Employee,
  Subscription,
  Debt,
  Meta,
} from './types';

// Слой доступа к данным изолирован здесь. Сейчас — IndexedDB (локально, приватно).
// При деплое меняется только реализация (на Supabase/Postgres), UI и расчёты — без изменений.

export class FinDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  clients!: Table<Client, string>;
  plannedPayments!: Table<PlannedPayment, string>;
  employees!: Table<Employee, string>;
  subscriptions!: Table<Subscription, string>;
  debts!: Table<Debt, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('fin_web_system');
    this.version(1).stores({
      accounts: 'id, order',
      transactions: 'id, date, type, group, accountFrom, accountTo, clientId, employeeId, debtId',
      clients: 'id, group, status',
      plannedPayments: 'id, clientId, ym, status',
      employees: 'id, status',
      subscriptions: 'id, kind, active',
      debts: 'id',
      meta: 'key',
    });
    this.version(2).stores({
      categories: 'id, kind, order',
      transactions: 'id, date, type, group, categoryId, accountFrom, accountTo, clientId, employeeId, debtId',
    });
  }
}

export const db = new FinDB();

export const uid = (): string =>
  'id-' + Math.random().toString(36).slice(2, 10) + (globalThis.crypto?.randomUUID?.().slice(0, 6) ?? '');
