import {
  Entity, PrimaryColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Task } from './task.entity';
import { User } from '../users/user.entity';

/** Многие-ко-многим Task ↔ User со собственным состоянием.
 *  Каждый исполнитель отдельно отмечает свою часть готовой.
 *  Когда все isDone=true → задача автоматически переходит в REVIEW. */
@Entity('task_assignees')
export class TaskAssignee {
  @PrimaryColumn('uuid')
  taskId: string;

  @PrimaryColumn('uuid')
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
