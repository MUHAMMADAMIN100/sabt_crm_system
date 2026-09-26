import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';

/** События доски, на которые можно подписать вебхук (контракт E).
 *  Подписка срабатывает, только если событие входит в её events. */
export const DEV_WEBHOOK_EVENTS = [
  'task.created',
  'task.moved',
  'task.done',
  'task.commented',
] as const;
export type DevWebhookEvent = (typeof DEV_WEBHOOK_EVENTS)[number];

/** Подписка на вебхуки доски разработки (outbox, контракт E).
 *  projectId null = подписаны все проекты; иначе — только задачи этого
 *  проекта. Удаление проекта отвязывает подписку (SET NULL), а не сносит. */
@Entity('dev_webhook_subscription')
export class DevWebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  project: Project;

  @Column({ nullable: true })
  projectId: string | null;

  /** http(s)-URL приёмника, ≤2000 символов. Протокол валидирует сервис. */
  @Column({ type: 'varchar', length: 2000 })
  url: string;

  /** Секрет для HMAC-подписи X-Dev-Signature. null = без подписи. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  secret: string | null;

  /** Подмножество DEV_WEBHOOK_EVENTS. */
  @Column({ type: 'text', array: true, default: '{}' })
  events: string[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  createdBy: User;

  @Column({ nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
