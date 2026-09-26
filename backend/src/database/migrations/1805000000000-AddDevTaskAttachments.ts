import { MigrationInterface, QueryRunner } from 'typeorm';

/** Вложения задач доски разработки: массив URL (text[] default '{}').
 *  Патчится через PATCH /dev-tracker/:id {attachments}: ≤10 шт, каждая ≤2000
 *  символов (валидация в DTO). default '{}' — задача без вложений отдаёт [],
 *  а не null, фронт не ветвится. */
export class AddDevTaskAttachments1805000000000 implements MigrationInterface {
  name = 'AddDevTaskAttachments1805000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ADD COLUMN IF NOT EXISTS "attachments" text[] NOT NULL DEFAULT '{}'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "attachments"`);
  }
}
