import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

export enum BudgetSource {
  COMPANY = 'company',
  CLIENT  = 'client',
}

export enum AdChannel {
  INSTAGRAM = 'instagram',
  TIKTOK    = 'tiktok',
  FACEBOOK  = 'facebook',
  YOUTUBE   = 'youtube',
  TELEGRAM  = 'telegram',
  GOOGLE    = 'google',
  OTHER     = 'other',
}

/** Статус рекламной кампании (ТЗ §9.9). */
export enum AdStatus {
  PLANNED  = 'planned',
  RUNNING  = 'running',
  FINISHED = 'finished',
}

@Entity('project_ads')
export class ProjectAd {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: string;

  @Column()
  title: string;

  @Column({ type: 'enum', enum: AdChannel, default: AdChannel.INSTAGRAM })
  channel: AdChannel;

  /** Рекламный бюджет в сомони */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  budget: number;

  /** Кто платит за рекламу: company = наша компания, client = клиент */
  @Column({ type: 'enum', enum: BudgetSource, default: BudgetSource.CLIENT })
  budgetSource: BudgetSource;

  /** Дневной бюджет кампании (ТЗ §9.9). budget = общий бюджет. */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  dailyBudget: number | null;

  /** Статус кампании: planned → running → finished. */
  @Column({ type: 'varchar', default: 'planned' })
  status: string;

  /** Таргетолог (ответственный за кампанию). */
  @Column({ type: 'uuid', nullable: true })
  targetologistId: string | null;

  /** Связанная workflow-карточка (если запущена с доски). */
  @Column({ type: 'uuid', nullable: true })
  cardId: string | null;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({ type: 'text', nullable: true })
  note: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
