import { MigrationInterface, QueryRunner } from 'typeorm';

/** Спринты и сохранённые представления доски (контракты D/H).
 *  dev_sprint: status — varchar('active'|'done'), а не pg-enum, чтобы миграция
 *  оставалась идемпотентной без CREATE TYPE. dev_board_view: filters — JSONB
 *  default '{}' (бэк хранит непрозрачно). dev_tasks.sprintId — nullable FK
 *  dev_sprint SET NULL + индекс. FK добавляем через DO-блок (у ADD CONSTRAINT
 *  нет IF NOT EXISTS) — проверяем pg_constraint по имени. */
export class AddDevSprintAndViews1807000000000 implements MigrationInterface {
  name = 'AddDevSprintAndViews1807000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_sprint" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name"        varchar(120) NOT NULL,
        "goal"        text NULL,
        "startDate"   TIMESTAMP NOT NULL,
        "endDate"     TIMESTAMP NOT NULL,
        "status"      varchar(20) NOT NULL DEFAULT 'active',
        "createdById" uuid NULL
          REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_sprint" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_board_view" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ownerId"   uuid NOT NULL
          REFERENCES "users"("id") ON DELETE CASCADE,
        "name"      varchar(100) NOT NULL,
        "filters"   jsonb NOT NULL DEFAULT '{}',
        "groupBy"   varchar(20) NOT NULL DEFAULT 'status',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_board_view" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ADD COLUMN IF NOT EXISTS "sprintId" uuid NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_dev_tasks_sprint') THEN
          ALTER TABLE "dev_tasks" ADD CONSTRAINT "FK_dev_tasks_sprint"
            FOREIGN KEY ("sprintId") REFERENCES "dev_sprint"("id") ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dev_tasks_sprint" ON "dev_tasks" ("sprintId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dev_board_view_owner" ON "dev_board_view" ("ownerId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_board_view_owner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_tasks_sprint"`);
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP CONSTRAINT IF EXISTS "FK_dev_tasks_sprint"`);
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "sprintId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_board_view"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_sprint"`);
  }
}
