import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * publishedAt (15.11.2026): момент, когда карточка стала «Опубликовано».
 * KPI «в срок» раньше смотрел на updatedAt — любая поздняя правка делала
 * сданную вовремя публикацию «опоздавшей».
 *
 * Колонку добавляет и ContentPlanService.onModuleInit, но в проде миграции
 * идут ДО onModuleInit: так сущность с новым полем не упадёт, если
 * content_plan_items прочитают раньше, чем сработает DDL сервиса.
 * На пустой базе таблицы ещё может не быть — тогда пропускаем.
 */
export class ContentPlanPublishedAt1832000000000 implements MigrationInterface {
  name = 'ContentPlanPublishedAt1832000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('content_plan_items'))) return;
    await queryRunner.query(`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMPTZ NULL`);
    await queryRunner.query(
      `UPDATE content_plan_items
          SET "publishedAt" = ("updatedAt" AT TIME ZONE 'UTC')
        WHERE status = 'published' AND "publishedAt" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('content_plan_items'))) return;
    await queryRunner.query(`ALTER TABLE content_plan_items DROP COLUMN IF EXISTS "publishedAt"`);
  }
}
