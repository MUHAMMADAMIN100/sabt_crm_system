import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { DevWebhookSubscription } from './dev-webhook-subscription.entity';

/** Попытка доставки вебхука доски (outbox-журнал, контракт E).
 *  Одна строка на событие-подписку: ретраи обновляют её status/error,
 *  а не плодят строки. status: HTTP-код последней попытки, 0 — сеть
 *  упала до ответа. Читается через GET /dev-tracker/webhooks/:id/deliveries
 *  (последние 20, DESC). Удаление подписки сносит журнал (CASCADE). */
@Entity('dev_webhook_delivery')
export class DevWebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DevWebhookSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription: DevWebhookSubscription;

  @Column()
  subscriptionId: string;

  @Column({ type: 'varchar', length: 50 })
  event: string;

  /** Плоский payload (см. buildDevPayload в сервисе): top-level поля
   *  event/taskId/title/status/priority/assignee/assigneeId/deadline/
   *  projectId/project/url/at. */
  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'int', default: 0 })
  status: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
