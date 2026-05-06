import { MigrationInterface, QueryRunner } from 'typeorm';

/** Sequential workflow для задач: исполнители идут в строгом порядке (как
 *  «эстафета»). PM задаёт цепочку — например 1) SMM пишет промпт →
 *  2) дизайнер делает макет → 3) SMM публикует. Один и тот же сотрудник
 *  может быть на разных шагах.
 *
 *  Меняем PK с (taskId, userId) на (taskId, position) — это позволяет
 *  одному user-у быть на нескольких шагах.
 *  position INT начинается с 0 и нумерует шаги в порядке возрастания. */
export class AddTaskAssigneeOrder1747000000000 implements MigrationInterface {
  name = 'AddTaskAssigneeOrder1747000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Добавляем колонку position nullable
    await queryRunner.query(`ALTER TABLE "task_assignees" ADD COLUMN IF NOT EXISTS "position" int`);

    // 2. Бэкфилл: для каждой задачи нумеруем по createdAt
    await queryRunner.query(`
      UPDATE "task_assignees" ta
      SET "position" = numbered.rn
      FROM (
        SELECT "taskId", "userId",
               ROW_NUMBER() OVER (PARTITION BY "taskId" ORDER BY "createdAt", "userId") - 1 AS rn
        FROM "task_assignees"
      ) numbered
      WHERE ta."taskId" = numbered."taskId"
        AND ta."userId" = numbered."userId"
        AND ta."position" IS NULL
    `);

    // 3. NOT NULL + дефолт 0 для будущих
    await queryRunner.query(`ALTER TABLE "task_assignees" ALTER COLUMN "position" SET DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "task_assignees" ALTER COLUMN "position" SET NOT NULL`);

    // 4. Меняем PK: (taskId, userId) → (taskId, position)
    await queryRunner.query(`ALTER TABLE "task_assignees" DROP CONSTRAINT IF EXISTS "PK_task_assignees"`);
    await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "PK_task_assignees" PRIMARY KEY ("taskId", "position")`);

    // 5. Индекс для быстрой сортировки
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ta_task_position" ON "task_assignees" ("taskId", "position")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ta_task_position"`);
    await queryRunner.query(`ALTER TABLE "task_assignees" DROP CONSTRAINT IF EXISTS "PK_task_assignees"`);
    // Возвращаем старый PK (можно потерять дубликаты — это down, операция деструктивная)
    await queryRunner.query(`
      DELETE FROM "task_assignees" t1
      USING "task_assignees" t2
      WHERE t1.ctid > t2.ctid
        AND t1."taskId" = t2."taskId"
        AND t1."userId" = t2."userId"
    `);
    await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "PK_task_assignees" PRIMARY KEY ("taskId", "userId")`);
    await queryRunner.query(`ALTER TABLE "task_assignees" DROP COLUMN IF EXISTS "position"`);
  }
}
