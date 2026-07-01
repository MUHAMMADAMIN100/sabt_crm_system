import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Тип операции — деньги пришли или ушли. */
export enum FinanceTxType {
  INCOME  = 'income',
  EXPENSE = 'expense',
}

/** Фиксированный список рабочих счетов агентства. */
export enum FinanceAccount {
  ALIF          = 'alif',
  DUSHANBE_CITY = 'dushanbe_city',
  CASH          = 'cash',
}

/** Стандартные категории транзакций — стартовый набор.
 *  Поле `category` теперь свободная строка: пользователь может добавлять
 *  свои категории прямо в форме, и они сохраняются вместе с транзакцией. */
export enum FinanceCategory {
  SALARY      = 'salary',
  PROJECT     = 'project',
  SUBSCRIPTION = 'subscription',
  RENT        = 'rent',
  MARKETING   = 'marketing',
  TOOLS       = 'tools',
  TRANSPORT   = 'transport',
  OTHER       = 'other',
}

/** Способ оплаты — необязательное поле. */
export enum FinancePaymentMethod {
  TRANSFER = 'transfer',
  CARD     = 'card',
  CASH     = 'cash',
  QR       = 'qr',
}

/** Статус — отменённые не учитываются в балансе. */
export enum FinanceTxStatus {
  COMPLETED = 'completed',
  PENDING   = 'pending',
  CANCELLED = 'cancelled',
}

@Entity('finance_transactions')
export class FinanceTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: FinanceTxType })
  type: FinanceTxType;

  /** Сумма в сомони (TJS). Decimal — чтобы не терять копейки. */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Index()
  @Column({ type: 'date' })
  date: string;

  /** «Основной» счёт. Для одиночных оплат — единственный счёт зачисления.
   *  Для сплит-оплат — оставлен для обратной совместимости (отчёты, которые
   *  ещё не научились читать `splits`, корректно покажут хотя бы один счёт). */
  @Index()
  @Column({ type: 'enum', enum: FinanceAccount })
  account: FinanceAccount;

  /** Сплит-оплата: часть суммы на один счёт, часть на другой.
   *  Каждый элемент: { account: FinanceAccount, amount: number }.
   *  Сумма всех частей должна равняться `amount`.
   *  Если null/пусто — транзакция считается одиночной по `account`.
   *  Балансы по счетам считаются из splits, если они есть. */
  @Column({ type: 'jsonb', nullable: true })
  splits: Array<{ account: FinanceAccount; amount: number }> | null;

  /** Категория — свободная строка. Стандартные значения берутся из
   *  FinanceCategory, но допускаются и произвольные пользовательские. */
  @Index()
  @Column({ type: 'varchar', length: 100 })
  category: string;

  /** Краткое название операции — обязательное. */
  @Column()
  description: string;

  /** Имя клиента/поставщика — свободный текст, не FK. */
  @Column({ nullable: true })
  counterparty: string;

  /** Название проекта — текст. Не FK на projects, чтобы не падать
   *  при удалении проекта и поддерживать любые строки. */
  @Column({ nullable: true })
  project: string;

  @Column({ type: 'enum', enum: FinancePaymentMethod, nullable: true })
  paymentMethod: FinancePaymentMethod;

  @Index()
  @Column({ type: 'enum', enum: FinanceTxStatus, default: FinanceTxStatus.COMPLETED })
  status: FinanceTxStatus;

  @Column({ type: 'text', nullable: true })
  comment: string;

  // ─── Связи с сущностями финмодуля (для матриц/графиков) ──────────
  /** Направление дохода/статья расхода: smm|development|design|salary|rent_subs|debts. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  group: string | null;

  /** Проект-источник дохода (переиспользуем проекты CRM). */
  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  debtId: string | null;

  @Column({ type: 'uuid', nullable: true })
  plannedPaymentId: string | null;

  /** Кто создал запись — для аудита. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
