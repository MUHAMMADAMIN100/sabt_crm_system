import { MigrationInterface, QueryRunner } from 'typeorm';

/** Удаление статуса «На ревью» (in_review) канбана Dev-tracker.
 *
 *  Продуктовое решение: этап ревью упразднён, поток идёт
 *  in_progress → testing напрямую. Все задачи, висевшие в in_review,
 *  переносятся ВПЕРЁД — в testing (прогресс не теряется, QA их подхватит).
 *
 *  Postgres не умеет DROP VALUE из enum на месте — пересоздаём тип
 *  dev_tasks_status_enum без 'in_review'. Порядок: сначала данные
 *  (иначе USING упадёт на висячих строках), потом тип.
 *  Дефолт колонки ('backlog') на время операции снимаем и возвращаем. */
export class RemoveInReviewStatus1811000000000 implements MigrationInterface {
  name = 'RemoveInReviewStatus1811000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Данные: in_review → testing (этап ревью пропущен).
    await queryRunner.query(
      `UPDATE "dev_tasks" SET "status" = 'testing' WHERE "status" = 'in_review'`,
    );

    // 2. Дефолт мешает смене типа — снимаем, вернём в конце.
    await queryRunner.query(
      `ALTER TABLE "dev_tasks" ALTER COLUMN "status" DROP DEFAULT`,
    );

    // 3. Пересоздание enum-типа без 'in_review'.
    await queryRunner.query(`
      CREATE TYPE "dev_tasks_status_enum_new" AS ENUM (
        'backlog', 'todo', 'in_progress', 'testing', 'done'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ALTER COLUMN "status"
        TYPE "dev_tasks_status_enum_new"
        USING "status"::text::"dev_tasks_status_enum_new"
    `);
    await queryRunner.query(`DROP TYPE "dev_tasks_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "dev_tasks_status_enum_new" RENAME TO "dev_tasks_status_enum"`,
    );

    // 4. Возвращаем дефолт.
    await queryRunner.query(
      `ALTER TABLE "dev_tasks" ALTER COLUMN "status" SET DEFAULT 'backlog'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Откат возвращает значение в тип, но НЕ разносит задачи обратно:
    // какие именно были в in_review — уже не восстановить (история
    // dev_task_history хранит переходы как текст, см. from/to).
    await queryRunner.query(
      `ALTER TABLE "dev_tasks" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(`
      CREATE TYPE "dev_tasks_status_enum_old" AS ENUM (
        'backlog', 'todo', 'in_progress', 'in_review', 'testing', 'done'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ALTER COLUMN "status"
        TYPE "dev_tasks_status_enum_old"
        USING "status"::text::"dev_tasks_status_enum_old"
    `);
    await queryRunner.query(`DROP TYPE "dev_tasks_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "dev_tasks_status_enum_old" RENAME TO "dev_tasks_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dev_tasks" ALTER COLUMN "status" SET DEFAULT 'backlog'`,
    );
  }
}
