import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

/**
 * «Компас компании» (16.11.2026, docs/GOALS_SPEC.md §3): цели компании,
 * результаты (КР) компании и отделов, отметки недели, инициативы,
 * настройки и связь цели месяца сотрудника с КР. Плюс два типа уведомлений
 * (goal_checkin, goal_digest).
 *
 * Всё IF NOT EXISTS: GoalsService.onModuleInit дублирует эту схему, чтобы
 * сервер не падал, если миграция отстала. Поля повторяют goal.entity.ts.
 */
export class CompanyGoals1836000000000 implements MigrationInterface {
  name = 'CompanyGoals1836000000000';

  async up(q: QueryRunner): Promise<void> {
    for (const sql of COMPANY_GOALS_DDL) await q.query(sql);
    if (await q.hasTable('employee_goals')) {
      for (const sql of EMPLOYEE_GOALS_DDL) await q.query(sql);
    }
    // Значения enum типа уведомлений: имя типа берём из каталога
    // (migration-helpers) — на разных базах оно называется по-разному.
    if (await q.hasTable('notifications')) {
      await addEnumValues(q, 'notifications', 'type', ['goal_checkin', 'goal_digest']);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    // Значения enum в Postgres не удаляются — оставляем, они безвредны.
    await q.query(`DROP INDEX IF EXISTS "IDX_employee_goals_key_result"`);
    await q.query(`ALTER TABLE IF EXISTS employee_goals DROP COLUMN IF EXISTS "keyResultId"`);
    await q.query(`DROP TABLE IF EXISTS goal_initiatives`);
    await q.query(`DROP TABLE IF EXISTS goal_checkins`);
    await q.query(`DROP TABLE IF EXISTS goal_key_results`);
    await q.query(`DROP TABLE IF EXISTS goal_objectives`);
    await q.query(`DROP TABLE IF EXISTS goal_settings`);
  }
}

/** Схема таблиц компаса — общая для миграции и GoalsService.onModuleInit. */
export const COMPANY_GOALS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS goal_objectives (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     ym varchar(7) NOT NULL,
     title varchar(200) NOT NULL,
     "ownerId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
     "sortOrder" int NOT NULL DEFAULT 0,
     "createdById" uuid NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "updatedAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_goal_objectives_ym" ON goal_objectives (ym)`,

  `CREATE TABLE IF NOT EXISTS goal_key_results (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     ym varchar(7) NOT NULL,
     level varchar(16) NOT NULL,
     department varchar(16) NULL,
     "objectiveId" uuid NULL REFERENCES goal_objectives(id) ON DELETE CASCADE,
     "parentId" uuid NULL REFERENCES goal_key_results(id) ON DELETE SET NULL,
     title varchar(200) NOT NULL,
     source varchar(40) NOT NULL DEFAULT 'manual',
     "sourceParams" jsonb NOT NULL DEFAULT '{}',
     target numeric(15,2) NOT NULL,
     unit varchar(12) NOT NULL DEFAULT 'count',
     "manualValue" numeric(15,2) NULL,
     "ownerId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
     "sortOrder" int NOT NULL DEFAULT 0,
     "createdById" uuid NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "updatedAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_goal_key_results_ym" ON goal_key_results (ym)`,
  `CREATE INDEX IF NOT EXISTS "IDX_goal_key_results_ym_dept" ON goal_key_results (ym, department)`,
  `CREATE INDEX IF NOT EXISTS "IDX_goal_key_results_parent" ON goal_key_results ("parentId")`,

  `CREATE TABLE IF NOT EXISTS goal_checkins (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "keyResultId" uuid NOT NULL REFERENCES goal_key_results(id) ON DELETE CASCADE,
     "weekStart" date NOT NULL,
     status varchar(12) NOT NULL,
     comment text NULL,
     "userId" uuid NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "updatedAt" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "UQ_goal_checkins_kr_week" UNIQUE ("keyResultId", "weekStart")
   )`,

  `CREATE TABLE IF NOT EXISTS goal_initiatives (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "keyResultId" uuid NOT NULL REFERENCES goal_key_results(id) ON DELETE CASCADE,
     kind varchar(12) NOT NULL,
     "refId" uuid NOT NULL,
     "createdById" uuid NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "UQ_goal_initiatives_kr_ref" UNIQUE ("keyResultId", kind, "refId")
   )`,

  `CREATE TABLE IF NOT EXISTS goal_settings (
     key varchar(40) PRIMARY KEY,
     value jsonb NOT NULL,
     "updatedById" uuid NULL,
     "updatedAt" timestamptz NOT NULL DEFAULT now()
   )`,
];

/** Связь цели месяца сотрудника с КР (после goal_key_results). */
export const EMPLOYEE_GOALS_DDL: string[] = [
  `ALTER TABLE employee_goals ADD COLUMN IF NOT EXISTS "keyResultId" uuid NULL
     REFERENCES goal_key_results(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS "IDX_employee_goals_key_result" ON employee_goals ("keyResultId")`,
];
