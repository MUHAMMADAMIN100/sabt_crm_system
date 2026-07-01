import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Регулярный расход — аренда или подписка (оплачивается помесячно). */
@Entity('finance_subscriptions')
export class FinanceSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  /** 'rent' — аренда, 'subscription' — подписка. */
  @Column({ type: 'varchar', length: 20, default: 'subscription' })
  kind: 'rent' | 'subscription';

  /** Счёт списания по умолчанию (значение FinanceAccount). */
  @Column({ type: 'varchar', length: 30, nullable: true })
  accountId: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
