import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Направление проекта/клиента для финансов. */
export type FinanceDirection = 'smm' | 'development' | 'design';

/** Проект/клиент финансового учёта. Собственная сущность финансов
 *  (не FK на CRM-проекты) — заводится в «Настройки → Проекты/Клиенты». */
@Entity('finance_projects')
export class FinanceProject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'smm' })
  direction: FinanceDirection;

  /** Тариф (месячная сумма контракта) — для колонки «план» в обзоре. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  tariff: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Дата заключения контракта (ISO). По ней считается день оплаты SMM-цикла. */
  @Column({ type: 'date', nullable: true })
  contractDate: string | null;

  /** Архивный проект — больше не работаем; уходит из активных таблиц. */
  @Column({ type: 'boolean', default: false })
  archived: boolean;

  /** Статус жизненного цикла: lead | active | done | archived. */
  @Column({ type: 'varchar', length: 16, nullable: true, default: 'active' })
  status: string | null;

  /** design: брендбук/логобук — оплата по месяцам (матрица), иначе разовая. */
  @Column({ type: 'boolean', default: false })
  multiMonth: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
