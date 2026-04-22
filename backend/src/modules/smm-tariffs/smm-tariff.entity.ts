import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('smm_tariffs')
export class SmmTariff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /** Стоимость в месяц (сомони) */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  monthlyPrice: number;

  @Column({ default: 0 })
  storiesPerMonth: number;

  @Column({ default: 0 })
  reelsPerMonth: number;

  @Column({ default: 0 })
  postsPerMonth: number;

  @Column({ default: 0 })
  designsPerMonth: number;

  @Column({ default: false })
  adsIncluded: boolean;

  @Column({ default: 0 })
  shootingDaysPerMonth: number;

  @Column({ default: 0 })
  reportsPerMonth: number;

  /** Лимит правок на единицу контента (0 = без лимита) */
  @Column({ default: 0 })
  revisionLimit: number;

  /** Длительность тарифа в днях (по умолчанию 30) */
  @Column({ default: 30 })
  durationDays: number;

  @Index()
  @Column({ default: true })
  isActive: boolean;

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
