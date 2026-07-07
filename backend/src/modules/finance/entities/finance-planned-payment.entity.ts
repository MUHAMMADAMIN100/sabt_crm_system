import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Статус плановой оплаты: ожидается / получена. */
export type PlannedPaymentStatus = 'expected' | 'received';

/** Плановая оплата: SMM части 1/2, ячейки матриц Development/Design,
 *  график погашения долгов. Ссылается на проект ИЛИ долг (plain uuid, без
 *  TypeORM-связей — как и остальной finance-модуль). Источник правды по
 *  «ожидается/получено»; при получении создаётся связанная транзакция. */
@Entity('finance_planned_payments')
export class FinancePlannedPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Проект/клиент (для доходов). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  /** Долг (для графика погашения по месяцам). */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  debtId: string | null;

  /** Месяц, к которому относится оплата — 'YYYY-MM'. */
  @Index()
  @Column({ type: 'varchar', length: 7 })
  ym: string;

  /** Часть оплаты (SMM: 1 = аванс, 2 = остаток). */
  @Column({ type: 'int', default: 1 })
  partNo: number;

  /** Сумма в сомони (TJS). */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'varchar', length: 16, default: 'expected' })
  status: PlannedPaymentStatus;

  /** Срок оплаты (для ожидаемых): к этой дате платёж должен быть получен.
   *  Часть 2 = дата оплаты части 1 + 20 дней; новый цикл = день контракта. */
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  /** Связанная транзакция (доход для проекта / расход для долга). */
  @Column({ type: 'uuid', nullable: true })
  receivedTxId: string | null;

  /** Создана автоматически из операции в журнале (SMM часть 1/2). */
  @Column({ type: 'boolean', default: false })
  auto: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
