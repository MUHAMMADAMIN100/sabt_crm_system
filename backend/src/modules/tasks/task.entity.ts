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

/** Статусы задач.
 *  Существующие (NEW / IN_PROGRESS / REVIEW / RETURNED / DONE / CANCELLED)
 *  оставлены для обратной совместимости со старыми задачами.
 *  Новые (Wave 3) расширяют пайплайн: ACCEPTED — задача принята исполнителем,
 *  ON_PM_REVIEW — на проверке у PM, ON_REWORK — отправлена на доработку,
 *  ON_CLIENT_APPROVAL — на согласовании у клиента, APPROVED — клиент утвердил,
 *  PUBLISHED — опубликовано (для контента), RESCHEDULED — перенесено. */
export enum TaskStatus {
  NEW                = 'new',
  IN_PROGRESS        = 'in_progress',
  REVIEW             = 'review',
  RETURNED           = 'returned',
  DONE               = 'done',
  CANCELLED          = 'cancelled',
  // Wave 3 additions (новые статусы):
  ACCEPTED           = 'accepted',
  ON_PM_REVIEW       = 'on_pm_review',
  ON_REWORK          = 'on_rework',
  ON_CLIENT_APPROVAL = 'on_client_approval',
  APPROVED           = 'approved',
  PUBLISHED          = 'published',
  RESCHEDULED        = 'rescheduled',
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

  // ─── Wave 3: расширенные поля для качества и контроля ────────────────
  /** Назначенный проверяющий (обычно PM). Отличается от reviewedById,
   *  который проставляется фактом проверки. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewerId' })
  reviewer: User;

  @Column({ nullable: true })
  reviewerId: string;

  /** Сколько раз задача возвращалась на доработку. Инкрементируется при
   *  переходе REVIEW → RETURNED / ON_PM_REVIEW → ON_REWORK. */
  @Column({ default: 0 })
  reworkCount: number;

  /** Оценка качества от PM/клиента: 1..10. NULL — ещё не оценена. */
  @Column({ type: 'int', nullable: true })
  qualityScore: number;

  /** Принята ли задача с первого раза (без возвратов). Полезно для
   *  рейтинга качества сотрудников. */
  @Column({ default: false })
  acceptedOnFirstTry: boolean;

  /** Фактическая продолжительность выполнения в часах (от старта до DONE).
   *  Отличается от loggedHours, который суммирует время по таймеру. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  actualCompletionHours: number;

  /** Тип результата: post, reel, story, design, ad, video, и т.д.
   *  Свободная строка — без enum, чтобы не плодить миграций при новых форматах. */
  @Column({ nullable: true })
  deliveryType: string;

  /** Причина удаления — обязательна при DELETE. Сохраняется в activity log;
   *  колонка остаётся для целей soft-delete в будущем. */
  @Column({ type: 'text', nullable: true })
  deletionReason: string;

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
