import { MigrationInterface, QueryRunner } from 'typeorm';

/** Wave 3: расширение задач — новые статусы пайплайна + поля контроля
 *  качества (reviewer, rework count, quality score, delivery type и т.д.). */
export class ExtendTasksWithQualityFields1746200000000 implements MigrationInterface {
  name = 'ExtendTasksWithQualityFields1746200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Расширяем enum статусов задач. Добавляем новые значения,
    //    старые остаются. Имя enum-а исторически встречается в двух
    //    вариантах (task_status_enum / tasks_status_enum) — пробуем оба.
    const newStatuses = [
      'accepted',
      'on_pm_review',
      'on_rework',
      'on_client_approval',
      'approved',
      'published',
      'rescheduled',
    ];
    const enumNames = ['task_status_enum', 'tasks_status_enum'];
    for (const enumName of enumNames) {
      for (const value of newStatuses) {
        try {
          await queryRunner.query(`ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}'`);
        } catch (e) {
          // enum may not exist under this name — skip silently
        }
      }
    }

    // 2. Новые колонки в tasks (все nullable / с дефолтами — старые задачи целы).
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewerId" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reworkCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "qualityScore" integer NULL`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "acceptedOnFirstTry" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "actualCompletionHours" DECIMAL(10, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deliveryType" varchar NULL`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deletionReason" text NULL`);

    // 3. FK reviewer → users (на SET NULL, чтобы удаление user не валило задачу).
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "tasks"
        ADD CONSTRAINT "FK_tasks_reviewer"
        FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // 4. Индексы для аналитики качества.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_reviewer" ON "tasks" ("reviewerId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_quality" ON "tasks" ("qualityScore")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_delivery" ON "tasks" ("deliveryType")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_delivery"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_quality"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_reviewer"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_reviewer"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "deletionReason"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "deliveryType"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "actualCompletionHours"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "acceptedOnFirstTry"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "qualityScore"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "reworkCount"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "reviewerId"`);
    // Enum values cannot be removed from PostgreSQL without recreating the type
  }
}
