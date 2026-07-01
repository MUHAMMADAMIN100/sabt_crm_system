import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Регулярный платёж: аренда или подписка. Сумма — за месяц. */
@Entity('finance_subscriptions')
export class FinanceSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** rent — аренда, subscription — подписка (сервис/инструмент). */
  @Column({ type: 'varchar', length: 16, default: 'subscription' })
  kind: 'rent' | 'subscription';

  /** Сумма за месяц. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  /** Активна — входит в «регулярные/мес». */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
