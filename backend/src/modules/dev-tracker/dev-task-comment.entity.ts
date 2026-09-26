import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { DevTask } from './dev-task.entity';
import { User } from '../users/user.entity';

/** Комментарий к задаче dev-tracker. Отдельная таблица от comments:
 *  та привязана к production-задачам (tasks), смешивать потоки обсуждений
 *  двух разных досок в одной таблице не нужно. */
@Entity('dev_task_comments')
export class DevTaskComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DevTask, task => task.comments, { onDelete: 'CASCADE' })
  @JoinColumn()
  task: DevTask;

  @Column()
  taskId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn()
  author: User;

  @Column()
  authorId: string;

  @Column({ type: 'text' })
  text: string;

  @CreateDateColumn()
  createdAt: Date;
}
