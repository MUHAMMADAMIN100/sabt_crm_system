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
