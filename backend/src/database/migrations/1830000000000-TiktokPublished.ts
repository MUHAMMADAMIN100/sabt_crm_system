import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TikTok (14.11.2026): всё, что выходит в Instagram, дублируется в TikTok.
 * Instagram — прежний статус «Опубликовано», TikTok — отдельная отметка с
 * моментом, когда её поставили. Пусто — в TikTok ещё не выложено.
 */
export class TiktokPublished1830000000000 implements MigrationInterface {
  name = 'TiktokPublished1830000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS "tiktokAt" TIMESTAMPTZ NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE content_plan_items DROP COLUMN IF EXISTS "tiktokAt"`);
  }
}
