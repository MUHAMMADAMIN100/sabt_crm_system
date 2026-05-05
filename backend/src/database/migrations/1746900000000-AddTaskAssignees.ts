import { MigrationInterface, QueryRunner } from 'typeorm';

/** Multi-assignee для задач. Композитный PK (taskId, userId).
 *  Каждый исполнитель отмечает свою часть отдельно (isDone, doneAt).
 *  Back-fill: для каждой существующей задачи где assigneeId IS NOT NULL
 *  создаём запись с isDone в зависимости от текущего статуса задачи. */
export class AddTaskAssignees1746900000000 implements MigrationInterface {
  name = 'AddTaskAssignees1746900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_assignees" (
        "taskId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "isDone" boolean NOT NULL DEFAULT false,
        "doneAt" TIMESTAMP NULL,
        "note" text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_task_assignees" PRIMARY KEY ("taskId", "userId"),
        CONSTRAINT "FK_ta_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ta_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ta_user" ON "task_assignees" ("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ta_done" ON "task_assignees" ("isDone")`);

    // Back-fill из существующих задач: если у задачи был assigneeId — делаем
    // его первым (и единственным) исполнителем. Если статус задачи уже
    // финальный (done/approved/published) — отмечаем isDone=true чтобы
    // не сбить логику авто-перехода.
    await queryRunner.query(`
      INSERT INTO "task_assignees" ("taskId", "userId", "isDone", "doneAt")
      SELECT
        t.id,
        t."assigneeId",
        CASE WHEN t.status::text IN ('done','approved','published','cancelled') THEN true ELSE false END,
        CASE WHEN t.status::text IN ('done','approved','published') THEN COALESCE(t."reviewedAt", t."updatedAt") ELSE NULL END
      FROM "tasks" t
      WHERE t."assigneeId" IS NOT NULL
      ON CONFLICT ("taskId", "userId") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_assignees"`);
  }
}
