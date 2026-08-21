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

  /** День оплаты в месяце (1..31) — для напоминаний; null — без срока. */
  @Column({ type: 'int', nullable: true })
  dueDay: number | null;

  /** Дата НАЧАЛА (первое списание), 'YYYY-MM-DD'. Из неё берётся день месяца
   *  (dueDay); платёж повторяется каждый месяц в этот день начиная с неё. */
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  /** Дата ОКОНЧАНИЯ подписки/аренды. После неё списаний больше нет.
   *  null — без ограничения (пока подписка активна). */
  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  /** Месяцы, отмеченные оплаченными вручную — без операции в журнале
   *  (деньги по счетам не двигаются): [{ ym: '2026-07', date: '2026-07-02' }]. */
  @Column({ type: 'jsonb', nullable: true })
  paidMarks: Array<{ ym: string; date: string }> | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
