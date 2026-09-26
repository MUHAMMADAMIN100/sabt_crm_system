import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Статус спринта доски разработки. Храним varchar'ом, а не pg-enum,
 *  чтобы миграции оставались идемпотентными без CREATE TYPE
 *  (см. 1807000000000-AddDevSprintAndViews). Значения валидирует сервис. */
export enum DevSprintStatus {
  ACTIVE = 'active',
  DONE   = 'done',
}

/** Спринт доски разработки (контракт H).
 *  Задачи привязываются через DevTask.sprintId (nullable, SET NULL).
 *  Завершение — POST /dev-tracker/sprints/:id/complete {moveTo}: открытые
 *  задачи уходят в backlog (sprintId null) или в указанный спринт,
 *  затем спринт переходит в done. */
@Entity('dev_sprint')
export class DevSprint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  goal: string | null;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({ type: 'varchar', length: 20, default: DevSprintStatus.ACTIVE })
  status: DevSprintStatus;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
