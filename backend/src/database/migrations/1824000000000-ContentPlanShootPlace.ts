import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Съёмки (07.11.2026): «Другое место» у отдельной съёмки — если снимают не
 * по адресу проекта. Сам адрес проекта лежит в smmData, колонка не нужна.
 * Поле повторяет content-plan-item.entity.ts — локально его создаёт synchronize.
 */
export class ContentPlanShootPlace1824000000000 implements MigrationInterface {
  name = 'ContentPlanShootPlace1824000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS "shootPlace" varchar(300)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE content_plan_items DROP COLUMN IF EXISTS "shootPlace"`);
  }
}
