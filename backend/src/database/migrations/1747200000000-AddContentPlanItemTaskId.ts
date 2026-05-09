import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет поле taskId в content_plan_items.
 *  При сохранении элемента контент-плана с assignee и publishDate система
 *  автоматически создаёт связанную задачу — её id хранится здесь, чтобы
 *  при изменении/удалении плана синхронизировать задачу. */
export class AddContentPlanItemTaskId1747200000000 implements MigrationInterface {
  name = 'AddContentPlanItemTaskId1747200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_plan_items"
      ADD COLUMN IF NOT EXISTS "taskId" uuid NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "content_plan_items" DROP COLUMN IF EXISTS "taskId"`);
  }
}
