import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

@Entity('time_logs')
export class TimeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Task, task => task.timeLogs, { onDelete: 'CASCADE', eager: true })
  @JoinColumn()
  task: Task;

  @Column()
  taskId: string;

  @ManyToOne(() => User, user => user.timeLogs, { eager: true })
  @JoinColumn()
  employee: User;

  @Column()
  employeeId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  timeSpent: number; // in hours

  @Column({ type: 'date' })
  date: Date;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  timerStartedAt: Date;

  @Column({ default: false })
  isRunning: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
