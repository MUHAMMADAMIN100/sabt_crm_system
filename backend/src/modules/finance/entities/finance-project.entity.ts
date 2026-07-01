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

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
