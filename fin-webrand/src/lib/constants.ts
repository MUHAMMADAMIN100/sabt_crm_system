import type { IncomeGroup, ExpenseGroup, Group } from '../db/types';

// Фиксированная таксономия со схемы: 3 направления дохода, 3 части расхода.

export interface GroupMeta {
  key: Group;
  label: string;
  icon: string;
  color: string;
}

export const INCOME_GROUPS: GroupMeta[] = [
  { key: 'smm', label: 'SMM', icon: 'smm', color: '#16a34a' },
  { key: 'development', label: 'Development', icon: 'development', color: '#0ea5e9' },
  { key: 'design', label: 'Design', icon: 'design', color: '#a855f7' },
];

export const EXPENSE_GROUPS: GroupMeta[] = [
  { key: 'salary', label: 'Зарплата', icon: 'salary', color: '#f97316' },
  { key: 'rent_subs', label: 'Аренда и подписки', icon: 'building', color: '#e11d48' },
  { key: 'debts', label: 'Долги', icon: 'receipt', color: '#d97706' },
];

export const ALL_GROUPS = [...INCOME_GROUPS, ...EXPENSE_GROUPS];

export const groupMeta = (g: Group | undefined): GroupMeta | undefined =>
  ALL_GROUPS.find((x) => x.key === g);

export const isIncomeGroup = (g: Group): g is IncomeGroup =>
  g === 'smm' || g === 'development' || g === 'design';

export const isExpenseGroup = (g: Group): g is ExpenseGroup =>
  g === 'salary' || g === 'rent_subs' || g === 'debts';

import type { Category, TxType } from '../db/types';

// ---------- Гибкие категории (как в Notion) ----------

/** Стабильные id категорий — на них ссылаются детальные таблицы при создании операций. */
export const CAT = {
  smm: 'cat-smm',
  smmPart1: 'cat-smm-part1',
  smmPart2: 'cat-smm-part2',
  development: 'cat-development',
  design: 'cat-design',
  salary: 'cat-salary',
  rent: 'cat-rent',
  subscription: 'cat-subscription',
  debt: 'cat-debt',
} as const;

export const DEFAULT_CATEGORIES: Category[] = [
  // доход
  { id: 'cat-smm', name: 'SMM', kind: 'income', icon: 'smm', color: '#16a34a', order: 0 },
  { id: 'cat-smm-part1', name: 'SMM часть 1', kind: 'income', icon: 'smm', color: '#16a34a', order: 1 },
  { id: 'cat-smm-part2', name: 'SMM часть 2', kind: 'income', icon: 'smm', color: '#22c55e', order: 2 },
  { id: 'cat-development', name: 'Development', kind: 'income', icon: 'development', color: '#0ea5e9', order: 3 },
  { id: 'cat-design', name: 'Design', kind: 'income', icon: 'design', color: '#a855f7', order: 4 },
  { id: 'cat-debt-repay', name: 'Возврат долга', kind: 'income', icon: 'plus', color: '#14b8a6', order: 5 },
  { id: 'cat-other-income', name: 'Прочее', kind: 'income', icon: 'dots', color: '#64748b', order: 6 },
  // расход
  { id: 'cat-salary', name: 'Зарплата', kind: 'expense', icon: 'salary', color: '#f97316', order: 7 },
  { id: 'cat-ads', name: 'Реклама (ADS)', kind: 'expense', icon: 'target', color: '#ef4444', order: 8 },
  { id: 'cat-rent', name: 'Аренда', kind: 'expense', icon: 'building', color: '#e11d48', order: 9 },
  { id: 'cat-subscription', name: 'Подписки', kind: 'expense', icon: 'transactions', color: '#d946ef', order: 10 },
  { id: 'cat-transport', name: 'Транспорт', kind: 'expense', icon: 'car', color: '#0891b2', order: 11 },
  { id: 'cat-print', name: 'Печать', kind: 'expense', icon: 'printer', color: '#7c3aed', order: 12 },
  { id: 'cat-taxes', name: 'Налоги', kind: 'expense', icon: 'percent', color: '#b45309', order: 13 },
  { id: 'cat-debt', name: 'Долг', kind: 'expense', icon: 'receipt', color: '#d97706', order: 14 },
  { id: 'cat-other-expense', name: 'Прочее', kind: 'expense', icon: 'dots', color: '#64748b', order: 15 },
  // накопление / займы
  { id: 'cat-half-repayment', name: 'Half Repayment', kind: 'saving', icon: 'income', color: '#7c3aed', order: 16 },
];

export const TYPE_LABEL: Record<TxType, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  saving: 'Накопление',
};

/** Категория → группа дашборда (для согласованности с детальными таблицами). */
export function categoryGroup(categoryId?: string): Group | undefined {
  switch (categoryId) {
    case 'cat-smm': case 'cat-smm-part1': case 'cat-smm-part2': return 'smm';
    case 'cat-development': return 'development';
    case 'cat-design': return 'design';
    case 'cat-salary': return 'salary';
    case 'cat-rent': case 'cat-subscription': return 'rent_subs';
    case 'cat-debt': return 'debts';
    default: return undefined;
  }
}
