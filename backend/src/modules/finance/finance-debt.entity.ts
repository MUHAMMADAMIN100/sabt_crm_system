import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Долг агентства с графиком погашения. */
@Entity('finance_debts')
export class FinanceDebt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  counterparty: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  /** Погашено до старта учёта в системе (не создаёт транзакций). */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  paidBefore: number;

  /** Плановый платёж/мес — по нему авто-раскидывается остаток. */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  monthlyPayment: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  accountId: string | null;

  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
