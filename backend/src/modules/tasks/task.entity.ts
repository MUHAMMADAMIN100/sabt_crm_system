import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { Comment } from '../comments/comment.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { FileAttachment } from '../files/file.entity';

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum TaskStatus {
  NEW        = 'new',
  IN_PROGRESS = 'in_progress',
<<<<<<< HEAD
  REVIEW     = 'review',
  RETURNED   = 'returned',
  DONE       = 'done',
  CANCELLED  = 'cancelled',
=======
  REVIEW = 'review',
  RETURNED = 'returned',
  DONE = 'done',
  CANCELLED = 'cancelled',
>>>>>>> b37de1a (add manager field + fix task assignee logic)
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => Project, project => project.tasks, { onDelete: 'CASCADE' })
  @JoinColumn()
  project: Project;

  @Column()
  projectId: string;

  @ManyToOne(() => User, user => user.tasks, { nullable: true, eager: true })
  @JoinColumn()
  assignee: User;

  @Column({ nullable: true })
  assigneeId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn()
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @Column({ type: 'enum', enum: TaskPriority, default: TaskPriority.MEDIUM })
  priority: TaskPriority;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.NEW })
  status: TaskStatus;

  @Column({ type: 'date', nullable: true })
  startDate: string;

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date;

  @Column({ default: 0 })
  estimatedHours: number;

  @Column({ default: 0 })
  loggedHours: number;

<<<<<<< HEAD
  @Column({ default: 0 })
  totalCount: number;

  @Column({ default: 0 })
  doneCount: number;

  @Column({ nullable: true })
  returnReason: string;

  @Column({ nullable: true })
  reviewedById: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date;
=======
  @Column({ nullable: true })
  targetCount: number; // target quantity (e.g. 3 stories, 5 posts)

  @Column({ default: 0 })
  completedCount: number; // how many done

  @Column({ default: 0 })
  returnCount: number; // how many times returned

  @Column({ type: 'text', nullable: true })
  returnComment: string; // last return reason

  @Column({ nullable: true })
  resultUrl: string; // result link

  @Column({ nullable: true })
  reviewedById: string; // who approved

  @Column({ nullable: true })
  reviewedAt: Date; // when approved
>>>>>>> b37de1a (add manager field + fix task assignee logic)

  @OneToMany(() => Comment, comment => comment.task)
  comments: Comment[];

  @OneToMany(() => TimeLog, log => log.task)
  timeLogs: TimeLog[];

  @OneToMany(() => FileAttachment, file => file.task)
  files: FileAttachment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
