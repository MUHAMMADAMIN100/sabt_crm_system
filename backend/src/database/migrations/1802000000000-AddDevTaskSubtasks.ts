import { MigrationInterface, QueryRunner } from 'typeorm';

/** Подзадачи доски разработки (Notion-style): задача может вкладываться в
 *  другую задачу, вложенность ограничена одним уровнем (проверяется в сервисе).
 *
 *  Self-связь через parentTaskId. ON DELETE SET NULL, а не CASCADE: удаление
 *  родителя не должно уносить подзадачи — они просто поднимаются на верхний
 *  уровень. Отдельного индекса по parentTaskId требует выборка подзадач в
 *  findOne (WHERE parentTaskId = :id) и подсчёт их количества в findAll. */
export class AddDevTaskSubtasks1802000000000 implements MigrationInterface {
  name = 'AddDevTaskSubtasks1802000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dev_tasks"
        ADD COLUMN IF NOT EXISTS "parentTaskId" uuid NULL
        REFERENCES "dev_tasks"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dev_tasks_parent" ON "dev_tasks" ("parentTaskId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_tasks_parent"`);
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "parentTaskId"`);
  }
}
