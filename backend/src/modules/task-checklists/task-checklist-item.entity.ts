import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

@Entity('task_checklist_items')
export class TaskChecklistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task: Task;

  @Column()
  text: string;

  @Column({ default: false })
  isDone: boolean;

  @Column({ nullable: true })
  doneById: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'doneById' })
  doneBy: User;

  @Column({ type: 'timestamptz', nullable: true })
  doneAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
