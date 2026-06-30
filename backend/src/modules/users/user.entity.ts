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
  /** Руководитель СММ — полный доступ ко ВСЕМ SMM-проектам (создание/
   *  редактирование/удаление, задачи, участники), но БЕЗ финансов. */
  SMM_DIRECTOR    = 'smm_director',
  /** Руководитель по видеографии — менеджерский уровень для видео-
   *  направления (approve/return задач, аналитика, отчёты, риски). */
  VIDEO_DIRECTOR  = 'video_director',
  SMM_SPECIALIST  = 'smm_specialist',
  DESIGNER        = 'designer',
  /** Менеджер продаж по SMM-направлению. */
  SALES_MANAGER_SMM = 'sales_manager_smm',
  /** Менеджер продаж по направлению разработки. */
  SALES_MANAGER_DEV = 'sales_manager_dev',
  DEVELOPER       = 'developer',
  /** Видеограф — исполнитель производства контента (права как у designer). */
  VIDEOGRAPHER    = 'videographer',
  /** Монтажёр — исполнитель видео-продакшна. */
  VIDEO_EDITOR    = 'video_editor',
  /** Организатор — исполнитель (организация съёмок/мероприятий). */
  ORGANIZER       = 'organizer',
  /** Сторисмейкер — исполнитель, ведёт истории SMM-проектов
   *  (права как у smm_specialist по историям). */
  STORYMAKER      = 'storymaker',
  /** Сценарист / SMM-менеджер — владелец Контент-плана (темы, сценарии,
   *  даты публикации). Workflow-доска SMM. */
  SCRIPTWRITER    = 'scriptwriter',
  /** Контролёр качества — этап «Внутренняя проверка» на workflow-доске. */
  QA              = 'qa',
  /** Публикатор — сбор материалов и публикация (этап «Готово к публикации»). */
  PUBLISHER       = 'publisher',
  /** Таргетолог — запуск рекламы (этап «Реклама»). */
  TARGETOLOGIST   = 'targetologist',
  EMPLOYEE        = 'employee',
}

/* Удалённые роли (12.06.2026): project_manager, head_smm, targetologist,
 * marketer. Существующие пользователи мигрируются:
 *   head_smm → smm_director; остальные → employee.
 * «Менеджер проекта» теперь назначается ЛЮБОМУ сотруднику в форме проекта
 * (project.managerId) и даёт права руководителя этого проекта без
 * отдельной роли. См. миграцию RemoveLegacyRoles. */

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

  /** Дополнительная (вторая) роль — например видеограф, который ещё и
   *  монтажёр. Права = объединение обеих ролей (см. RolesGuard).
   *  Назначать может только admin/founder/co_founder. Привилегированные
   *  роли (admin/founder/co_founder) второй ролью не назначаются.
   *  KPI-таргеты и дашборд — по основной роли. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  secondaryRole: UserRole | null;

  /** Персональные доступы ПОВЕРХ роли — выдаёт основатель/сооснователь/админ
   *  на странице «Доступы сотрудников». Расширяют права (не отнимают).
   *  Список ключей-возможностей (см. auth/permissions.ts GRANTABLE). */
  @Column({ type: 'jsonb', nullable: true })
  extraPermissions: string[] | null;

  /** Персональная тема интерфейса в формате realtimecolors —
   *  5 hex-цветов через дефис: text-background-primary-secondary-accent
   *  (например "18181b-fafafa-4f46e5-71717a-22c55e"). NULL — дефолт.
   *  Из этих 5 цветов фронт генерирует весь surface-масштаб и красит
   *  ВЕСЬ интерфейс. Персонально на сотрудника, ни на кого не влияет. */
  // 128 символов: вмещает пару тем (10 цветов: 5 светлая + 5 тёмная = 69 симв.).
  @Column({ type: 'varchar', length: 128, nullable: true })
  themeColor: string | null;

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
