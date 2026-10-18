import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Цель месяца сотрудника (профиль, идея 2 — решение владельца 17.10.2026).
 *  Ставят руководитель направления и основатель, до трёх на месяц.
 *  metric = null — выполнение отмечает сотрудник; иначе CRM считает сама
 *  (efficiency | stories_days | ontime_shifts | kpi:<ключ метрики>). */
@Entity('employee_goals')
@Index(['userId', 'ym'])
export class EmployeeGoal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** Месяц цели: YYYY-MM. */
  @Column({ type: 'varchar', length: 7 })
  ym: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  metric: string | null;

  @Column({ type: 'int', nullable: true })
  target: number | null;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  doneAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
