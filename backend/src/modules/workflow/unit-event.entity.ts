import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** Журнал событий единицы контента (workflow-карточки): каждый переход
 *  по этапам, назначение, доработка и т.д. (ТЗ §6 UnitEvent / §10 R15).
 *  Отображается в карточке «Готово к публикации» как полная история. */
@Entity('unit_events')
@Index(['cardId', 'createdAt'])
export class UnitEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Карточка (workflow_cards.id). */
  @Column({ type: 'uuid' })
  cardId: string;

  /** Действие/событие: stage_enter, confirm_plan, confirm_shoot, assign,
   *  shoot_done, editing_done, cover_done, layout_done, qa_accept,
   *  qa_rework, client_approve, client_revisions, publish, ad_started. */
  @Column({ type: 'varchar' })
  action: string;

  @Column({ type: 'varchar', nullable: true })
  fromStage: string | null;

  @Column({ type: 'varchar', nullable: true })
  toStage: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorName: string | null;

  /** Человекочитаемое описание события для истории карточки. */
  @Column({ type: 'text', nullable: true })
  message: string | null;

  /** Комментарий (для доработки/правок клиента). */
  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
