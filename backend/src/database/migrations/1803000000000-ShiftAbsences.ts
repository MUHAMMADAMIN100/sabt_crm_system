import { MigrationInterface, QueryRunner } from 'typeorm';

/** Отгулы, отпуска и больничные в табеле (21.09.2026).
 *
 *  Без них пустой день неотличим от прогула: человек в отпуске выглядел
 *  так же, как забывший нажать «Начать». Отметка ставится руководством и
 *  видна в сводке дня и в табеле месяца. */
export class ShiftAbsences1803000000000 implements MigrationInterface {
  name = 'ShiftAbsences1803000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "shift_absences" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL,
        "date" date NOT NULL,
        "kind" varchar(12) NOT NULL,
        "note" varchar(200),
        "createdById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_shift_absence_day" ON "shift_absences" ("employeeId", "date")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "shift_absences"`);
  }
}
