import {
  Entity, PrimaryColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Task } from './task.entity';
import { User } from '../users/user.entity';

/** Sequential workflow исполнителей: задача проходит через шаги по
 *  очереди, в порядке возрастания position. Один и тот же сотрудник
 *  может быть на разных шагах (например, SMM пишет промпт на 1-м шаге
 *  и публикует на 3-м).
 *  PK: (taskId, position) — позволяет дубликаты userId. */
@Entity('task_assignees')
export class TaskAssignee {
  @PrimaryColumn('uuid')
  taskId: string;

  /** Порядковый номер шага (0-based). Шаги идут по возрастанию. */
  @PrimaryColumn({ type: 'int' })
  position: number;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task: Task;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ default: false })
  isDone: boolean;

  @Column({ type: 'timestamp', nullable: true })
  doneAt: Date;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;
}
