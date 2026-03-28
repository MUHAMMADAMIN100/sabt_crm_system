import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';

@Entity('daily_reports')
export class DailyReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.reports, { eager: true })
  @JoinColumn()
  employee: User;

  @Column()
  employeeId: string;

  @ManyToOne(() => Project, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn()
  project: Project;

  @Column({ nullable: true })
  projectId: string;

  @ManyToOne(() => Task, { nullable: true, eager: true })
  @JoinColumn()
  task: Task;

  @Column({ nullable: true })
  taskId: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  timeSpent: number;

  @Column({ type: 'text', nullable: true })
  comments: string;

  @Column({ type: 'simple-array', nullable: true })
  files: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
