import { MigrationInterface, QueryRunner } from 'typeorm';

/** Связь авто-съёмки с рилсом (умный СММ-календарь): shootForItemId = id рилса.
 *  Если задано — позиция является съёмкой (двигается независимо, удаляется вместе с рилсом). */
export class AddContentPlanShootLink1792000000000 implements MigrationInterface {
  name = 'AddContentPlanShootLink1792000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_plan_items"
      ADD COLUMN IF NOT EXISTS "shootForItemId" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_content_plan_items_shootForItemId"
      ON "content_plan_items" ("shootForItemId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_plan_items_shootForItemId"`);
    await queryRunner.query(`ALTER TABLE "content_plan_items" DROP COLUMN IF EXISTS "shootForItemId"`);
  }
}
