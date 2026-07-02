// Доменная модель Fin Web System.
// Источник правды — журнал транзакций. Сводки на главной (Доход/Расход за месяц),
// пирог Overall, балансы счетов и детализация (SMM/Dev/Design, ЗП/Подписки/Долги)
// ВЫЧИСЛЯЮТСЯ из транзакций по выбранному месяцу (см. src/lib/calc.ts).

export type ID = string;

export type TxType = 'income' | 'expense' | 'transfer' | 'saving';

/** Три направления дохода (как на схеме). */
export type IncomeGroup = 'smm' | 'development' | 'design';
/** Три части расхода (как на схеме). */
export type ExpenseGroup = 'salary' | 'rent_subs' | 'debts';
export type Group = IncomeGroup | ExpenseGroup;

export interface Account {
  id: ID;
  name: string; // Alif, DC, Наличные
  kind: 'bank' | 'cash' | 'savings';
  openingBalance: number;
  color: string;
  order: number;
  archived?: boolean;
}

/** Гибкая категория (как в Notion): ADS, Транспорт, Налоги, Печать, Зарплата и т.д. */
export interface Category {
  id: ID;
  name: string;
  kind: 'income' | 'expense' | 'transfer' | 'saving';
  icon: string;
  color: string;
  archived?: boolean;
  order: number;
}

export interface Transaction {
  id: ID;
  date: string; // ISO yyyy-mm-dd — реальная дата (основа динамики и переключателя месяца)
  type: TxType;
  amount: number; // всегда положительное
  categoryId?: ID; // гибкая категория (журнал, разбивка дашборда)
  group?: Group; // направление дохода / часть расхода (для детальных таблиц); пусто для перевода
  accountFrom?: ID; // источник: expense / transfer
  accountTo?: ID; // получатель: income / transfer
  clientId?: ID; // проект (доход)
  employeeId?: ID; // сотрудник (ЗП)
  debtId?: ID; // долг (погашение)
  subscriptionId?: ID; // подписка/аренда
  plannedPaymentId?: ID; // если это получение запланированной оплаты SMM
  comment?: string;
  createdAt: string;
}

/** Проект/клиент по одному из трёх направлений дохода. */
export interface Client {
  id: ID;
  name: string;
  group: IncomeGroup;
  tariff: number; // SMM — цена за месяц; Dev/Design — полная сумма этапа/проекта
  status: 'active' | 'done' | 'lead' | 'archived';
  contractDate?: string; // ISO — дата заключения контракта (по ней берётся оплата)
  startMonth?: string; // yyyy-mm
  note?: string; // комментарий по проекту
  multiMonth?: boolean; // design: брендбук/логобук — оплата по месяцам (матрица), иначе разовая
}

/** Плановая оплата SMM-проекта: часть 1 / часть 2 в конкретном месяце. */
export interface PlannedPayment {
  id: ID;
  clientId?: ID; // для дохода (проект)
  debtId?: ID; // для долга (график погашения по месяцам)
  ym: string; // yyyy-mm — месяц, к которому относится оплата
  partNo: 1 | 2;
  amount: number;
  status: 'expected' | 'received';
  receivedTxId?: ID; // связанная транзакция (доход для проекта / расход для долга)
  auto?: boolean; // создана автоматически из операции в журнале (SMM часть 1/2)
  dueDate?: string;
}

export interface Employee {
  id: ID;
  name: string;
  salary: number; // оклад/мес
  advance: number; // типовой аванс
  role?: string; // должность
  hireDate?: string; // ISO — дата приёма на работу
  note?: string; // комментарий
  status: 'active' | 'fired';
}

/** Фиксированный регулярный расход: аренда или подписка. */
export interface Subscription {
  id: ID;
  name: string; // Rent, Adobe, Claude, Capcut, Server
  amount: number; // в месяц
  kind: 'rent' | 'subscription';
  accountId?: ID; // с какого счёта обычно платится
  active: boolean;
}

/** Долг/рассрочка (камера и т.п.). */
export interface Debt {
  id: ID;
  name: string;
  counterparty?: string;
  totalAmount: number;
  paidBefore: number; // погашено до старта системы
  monthlyPayment?: number;
  accountId?: ID;
  startDate?: string;
  note?: string;
}

export interface Meta {
  key: string;
  value: string;
}
