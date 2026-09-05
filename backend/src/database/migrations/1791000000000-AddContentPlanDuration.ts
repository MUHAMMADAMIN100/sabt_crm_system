import { MigrationInterface, QueryRunner } from 'typeorm';

/** Длительность съёмки в минутах (умный СММ-календарь) — высота карточки и
 *  превью при перетаскивании. null = по умолчанию 60 мин. */
export class AddContentPlanDuration1791000000000 implements MigrationInterface {
  name = 'AddContentPlanDuration1791000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_plan_items"
      ADD COLUMN IF NOT EXISTS "durationMin" int NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "content_plan_items" DROP COLUMN IF EXISTS "durationMin"`);
  }
}
