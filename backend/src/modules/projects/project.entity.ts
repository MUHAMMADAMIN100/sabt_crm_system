import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, OneToMany, ManyToMany, JoinTable, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';
import { FileAttachment } from '../files/file.entity';

export enum ProjectStatus {
  PLANNING = 'planning',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
  ON_HOLD = 'on_hold',
}

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn()
  manager: User;

  @Column({ nullable: true })
  managerId: string;

  @Column({ type: 'date', nullable: true })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate: Date;

  @Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.PLANNING })
  status: ProjectStatus;

  @Column({ nullable: true })
  color: string;

  @Column({ nullable: true })
  budget: number;

  @Column({ nullable: true, type: 'decimal', precision: 15, scale: 2 })
  paidAmount: number;

  @Column({ nullable: true })
  salesManagerId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'salesManagerId' })
  salesManager: User;

  @Column({ default: 0 })
  progress: number;

  @ManyToMany(() => User, { eager: true })
  @JoinTable({ name: 'project_members' })
  members: User[];

  @OneToMany(() => Task, task => task.project)
  tasks: Task[];

  @OneToMany(() => FileAttachment, file => file.project)
  files: FileAttachment[];

  @Column({ nullable: true })
  projectType: string;

  @Column({ type: 'jsonb', nullable: true })
  smmData: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  clientInfo: Record<string, any>;

  @Column({ default: false })
  isArchived: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
