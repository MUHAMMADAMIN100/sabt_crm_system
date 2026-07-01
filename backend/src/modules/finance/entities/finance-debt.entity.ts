import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Долг компании. Остаток = totalAmount − сумма погашений (расходные
 *  операции с debtId = этот долг). */
@Entity('finance_debts')
export class FinanceDebt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Полная сумма долга. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  /** Планируемый платёж в месяц (для колонки «план/мес»). */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  monthlyPayment: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
