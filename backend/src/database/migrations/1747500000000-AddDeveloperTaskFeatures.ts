import { MigrationInterface, QueryRunner } from 'typeorm';

/** Большая пачка dev-фич для задач:
 *  - acceptanceCriteria (jsonb) — структурированный Definition of Done.
 *  - storyPoints (int) — оценка сложности (1/2/3/5/8/13).
 *  - tags (text[]) — категоризация: frontend/backend/bug/feature/etc.
 *  - blocksTaskIds (uuid[]) — задачи которые эта блокирует.
 *  - blockedByTaskIds (uuid[]) — задачи блокирующие эту.
 *  techMeta (jsonb) уже существует и расширяется на стороне приложения
 *  новыми полями (stagingUrl, sentryUrl, ciStatusUrl и т.д.) — миграция
 *  колонки не требуется т.к. jsonb. */
export class AddDeveloperTaskFeatures1747500000000 implements MigrationInterface {
  name = 'AddDeveloperTaskFeatures1747500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "acceptanceCriteria" jsonb NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "storyPoints" int NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "tags" text[] NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "blocksTaskIds" uuid[] NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "blockedByTaskIds" uuid[] NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "blockedByTaskIds"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "blocksTaskIds"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "tags"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "storyPoints"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "acceptanceCriteria"`);
  }
}
