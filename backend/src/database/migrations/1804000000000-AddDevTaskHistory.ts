import { MigrationInterface, QueryRunner } from 'typeorm';

/** История изменений задач доски разработки (аудит полей status/assignee/
 *  priority/deadline/title). Пишется из move/update/bulk, читается через
 *  GET /dev-tracker/:id/history. CASCADE по задаче: удаление задачи сносит
 *  её историю; SET NULL по актору: удаление юзера не сносит историю. */
export class AddDevTaskHistory1804000000000 implements MigrationInterface {
  name = 'AddDevTaskHistory1804000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_task_history" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "taskId"    uuid NOT NULL
          REFERENCES "dev_tasks"("id") ON DELETE CASCADE,
        "actorId"   uuid NULL
          REFERENCES "users"("id") ON DELETE SET NULL,
        "field"     varchar NOT NULL,
        "from"      text NULL,
        "to"        text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_task_history" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dev_task_history_task" ON "dev_task_history" ("taskId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_task_history_task"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_task_history"`);
  }
}
