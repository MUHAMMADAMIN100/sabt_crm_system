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

  /** Несколько исполнителей (напр. несколько видеографов на рилс).
   *  assigneeId — основной (первый из списка) для совместимости/аватара. */
  @Column({ type: 'jsonb', nullable: true })
  assigneeIds: string[] | null;

  /** Монтажёры, выбранные ЗАРАНЕЕ на карточке «Съёмка» (роль video_editor).
   *  При переходе Съёмка → Монтаж они становятся исполнителями карточки
   *  (assigneeIds), поэтому на карточке монтажа сразу видны выбранные люди. */
  @Column({ type: 'jsonb', nullable: true })
  editorIds: string[] | null;

  /** Этап (колонка доски). */
  @Column({ default: 'content_plan' })
  stage: string;

  /** Порядок внутри колонки (меньше — выше). */
  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  /** Кто создал/заполнил карточку (для отображения на карточке). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  // ─── Workflow-движок (ТЗ §6/§9): тип маршрута, под-карточки, статусы ───

  /** Тип единицы контента / маршрут:
   *   'reels'  — рилс: content_plan→organization→shooting→editing→(join)→…
   *   'static' — статичный макет: content_plan→design→…
   *   'cover'  — под-карточка «Обложка/заставка» рилса (живёт в DESIGN,
   *              привязана к родительскому рилсу через parentCardId).
   *  null — старые карточки до внедрения движка (ведут себя как раньше). */
  @Column({ type: 'varchar', nullable: true })
  type: 'reels' | 'static' | 'cover' | null;

  /** Для type='cover' — id родительского рилса. */
  @Column({ type: 'uuid', nullable: true })
  parentCardId: string | null;

  /** Статус единицы: active | rework | waiting_cover | published | done. */
  @Column({ type: 'varchar', default: 'active' })
  status: string;

  /** Рилсу нужна обложка / заставка (по умолчанию обе вкл). */
  @Column({ type: 'boolean', default: true })
  needsCover: boolean;

  @Column({ type: 'boolean', default: true })
  needsIntro: boolean;

  /** Готовность веток join-гейта (монтаж + дизайн обложки). */
  @Column({ type: 'boolean', default: false })
  editingDone: boolean;

  @Column({ type: 'boolean', default: false })
  designDone: boolean;

  /** Ссылки на материалы по этапам. */
  @Column({ type: 'text', nullable: true })
  rawFootageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  finalCutUrl: string | null;

  @Column({ type: 'text', nullable: true })
  finalAssetUrl: string | null;

  @Column({ type: 'text', nullable: true })
  coverUrl: string | null;

  @Column({ type: 'text', nullable: true })
  introUrl: string | null;

  @Column({ type: 'text', nullable: true })
  publishedUrl: string | null;

  /** Целевая дата публикации — основа обратного планирования дедлайнов. */
  @Column({ type: 'date', nullable: true })
  publishDate: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  publishedAt: Date | null;

  /** Организация съёмки (только рилсы). */
  @Column({ type: 'date', nullable: true })
  shootDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  shootTime: string | null;

  @Column({ type: 'varchar', nullable: true })
  shootLocation: string | null;

  @Column({ type: 'uuid', nullable: true })
  shootSessionId: string | null;

  /** Комментарии возврата на доработку / правок клиента. */
  @Column({ type: 'text', nullable: true })
  reworkComment: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  sentToClientAt: Date | null;

  @Column({ type: 'text', nullable: true })
  clientComment: string | null;

  /** Дедлайны этапов от publishDate (§11): { organization: 'YYYY-MM-DD', ... }. */
  @Column({ type: 'jsonb', nullable: true })
  stageDeadlines: Record<string, string> | null;

  // ─── Контент-план как групповая карточка (новая модель) ───────────────

  /** Вид карточки:
   *   'kp'     — карточка-инструкция «Контент-план» проекта (остаётся в
   *              content_plan, не перетаскивается; внутри все рилсы+макеты).
   *   'reels'  — рабочая карточка «Рилсы» (внутри items всех рилсов проекта).
   *   'macros' — рабочая карточка «Макеты» (внутри items всех макетов).
   *   null     — обычная одиночная карточка (легаси/прочее). */
  @Column({ type: 'varchar', nullable: true })
  kind: 'kp' | 'reels' | 'macros' | null;

  /** Элементы группы (JSONB). Каждый item:
   *   { id, itemKind: 'reel'|'macro', title, publishDate, description,
   *     assigneeId, shootDate, shootTime, shootLocation }.
   *  Для kp — все (рилсы+макеты), для reels/macros — свои. */
  @Column({ type: 'jsonb', nullable: true })
  items: any[] | null;

  /** КП подтверждён (нажали «Сохранить») — зелёная точка на карточке. */
  @Column({ type: 'boolean', default: false })
  confirmed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
