import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Этапы производственного процесса SMM-проекта (колонки канбана
 *  «Процесс работы»). Порядок массива = порядок колонок на доске. */
export const WORKFLOW_STAGES = [
  'content_plan',     // Контент-план
  'organization',     // Организация
  'shooting',         // Съёмка
  'editing',          // Монтаж
  'design',           // Дизайн
  'internal_review',  // Внутренняя проверка
  'client_approval',  // Согласование с клиентом
  'ready_to_publish', // Готово к публикации
  'published',        // Опубликовано
  'ads',              // Реклама
] as const;

export type WorkflowStage = typeof WORKFLOW_STAGES[number];

/** Карточка процесса работы — единица контента, движущаяся по этапам
 *  производства (контент-план → съёмка → монтаж → ... → реклама).
 *  Живёт внутри SMM-проекта, перетаскивается между колонками. */
@Entity('workflow_cards')
export class WorkflowCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Тип контента: reel / post / carousel / story / design / other. */
  @Column({ nullable: true })
  contentType: string | null;

  @Column({ type: 'date', nullable: true })
  deadline: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigneeId' })
  assignee: User | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  /** Этап (колонка доски). */
  @Column({ default: 'content_plan' })
  stage: string;

  /** Порядок внутри колонки (меньше — выше). */
  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
