import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Тип операции: приход, расход, перевод между счетами, накопление. */
export enum FinanceTxType {
  INCOME   = 'income',
  EXPENSE  = 'expense',
  TRANSFER = 'transfer',
  SAVING   = 'saving',
}

/** Ключи дефолтных счетов (для бэкфилла старых записей). Счета теперь
 *  хранятся в таблице finance_accounts; enum оставлен для совместимости. */
export enum FinanceAccount {
  ALIF          = 'alif',
  DUSHANBE_CITY = 'dushanbe_city',
  CASH          = 'cash',
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
  @Column({ type: 'varchar', length: 16 })
  type: FinanceTxType;

  /** Сумма в сомони (TJS). */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Index()
  @Column({ type: 'date' })
  date: string;

  // ─── Счета (новая динамическая модель) ───────────────────────────
  /** Счёт для income/expense/saving. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  accountId: string | null;

  /** Перевод: списание со счёта. */
  @Column({ type: 'uuid', nullable: true })
  fromAccountId: string | null;

  /** Перевод: зачисление на счёт. */
  @Column({ type: 'uuid', nullable: true })
  toAccountId: string | null;

  /** Категория (FK на finance_categories). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  /** Финансовый проект/клиент (для доходов). */
  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  /** Сотрудник (для выплат зарплаты). */
  @Column({ type: 'uuid', nullable: true })
  employeeId: string | null;

  /** Долг (для погашений). */
  @Column({ type: 'uuid', nullable: true })
  debtId: string | null;

  /** Подписка/аренда (для оплаты регулярного платежа). */
  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  /** Месяц НАЧИСЛЕНИЯ зарплатной операции ('YYYY-MM'). Разводит «за какой
   *  месяц зарплата» и «когда фактически выплачено» (поле date). Заполняется
   *  только для зарплатных операций (employeeId != null, тип expense);
   *  движение денег/баланс/журнал всегда по date. NULL у старых строк —
   *  fallback на месяц из date. */
  @Index()
  @Column({ type: 'varchar', length: 7, nullable: true })
  salaryYm: string | null;

  // ─── Legacy-поля (совместимость со старым журналом) ──────────────
  /** Legacy enum-счёт. Новые записи используют accountId. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  account: string | null;

  @Column({ type: 'jsonb', nullable: true })
  splits: Array<{ account: string; amount: number }> | null;

  /** Название категории строкой (для отображения/legacy). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true })
  counterparty: string | null;

  @Column({ type: 'varchar', nullable: true })
  project: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  paymentMethod: string | null;

  @Index()
  @Column({ type: 'varchar', length: 16, default: FinanceTxStatus.COMPLETED })
  status: FinanceTxStatus;

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
