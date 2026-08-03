import {
  Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn,
} from 'typeorm';

export type FinancePayrollPeriodStatus = 'open' | 'closed';

/** Глобальное состояние зарплатного периода.
 *
 * Транзакции продолжают хранить фактическую дату движения денег в `date` и
 * месяц начисления в `salaryYm`. Эта таблица отвечает только за workflow:
 * какой период открыт для записи и какой явно закрыт владельцем. */
@Entity('finance_payroll_periods')
@Index(['status', 'ym'])
export class FinancePayrollPeriod {
  @PrimaryColumn({ type: 'varchar', length: 7 })
  ym: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: FinancePayrollPeriodStatus;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  closedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reopenedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
