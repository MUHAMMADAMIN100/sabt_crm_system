import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

export enum TaskResultType {
  FILE    = 'file',
  LINK    = 'link',
  COMMENT = 'comment',
  MEDIA   = 'media',
}

@Entity('task_results')
export class TaskResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn()
  task: Task;

  @Column()
  submittedById: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn()
  submittedBy: User;

  @Column({ type: 'enum', enum: TaskResultType, default: TaskResultType.COMMENT })
  type: TaskResultType;

  @Column({ type: 'text' })
  content: string;

  @Column({ nullable: true })
  fileName: string;

  @Column({ nullable: true })
  filePath: string;

  @CreateDateColumn()
  createdAt: Date;
}
