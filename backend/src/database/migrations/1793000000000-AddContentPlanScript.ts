import { MigrationInterface, QueryRunner } from 'typeorm';

/** Поле «Сценарий» позиции контент-плана (scriptText) — текст ролика/раскадровка,
 *  отдельно от подписи (caption) и рабочих комментариев (comments). */
export class AddContentPlanScript1793000000000 implements MigrationInterface {
  name = 'AddContentPlanScript1793000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_plan_items"
      ADD COLUMN IF NOT EXISTS "scriptText" text NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "content_plan_items" DROP COLUMN IF EXISTS "scriptText"`);
  }
}
