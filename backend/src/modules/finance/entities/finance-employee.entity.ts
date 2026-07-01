import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Сотрудник финансового учёта (для зарплатной ведомости). Собственная
 *  сущность финансов — заводится в «Настройки → Сотрудники». */
@Entity('finance_employees')
export class FinanceEmployee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  role: string | null;

  /** Оклад в месяц. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  salary: number;

  /** active — учитывается в фонде ЗП; inactive — нет. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
