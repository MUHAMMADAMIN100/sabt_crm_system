import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Тип категории — определяет, в какую сторону влияет операция. */
export type FinanceCategoryType = 'income' | 'expense' | 'saving';

/** Категория операции. Часть категорий системные (`builtin=true`) — они
 *  участвуют в расчётах обзора и защищены от удаления; их `key` фиксирован.
 *  Пользователь может добавлять свои категории (builtin=false, key=null). */
@Entity('finance_categories')
export class FinanceCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  type: FinanceCategoryType;

  /** Системный ключ для расчётов: salary | rent | subscription | debt |
   *  debt_return | smm | smm1 | smm2 | development | design. У пользовательских — null. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  key: string | null;

  /** Системная категория — нельзя удалять (используется в расчётах). */
  @Column({ type: 'boolean', default: false })
  builtin: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
