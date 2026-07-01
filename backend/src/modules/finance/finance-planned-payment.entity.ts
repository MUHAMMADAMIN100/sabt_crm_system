import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Планируемая/полученная оплата: по проекту (доход) ИЛИ по долгу (платёж).
 *  projectId и debtId — взаимоисключающие. */
@Entity('finance_planned_payments')
export class FinancePlannedPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  debtId: string | null;

  /** Месяц оплаты yyyy-mm. */
  @Index()
  @Column({ type: 'varchar', length: 7 })
  ym: string;

  /** Часть 1/2 (у долгов всегда 1). */
  @Column({ type: 'int', default: 1 })
  partNo: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'expected' })
  status: 'expected' | 'received';

  /** Связанная транзакция (когда получено). */
  @Column({ type: 'uuid', nullable: true })
  receivedTxId: string | null;

  @Column({ default: false })
  auto: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
