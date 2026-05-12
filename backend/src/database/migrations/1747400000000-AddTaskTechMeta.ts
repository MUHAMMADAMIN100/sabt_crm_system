import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет JSON-колонку techMeta для задач разработки: repoUrl, branch,
 *  prUrl, liveUrl. Используется на странице задачи в разделе
 *  "🔧 Технические детали" — даёт разработчикам быстрый доступ к ссылкам
 *  на код, ветку, PR и staging-окружение без переключения между сервисами. */
export class AddTaskTechMeta1747400000000 implements MigrationInterface {
  name = 'AddTaskTechMeta1747400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "techMeta" jsonb NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "techMeta"`);
  }
}
