import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum ActivityAction {
  // Auth
  LOGIN          = 'LOGIN',
  LOGOUT         = 'LOGOUT',
  REGISTER       = 'REGISTER',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET  = 'PASSWORD_RESET',
  // Tasks
  TASK_CREATE    = 'TASK_CREATE',
  TASK_UPDATE    = 'TASK_UPDATE',
  TASK_DELETE    = 'TASK_DELETE',
  TASK_STATUS    = 'TASK_STATUS',
  TASK_ASSIGN    = 'TASK_ASSIGN',
  // Projects
  PROJECT_CREATE  = 'PROJECT_CREATE',
  PROJECT_UPDATE  = 'PROJECT_UPDATE',
  PROJECT_DELETE  = 'PROJECT_DELETE',
  PROJECT_ARCHIVE = 'PROJECT_ARCHIVE',
  PROJECT_RESTORE = 'PROJECT_RESTORE',
  MEMBER_ADD      = 'MEMBER_ADD',
  MEMBER_REMOVE   = 'MEMBER_REMOVE',
  // Comments
  COMMENT_CREATE = 'COMMENT_CREATE',
  COMMENT_UPDATE = 'COMMENT_UPDATE',
  COMMENT_DELETE = 'COMMENT_DELETE',
  // Employees
  EMPLOYEE_CREATE       = 'EMPLOYEE_CREATE',
  EMPLOYEE_UPDATE       = 'EMPLOYEE_UPDATE',
  EMPLOYEE_DELETE       = 'EMPLOYEE_DELETE',
  EMPLOYEE_SUB_ADMIN    = 'EMPLOYEE_SUB_ADMIN',
  // Files
  FILE_UPLOAD = 'FILE_UPLOAD',
  FILE_DELETE = 'FILE_DELETE',
  // Reports
  REPORT_CREATE = 'REPORT_CREATE',
  REPORT_UPDATE = 'REPORT_UPDATE',
  REPORT_DELETE = 'REPORT_DELETE',
  // Time tracker
  TIMER_START  = 'TIMER_START',
  TIMER_STOP   = 'TIMER_STOP',
  TIME_LOG     = 'TIME_LOG',
  TIME_DELETE  = 'TIME_DELETE',
  // Stories
  STORY_UPDATE = 'STORY_UPDATE',
  // Task review workflow
  TASK_RESULT_SUBMIT  = 'TASK_RESULT_SUBMIT',
  TASK_REVIEW_APPROVE = 'TASK_REVIEW_APPROVE',
  TASK_REVIEW_RETURN  = 'TASK_REVIEW_RETURN',
  TASK_PROGRESS_UPDATE = 'TASK_PROGRESS_UPDATE',
  // Profile
  PROFILE_UPDATE = 'PROFILE_UPDATE',
  AVATAR_UPDATE  = 'AVATAR_UPDATE',
  USER_ACTIVATE  = 'USER_ACTIVATE',
  USER_DEACTIVATE = 'USER_DEACTIVATE',
}

@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  userName: string;

  @Column({ type: 'enum', enum: ActivityAction })
  action: ActivityAction;

  @Column({ nullable: true })
  entity: string;

  @Column({ nullable: true })
  entityId: string;

  @Column({ nullable: true })
  entityName: string;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
