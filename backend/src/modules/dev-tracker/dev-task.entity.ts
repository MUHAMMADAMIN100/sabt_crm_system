import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { DevTaskComment } from './dev-task-comment.entity';
import { DevSprint } from './dev-sprint.entity';

/** Статусы = колонки канбан-доски «Dev-tracker».
 *  Порядок значений в enum совпадает с порядком колонок на доске —
 *  это используется при сортировке (см. dev-tasks.service.findAll). */
export enum DevTaskStatus {
  BACKLOG     = 'backlog',
  TODO        = 'todo',
  IN_PROGRESS = 'in_progress',
  IN_REVIEW   = 'in_review',
  TESTING     = 'testing',
  DONE        = 'done',
}

export enum DevTaskPriority {
  LOW      = 'low',
  MEDIUM   = 'medium',
  HIGH     = 'high',
  CRITICAL = 'critical',
}

/** Тип задачи: новая фича, баг, улучшение существующего или техдолг.
 *  Нужен для фильтров на доске и аналитики «сколько времени уходит
 *  на баги против фич». */
export enum DevTaskType {
  FEATURE     = 'feature',
  BUG         = 'bug',
  IMPROVEMENT = 'improvement',
  TECH_DEBT   = 'tech_debt',
}

/** Задача разработки на доске dev-tracker (Jira/Notion-style).
 *  Отдельная сущность от tasks: там задачи производства контента со своим
 *  workflow и скоупами видимости, здесь — внутренняя доска команды
 *  разработки с канбан-порядком карточек и story points. */
@Entity('dev_tasks')
export class DevTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'enum', enum: DevTaskStatus, default: DevTaskStatus.BACKLOG })
  status: DevTaskStatus;

  @Column({ type: 'enum', enum: DevTaskPriority, default: DevTaskPriority.MEDIUM })
  priority: DevTaskPriority;

  @Column({ type: 'enum', enum: DevTaskType, default: DevTaskType.FEATURE })
  taskType: DevTaskType;

  /** Порядок карточки внутри колонки канбана. Меняется drag-and-drop'ом
   *  через endpoint move — поэтому хранится числом, а не вычисляется. */
  @Column({ type: 'int', default: 0 })
  position: number;

  /** Оценка в story points (1/2/3/5/8/13). 0 = не оценено. */
  @Column({ type: 'int', default: 0 })
  storyPoints: number;

  /** Свободные теги (frontend/backend/urgent/...) для фильтров на доске. */
  @Column({ type: 'text', array: true, nullable: true })
  tags: string[];

  /** Вложения задачи — массив URL (фронт шлёт через PATCH {attachments}).
   *  text[] default '{}': задача без вложений отдаёт [], а не null. */
  @Column({ type: 'text', array: true, default: '{}' })
  attachments: string[];

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date;

  /** Дата начала работы над задачей (контракт B). Nullable: null = не задана.
   *  Патчится через PATCH /dev-tracker/:id {startDate} (IsDateString). */
  @Column({ type: 'timestamp', nullable: true })
  startDate: Date | null;

  /** Блокер задачи (контракт A). isBlocked — флаг для фильтра ?blocked=true,
   *  blockedReason — причина (trim, max 500). Снимается bulk 'blocked' со
   *  значением '' или PATCH {isBlocked:false}. */
  @Column({ type: 'boolean', default: false })
  isBlocked: boolean;

  @Column({ type: 'text', nullable: true })
  blockedReason: string | null;

  /** Когда задачу ФАКТИЧЕСКИ перевели в DONE. Ставится в move(), сбрасывается
   *  при переоткрытии — без этого KPI «в срок/не в срок» считался бы по
   *  updatedAt и любая поздняя правка искажала бы метрику. */
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn()
  assignee: User;

  @Column({ nullable: true })
  assigneeId: string;

  /** Проект раздела «Разработка», к которому относится задача
   *  (/dev/projects/:id ↔ канбан-доска). Не eager: имя проекта подгружаем
   *  частично (id/name/projectType) в сервисе, чтобы не тянуть весь проект. */
  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  project: Project;

  @Column({ nullable: true })
  projectId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn()
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  /** Спринт доски (контракт H). null = задача в backlog'е вне спринтов.
   *  Удаление спринта отвязывает задачи (SET NULL), а не сносит их. */
  @ManyToOne(() => DevSprint, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  sprint: DevSprint | null;

  @Column({ type: 'uuid', nullable: true })
  sprintId: string | null;

  /** Родительская задача для подзадачи (вложенность максимум 1 уровень).
   *  НЕ eager: иначе подзадача тянула бы за собой родителя, родитель — свои
   *  eager-связи, и сериализация ответа могла уйти вглубь. Родитель нужен
   *  только для проверок при create/update, поэтому грузим его точечно. */
  @ManyToOne(() => DevTask, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parentTaskId' })
  parent: DevTask | null;

  /** id родительской задачи. null — задача верхнего уровня (или подзадача,
   *  отсоединённая от родителя). */
  @Column({ type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @OneToMany(() => DevTaskComment, comment => comment.task)
  comments: DevTaskComment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
