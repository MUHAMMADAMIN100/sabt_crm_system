import { MigrationInterface, QueryRunner } from 'typeorm';

/** Починить норму у коротких смен.
 *
 *  Норма считалась как «смена минус час обеда» безусловно, и у смены
 *  13:30–18:30 выходило 4 часа вместо пяти: обеда в пятичасовой смене нет.
 *  В табеле это давало +1 час переработки каждый день на ровном месте.
 *
 *  Правим только те строки, где стоит ровно результат старой формулы, —
 *  норму, заданную руками, не трогаем. */
export class FixShortShiftNorm1807000000000 implements MigrationInterface {
  name = 'FixShortShiftNorm1807000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "work_schedules" SET "normMinutes" = span.m
        FROM (
          SELECT "id",
                 (((substr("endTime",1,2)::int * 60 + substr("endTime",4,2)::int)
                 - (substr("startTime",1,2)::int * 60 + substr("startTime",4,2)::int)
                 + 1440) % 1440) AS m
            FROM "work_schedules"
        ) span
       WHERE span."id" = "work_schedules"."id"
         AND span.m < 420
         AND "work_schedules"."normMinutes" = span.m - 60`);
  }

  async down(): Promise<void> {
    // Обратно ломать норму незачем.
  }
}
