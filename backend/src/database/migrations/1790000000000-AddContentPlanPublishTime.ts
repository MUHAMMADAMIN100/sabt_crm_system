import { MigrationInterface, QueryRunner } from 'typeorm';

/** Время съёмки в умном СММ-календаре ('HH:MM') — отдельно от Доски проектов,
 *  tz-безопасно (varchar). null = элемент в «Весь день». */
export class AddContentPlanPublishTime1790000000000 implements MigrationInterface {
  name = 'AddContentPlanPublishTime1790000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_plan_items"
      ADD COLUMN IF NOT EXISTS "publishTime" varchar(5) NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "content_plan_items" DROP COLUMN IF EXISTS "publishTime"`);
  }
}
