import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет поле "scope" к задачам.
 *  - personal — личная (видна только создателю)
 *  - business — бизнес-задача (default)
 *  - general  — общая для всей компании
 *
 *  Используется в основном основателем/сооснователем для быстрых задач
 *  из календаря. Для совместимости все существующие задачи получают
 *  scope='business'. */
export class AddTaskScope1747600000000 implements MigrationInterface {
  name = 'AddTaskScope1747600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tasks_scope_enum" AS ENUM ('personal', 'business', 'general');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "scope" "tasks_scope_enum" NOT NULL DEFAULT 'business'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_scope" ON "tasks" ("scope")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_scope"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "scope"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tasks_scope_enum"`);
  }
}
