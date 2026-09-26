import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { DevTask } from './dev-task.entity';
import { User } from '../users/user.entity';

/** История изменений задачи dev-tracker (аудит полей).
 *  Отдельная таблица: пишем из move/update/bulk, читаем через GET :id/history.
 *  Ошибка записи истории не должна ронять мутацию (см. logHistory в сервисе). */
@Entity('dev_task_history')
export class DevTaskHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DevTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task: DevTask;

  @Column()
  taskId: string;

  @ManyToOne(() => User, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;

  @Column({ nullable: true })
  actorId: string | null;

  /** Какое поле менялось: 'status'|'assignee'|'priority'|'deadline'|'title'|'blocked'|'sprint'. */
  @Column({ type: 'varchar' })
  field: string;

  /** Значения строкой (для assignee — id или null), nullable. */
  @Column({ type: 'text', nullable: true })
  from: string | null;

  @Column({ type: 'text', nullable: true })
  to: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
