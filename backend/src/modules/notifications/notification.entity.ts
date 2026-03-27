import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum NotificationType {
  NEW_TASK = 'new_task',
  TASK_COMMENT = 'task_comment',
  STATUS_CHANGE = 'status_change',
  DEADLINE_APPROACHING = 'deadline_approaching',
  NEW_REPORT = 'new_report',
  PROJECT_ASSIGNED = 'project_assigned',
  TASK_COMPLETED = 'task_completed',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.notifications, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  link: string;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
