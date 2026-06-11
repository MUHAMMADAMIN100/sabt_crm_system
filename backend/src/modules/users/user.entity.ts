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
  CO_FOUNDER      = 'co_founder',
  /** Руководитель СММ — на ступень выше head_smm и project_manager.
   *  Полный доступ ко ВСЕМ SMM-проектам (создание/редактирование/удаление,
   *  задачи, участники), но БЕЗ доступа к финансам. */
  SMM_DIRECTOR    = 'smm_director',
  PROJECT_MANAGER = 'project_manager',
  HEAD_SMM        = 'head_smm',
  SMM_SPECIALIST  = 'smm_specialist',
  DESIGNER        = 'designer',
  /** Менеджер продаж по SMM-направлению. */
  SALES_MANAGER_SMM = 'sales_manager_smm',
  /** Менеджер продаж по направлению разработки. */
  SALES_MANAGER_DEV = 'sales_manager_dev',
  MARKETER        = 'marketer',
  TARGETOLOGIST   = 'targetologist',
  DEVELOPER       = 'developer',
  /** Видеограф — исполнитель производства контента (права как у designer). */
  VIDEOGRAPHER    = 'videographer',
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

  @Column({ type: 'varchar', length: 50, default: UserRole.EMPLOYEE })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isBlocked: boolean;

  /** TOTP-secret (Base32), используется otplib для генерации/проверки кода.
   *  NULL → 2FA не настроена. Хранится как есть (для генерации кода нужен
   *  плейн-секрет). Если БД утечёт — атакующий получит TOTP, но без email
   *  и пароля жертвы он бесполезен. */
  @Column({ type: 'varchar', nullable: true })
  @Exclude()
  twoFactorSecret: string | null;

  /** Включена ли 2FA пользователем. Только после успешной проверки первого кода. */
  @Column({ default: false })
  twoFactorEnabled: boolean;

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
  @Exclude()
  resetPasswordToken: string;

  @Column({ nullable: true })
  @Exclude()
  resetPasswordExpires: Date;

  /** Команда сотрудника. m:1 — один сотрудник в одной команде.
   *  ON DELETE SET NULL — при удалении команды сотрудник остаётся
   *  «без команды». */
  @Column({ nullable: true })
  teamId: string;

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
