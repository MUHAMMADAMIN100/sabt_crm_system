// Базовые типы раздела «Финансы» — форма данных, которую отдаёт бэкенд.
// Поля в основном optional: страницы исторически работали с any, типы
// вводятся постепенно (новый код — типизированный, старый мигрирует по мере правок).

export interface FinAccount {
  id: string;
  name: string;
  key?: string | null;
  startBalance?: number;
  color?: string | null;
  kind?: 'bank' | 'cash' | 'savings' | string | null;
  archived?: boolean;
  position?: number;
}

export interface FinCategory {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer' | 'saving' | string;
  key?: string | null;
  builtin?: boolean;
  icon?: string | null;
  color?: string | null;
}

export interface FinProject {
  id: string;
  name: string;
  direction: 'smm' | 'development' | 'design' | 'maintenance' | string;
  tariff?: number;
  contractDate?: string | null;
  cycleAnchor?: string | null;
  archived?: boolean;
  multiMonth?: boolean;
  status?: 'lead' | 'active' | 'done' | 'archived' | string;
  note?: string | null;
}

export interface FinEmployee {
  id: string;
  name: string;
  role?: string | null;
  category?: string | null;
  salary?: number;
  salaryHistory?: Record<string, number> | null;
  advance?: number;
  bonuses?: Record<string, number> | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  status?: 'active' | 'fired' | string;
}

export interface FinSubscription {
  id: string;
  name: string;
  kind?: 'rent' | 'subscription' | string;
  amount?: number;
  active?: boolean;
  dueDay?: number | null;
  paidMarks?: Array<{ ym: string; date: string }> | null;
}

export interface FinDebt {
  id: string;
  name: string;
  counterparty?: string | null;
  totalAmount?: number;
  monthlyPayment?: number;
  paidBefore?: number;
  remaining?: number;
  note?: string | null;
}

export interface FinAsset {
  id: string;
  name: string;
  category?: string | null;
  purchaseDate?: string | null;
  price?: number;
  serviceMonths?: number;
  status?: 'in_use' | 'repair' | 'written_off' | 'sold' | string;
  assignee?: string | null;
  serial?: string | null;
  warrantyUntil?: string | null;
  note?: string | null;
  // Расчётные поля бэка (decorateAsset):
  residual?: number;
  monthlyDep?: number;
  wornOut?: boolean;
}

/** Decorated-транзакция (listTransactions/overview): имена справочников уже внутри. */
export interface FinTx {
  id: string;
  /** Архивные строки из внешнего учёта доступны для просмотра, но не
   *  редактируются и не участвуют в текущем остатке счетов. */
  source?: string | null;
  externalId?: string | null;
  imported?: boolean;
  affectsBalance?: boolean;
  date: string;
  type: 'income' | 'expense' | 'transfer' | 'saving' | string;
  amount: number;
  status?: string;
  comment?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  group?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  debtId?: string | null;
  debtName?: string | null;
  subscriptionId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  fromAccountId?: string | null;
  fromAccountName?: string | null;
  toAccountId?: string | null;
  toAccountName?: string | null;
}

export interface FinBackupMeta {
  id: string;
  kind: 'auto' | 'manual' | 'pre_restore' | string;
  stats?: Record<string, number> | null;
  createdAt: string;
}
