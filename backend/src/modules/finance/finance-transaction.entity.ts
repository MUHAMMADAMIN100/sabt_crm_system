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

/** Категории транзакций — единый список для income/expense. */
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

  @Index()
  @Column({ type: 'enum', enum: FinanceAccount })
  account: FinanceAccount;

  @Index()
  @Column({ type: 'enum', enum: FinanceCategory })
  category: FinanceCategory;

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
