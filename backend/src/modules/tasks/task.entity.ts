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

/** Статусы задач — упрощены до 4 значений (Wave 11).
 *  - NEW         — задача создана, ещё не взята в работу
 *  - IN_PROGRESS — в активной работе (включая прошлые «accepted/review/on_pm_review/
 *                  on_rework/on_client_approval/approved/returned/rescheduled»)
 *  - DONE        — выполнена и принята (включая прошлые «published»)
 *  - CANCELLED   — отменена
 *
 *  Старые промежуточные статусы (review/approval/rework) больше не нужны —
 *  любые попытки прислать их с фронта отвергаются маппером в tasks.service.
 *  Существующие в БД строки мигрированы в одно из четырёх значений. */
export enum TaskStatus {
  NEW         = 'new',
  IN_PROGRESS = 'in_progress',
  DONE        = 'done',
  CANCELLED   = 'cancelled',
}

/** Маппинг легаси-статусов в новую модель. Используется в tasks.service для
 *  нормализации входных значений (на случай если старый клиент пришлёт
 *  «published» / «approved» — мы конвертируем сами). */
export const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  // active variants → IN_PROGRESS
  accepted:           TaskStatus.IN_PROGRESS,
  review:             TaskStatus.IN_PROGRESS,
  on_pm_review:       TaskStatus.IN_PROGRESS,
  on_rework:          TaskStatus.IN_PROGRESS,
  on_client_approval: TaskStatus.IN_PROGRESS,
  approved:           TaskStatus.IN_PROGRESS,
  returned:           TaskStatus.IN_PROGRESS,
  rescheduled:        TaskStatus.IN_PROGRESS,
  // finalised → DONE
  published:          TaskStatus.DONE,
};

/** Нормализатор статуса: новые значения возвращаются как есть, легаси
 *  мапятся в одно из четырёх. */
export function normalizeStatus(s: string | TaskStatus): TaskStatus {
  if ((Object.values(TaskStatus) as string[]).includes(s)) return s as TaskStatus;
  return LEGACY_STATUS_MAP[s] || TaskStatus.NEW;
}

/** Статусы, при которых задача НЕ считается «просроченной».
 *  Только финальные: DONE и CANCELLED. */
export const TASK_CLOSED_FOR_OVERDUE: TaskStatus[] = [
  TaskStatus.DONE,
  TaskStatus.CANCELLED,
];

/** Скоуп задачи — категория видимости.
 *  - PERSONAL — личная заметка/задача создателя. Видна ТОЛЬКО ему, никому
 *    не отправляются уведомления, не показывается в чужих списках/календарях.
 *  - BUSINESS — бизнес-задача (для команды/проекта). Поведение по умолчанию.
 *  - GENERAL — общая задача (может видеть вся компания при подходящих ролях).
 *
 *  Используется в основном основателем/сооснователем для быстрых задач из
 *  календаря. Для обычных задач из проектов поле автоматически = BUSINESS.
 */
export enum TaskScope {
  PERSONAL = 'personal',
  BUSINESS = 'business',
  GENERAL  = 'general',
}

/** Вид записи в календаре: рабочая задача с дедлайном или встреча в
 *  конкретное время. Различие видно и в календаре, и в напоминаниях. */
export enum TaskKind {
  TASK    = 'task',
  MEETING = 'meeting',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => Project, project => project.tasks, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn()
  project: Project;

  /** Может быть NULL для прямых задач от основателя/сооснователя —
   *  их быстрая форма "добавить задачу" из календаря не запрашивает проект. */
  @Column({ nullable: true })
  projectId: string;

  /** Флаг что задача создана через быструю форму "от основателя". Поднимает
   *  приоритет уведомления (email + telegram + in-app со специальным
   *  текстом) и позволяет фильтровать direct-задачи в дашборде. */
  @Column({ default: false })
  fromFounder: boolean;

  /** Скоуп задачи (личная / бизнес / общая). См. enum TaskScope.
   *  Личные задачи видны ТОЛЬКО создателю — это его приватные заметки. */
  @Column({ type: 'enum', enum: TaskScope, default: TaskScope.BUSINESS })
  scope: TaskScope;

  /** Вид записи: обычная задача или встреча. У встречи в календаре свой
   *  значок, а в напоминаниях другой текст («Встреча в 15:00», а не
   *  «дедлайн»). Тип varchar, а не enum: на проде synchronize выключен,
   *  и добавить значение в enum сложнее, чем прожить со строкой. */
  @Column({ type: 'varchar', length: 16, default: TaskKind.TASK })
  kind: TaskKind;

  /** Место встречи — свободный текст: адрес, «Zoom», «офис, 2 этаж».
   *  Для обычных задач NULL. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  location: string | null;

  /** Этап онбординга клиента, из которого автогенерирована задача.
   *  Значения: negotiation / meeting / kp_creation / contract / implementation.
   *  Для обычных (ручных) задач — NULL. Используется, чтобы скрывать
   *  КП-задачи из общих списков задач/календаря — они нужны только в
   *  Онбординге на соответствующей колонке. */
  @Column({ type: 'varchar', nullable: true })
  originStage: string | null;

  /** Этап доски «Разработка» (1..6, [10%] ТЗ → [100%] Внедрение) — задача
   *  создана как карточка этапа через «+» на dev-доске и видна в её колонке.
   *  NULL — обычная задача, на доске не показывается. */
  @Column({ type: 'int', nullable: true })
  devStage: number | null;

  /** Технические детали для задач разработки. JSON чтобы не плодить
   *  колонки и легко расширять — теперь включает все нужные dev-ссылки. */
  @Column({ type: 'jsonb', nullable: true })
  techMeta: {
    repoUrl?: string;
    branch?: string;
    prUrl?: string;
    liveUrl?: string;       // production URL
    stagingUrl?: string;    // staging/preview deploy
    localDevPort?: string;  // port для локального запуска
    sentryUrl?: string;     // Sentry/error tracker URL
    ciStatusUrl?: string;   // badge URL для CI (например GitHub Actions)
  };

  /** Критерии приёмки (Definition of Done). PM пишет — dev отмечает
   *  выполнение. Задачу нельзя закрыть пока не все критерии выполнены. */
  @Column({ type: 'jsonb', nullable: true })
  acceptanceCriteria: Array<{
    id: string;
    text: string;
    done: boolean;
    doneBy?: string;
    doneAt?: string;
  }>;

  /** Story points для оценки сложности задачи (1/2/3/5/8/13 Fibonacci
   *  или 0 = не оценено). Альтернатива estimatedHours для размытых задач. */
  @Column({ type: 'int', nullable: true })
  storyPoints: number;

  /** Технические теги: frontend, backend, bug, feature, refactor,
   *  optimization, tech-debt, urgent. Хранится как массив строк. */
  @Column({ type: 'text', array: true, nullable: true })
  tags: string[];

  /** ID задач которые блокируются этой (текущая блокирует те).
   *  Хранится массивом UUID для простоты, без отдельной join-таблицы. */
  @Column({ type: 'uuid', array: true, nullable: true })
  blocksTaskIds: string[];

  /** ID задач которые блокируют эту (текущая ждёт их завершения). */
  @Column({ type: 'uuid', array: true, nullable: true })
  blockedByTaskIds: string[];

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

  /** Когда задачу ФАКТИЧЕСКИ закрыли. Нужен KPI: без него «в срок или нет»
   *  считалось по времени последнего изменения записи, и любая поздняя правка
   *  задним числом превращала сданное вовремя в просрочку. Сбрасывается,
   *  если задачу переоткрыли. */
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

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
