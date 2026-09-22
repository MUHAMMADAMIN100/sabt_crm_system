import { MigrationInterface, QueryRunner } from 'typeorm';

/** Решения по опозданиям — по дню, а не копилкой за месяц
 *  (решение владельца, 22.09.2026).
 *
 *  Раньше опоздания накапливались весь месяц и висели одним списком: провести
 *  можно было только всё сразу и отменить нельзя. Теперь по каждому дню
 *  принимается решение — оштрафовать или простить, — и оно тут же
 *  записывается. Разобранный день из списка уходит и завтра не всплывает.
 *
 *  entryId — id записи штрафа в журнале сотрудника: по нему отмена находит,
 *  что именно удалять, не разбирая текст комментария. */
export class LateFineDecisions1804000000000 implements MigrationInterface {
  name = 'LateFineDecisions1804000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "late_fine_decisions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "date" date NOT NULL,
        "decision" varchar(10) NOT NULL,
        "employeeId" uuid,
        "entryId" uuid,
        "amount" numeric(15,2) NOT NULL DEFAULT 0,
        "ym" varchar(7),
        "createdById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_late_decision_day" ON "late_fine_decisions" ("userId", "date")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "late_fine_decisions"`);
  }
}
