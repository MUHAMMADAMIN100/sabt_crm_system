import { MigrationInterface, QueryRunner } from 'typeorm';

/** Связь задач доски разработки с проектами раздела «Разработка»
 *  (/dev/projects). Проект живёт в списке проектов, задачи — на канбан-доске
 *  dev-tracker; поле projectId связывает их, а SET NULL гарантирует, что
 *  удаление проекта не снесёт задачи — они просто отвяжутся. */
export class AddDevTaskProjectLink1803000000000 implements MigrationInterface {
  name = 'AddDevTaskProjectLink1803000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ADD COLUMN IF NOT EXISTS "projectId" uuid NULL
        REFERENCES "projects"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dev_tasks_project" ON "dev_tasks" ("projectId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_tasks_project"`);
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "projectId"`);
  }
}
