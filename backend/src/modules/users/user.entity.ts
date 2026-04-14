import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, OneToMany, BeforeInsert, BeforeUpdate,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Exclude } from 'class-transformer';
import { Task } from '../tasks/task.entity';
import { Comment } from '../comments/comment.entity';
import { Notification } from '../notifications/notification.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';

export enum UserRole {
  ADMIN           = 'admin',
  FOUNDER         = 'founder',
  PROJECT_MANAGER = 'project_manager',
  HEAD_SMM        = 'head_smm',
  SMM_SPECIALIST  = 'smm_specialist',
  DESIGNER        = 'designer',
  SALES_MANAGER   = 'sales_manager',
  MARKETER        = 'marketer',
  TARGETOLOGIST   = 'targetologist',
  DEVELOPER       = 'developer',
  EMPLOYEE        = 'employee',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.EMPLOYEE })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isBlocked: boolean;

  @Column({ type: 'timestamp', nullable: true })
  blockedAt: Date;

  @Column({ nullable: true })
  blockedById: string;

  @Column({ nullable: true })
  blockedByName: string;

  @Column({ nullable: true })
  blockedByRole: string;

  @Column({ type: 'text', nullable: true })
  blockReason: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true })
  resetPasswordToken: string;

  @Column({ nullable: true })
  resetPasswordExpires: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Task, task => task.assignee)
  tasks: Task[];

  @OneToMany(() => Comment, comment => comment.author)
  comments: Comment[];

  @OneToMany(() => Notification, notif => notif.user)
  notifications: Notification[];

  @OneToMany(() => TimeLog, log => log.employee)
  timeLogs: TimeLog[];

  @OneToMany(() => DailyReport, report => report.employee)
  reports: DailyReport[];

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password && !this.password.startsWith('$2a$') && !this.password.startsWith('$2b$')) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }
}
