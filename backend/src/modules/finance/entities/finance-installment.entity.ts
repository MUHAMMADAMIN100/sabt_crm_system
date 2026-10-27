import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/** Платёж, внесённый мимо зарплаты: сотрудник принёс деньги сам или владелец
 *  закрыл часть суммы досрочно. txId — доход на счёт (у старых платежей его
 *  может не быть). alloc — за какие месяцы платёж, проставляется при записи;
 *  у старых платежей нет — они закрывают ближайшие открытые месяцы. */
export interface InstallmentPayment {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
  txId?: string | null;
  alloc?: Array<{ ym: string; amount: number }> | null;
}

/** Рассрочка сотрудника: компания купила вещь, сотрудник возвращает частями.
 *
 *  Возвращено = paidBefore + payments + удержания выплаченных месяцев. Сумма
 *  удержания выплаченного месяца живёт в снимке зарплаты сотрудника
 *  (salarySnapshots[ym].installments[id]), поэтому «переоткрыть месяц» и
 *  «отменить выплату» откатывают её сами, без отдельной синхронизации. */
@Entity('finance_installments')
@Index('IDX_fin_installments_employee', ['employeeId'])
export class FinanceInstallment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Строка ведомости (finance_employees.id), не пользователь CRM. */
  @Column({ type: 'uuid' })
  employeeId: string;

  /** Что куплено. */
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  /** Удержание из зарплаты в месяц по умолчанию. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  monthlyAmount: number;

  /** Первый месяц начисления ЗП, из которого удерживаем ('YYYY-MM'). */
  @Column({ type: 'varchar', length: 7 })
  startYm: string;

  /** Возвращено до начала учёта в CRM. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  paidBefore: number;

  /** Как возвращает: 'salary' — удержание в день выплаты ЗП (10-го),
   *  'separate' — вносит сам к своему числу месяца (dueDay). */
  @Column({ type: 'varchar', length: 16, default: 'salary' })
  method: 'salary' | 'separate';

  /** День оплаты 1..31 для «платит отдельно». */
  @Column({ type: 'int', nullable: true })
  dueDay: number | null;

  /** Перенесённые даты платежей: { 'YYYY-MM': 'YYYY-MM-DD' }. */
  @Column({ type: 'jsonb', nullable: true })
  dueDates: Record<string, string> | null;

  /** Своя сумма удержания на конкретный месяц: { 'YYYY-MM': сумма }, 0 — пропуск. */
  @Column({ type: 'jsonb', nullable: true })
  overrides: Record<string, number> | null;

  @Column({ type: 'jsonb', nullable: true })
  payments: InstallmentPayment[] | null;

  /** «Удержано из зарплаты» отмечено вручную (способ «из зарплаты»), пока
   *  выплату месяца не провели в CRM: { 'YYYY-MM': { date } }. */
  @Column({ type: 'jsonb', nullable: true })
  marks: Record<string, { date: string }> | null;

  /** Расход «покупка», если владелец попросил его записать. */
  @Column({ type: 'uuid', nullable: true })
  purchaseTxId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
