import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * «Компас компании» (16.11.2026, docs/GOALS_SPEC.md §3): цели компании,
 * результаты (КР) компании и отделов, отметки недели, инициативы и
 * настройки. Таблицы создаёт миграция 1836000000000-CompanyGoals (и
 * дублирует GoalsService.onModuleInit). Связи — простые uuid, как в
 * «Финансах»: внешние ключи живут в миграции.
 */

/** numeric из Postgres приходит строкой — отдаём числом. */
const numeric = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v)),
};

/** Цель компании на месяц — качественная формулировка. */
@Entity('goal_objectives')
@Index(['ym'])
export class GoalObjective {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Месяц: YYYY-MM. */
  @Column({ type: 'varchar', length: 7 })
  ym: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Результат (КР): компании (objectiveId) или отдела (department, parentId). */
@Entity('goal_key_results')
@Index(['ym'])
@Index(['ym', 'department'])
@Index(['parentId'])
export class GoalKeyResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 7 })
  ym: string;

  /** company | department */
  @Column({ type: 'varchar', length: 16 })
  level: string;

  /** Ключ отдела; у КР компании — null. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  department: string | null;

  /** Цель компании — только у КР компании. */
  @Column({ type: 'uuid', nullable: true })
  objectiveId: string | null;

  /** КР компании, на который работает КР отдела. */
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Ключ источника цифры (goal-sources.ts). */
  @Column({ type: 'varchar', length: 40, default: 'manual' })
  source: string;

  /** { direction?, department?, kpiKey? } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  sourceParams: Record<string, string>;

  @Column({ type: 'numeric', precision: 15, scale: 2, transformer: numeric })
  target: number;

  /** money | count | percent */
  @Column({ type: 'varchar', length: 12, default: 'count' })
  unit: string;

  /** Цифра «вручную» — только у source = manual. */
  @Column({ type: 'numeric', precision: 15, scale: 2, nullable: true, transformer: numeric })
  manualValue: number | null;

  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Отметка недели руководителя: в графике / риск / отстаём. */
@Entity('goal_checkins')
@Index(['keyResultId', 'weekStart'], { unique: true })
export class GoalCheckin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  keyResultId: string;

  /** Понедельник недели по Душанбе. */
  @Column({ type: 'date' })
  weekStart: string;

  /** on_track | at_risk | off_track */
  @Column({ type: 'varchar', length: 12 })
  status: string;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** «Что работает на результат»: проект или задача. */
@Entity('goal_initiatives')
@Index(['keyResultId', 'kind', 'refId'], { unique: true })
export class GoalInitiative {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  keyResultId: string;

  /** project | task */
  @Column({ type: 'varchar', length: 12 })
  kind: string;

  @Column({ type: 'uuid' })
  refId: string;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Настройки компаса: ключ → jsonb (leaders — руководители отделов). */
@Entity('goal_settings')
export class GoalSetting {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  key: string;

  @Column({ type: 'jsonb' })
  value: any;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
