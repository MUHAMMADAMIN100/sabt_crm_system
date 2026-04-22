import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

/** Тип единицы контента — соответствует deliverables в SmmTariff. */
export enum ContentItemType {
  REEL     = 'reel',
  STORY    = 'story',
  POST     = 'post',
  DESIGN   = 'design',
  AD       = 'ad',
  VIDEO    = 'video',
  CAROUSEL = 'carousel',
  OTHER    = 'other',
}

/** Статус позиции контент-плана (пайплайн от планирования до публикации). */
export enum ContentPlanStatus {
  PLANNED       = 'planned',
  PREPARING     = 'preparing',
  IN_PRODUCTION = 'in_production',
  ON_REVIEW     = 'on_review',
  ON_APPROVAL   = 'on_approval',
  APPROVED      = 'approved',
  PUBLISHED     = 'published',
  CANCELLED     = 'cancelled',
}

/** Состояние согласования с клиентом — ортогонально основному статусу. */
export enum ContentApprovalStatus {
  PENDING            = 'pending',
  APPROVED           = 'approved',
  CHANGES_REQUESTED  = 'changes_requested',
  REJECTED           = 'rejected',
}

@Entity('content_plan_items')
export class ContentPlanItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: string;

  @Column({ type: 'enum', enum: ContentItemType, default: ContentItemType.POST })
  contentType: ContentItemType;

  /** Тема / заголовок единицы контента. */
  @Column()
  topic: string;

  /** Под-формат: vertical, square, carousel-3, и т.д. — свободный текст. */
  @Column({ nullable: true })
  format: string;

  /** Дедлайн на подготовку (когда материал должен быть готов к ревью). */
  @Column({ type: 'timestamp', nullable: true })
  preparationDeadline: Date;

  /** Дата публикации (когда выйдет в эфир). */
  @Index()
  @Column({ type: 'timestamp', nullable: true })
  publishDate: Date;

  /** Исполнитель — SMM-специалист / дизайнер. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigneeId' })
  assignee: User;

  @Column({ nullable: true })
  assigneeId: string;

  /** PM, отвечающий за позицию (обычно совпадает с менеджером проекта). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pmId' })
  pm: User;

  @Column({ nullable: true })
  pmId: string;

  @Index()
  @Column({ type: 'enum', enum: ContentPlanStatus, default: ContentPlanStatus.PLANNED })
  status: ContentPlanStatus;

  /** Ссылка на готовый файл (Google Drive, Figma, R2, и т.д.). */
  @Column({ type: 'text', nullable: true })
  fileLink: string;

  /** Подпись к публикации. */
  @Column({ type: 'text', nullable: true })
  caption: string;

  @Column({ type: 'enum', enum: ContentApprovalStatus, default: ContentApprovalStatus.PENDING })
  approvalStatus: ContentApprovalStatus;

  /** Свободные комментарии PM/исполнителя. Не путать с задачными комментариями. */
  @Column({ type: 'text', nullable: true })
  comments: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
