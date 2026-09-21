import { MigrationInterface, QueryRunner } from 'typeorm';

/** Смена: причина перерыва, честное автозакрытие и правки времени
 *  (решение владельца, 21.09.2026).
 *
 *  pauseKind — чем закончился отрезок, если это перерыв: обед, выезд по
 *  работе или личное. Обед и выезд идут в отработанные часы, личное — нет.
 *
 *  lastPingAt — когда человек последний раз был в системе с открытой сменой.
 *  По нему ночной крон закрывает забытую смену, а не полуночью: до этого
 *  ушедший в 18:00 получал в табель 14 часов 59 минут.
 *
 *  shift_edit_requests — «забыл нажать»: правка уходит руководителю, и до
 *  подтверждения в табеле остаётся прежнее время. */
export class ShiftPauseAndEdits1802000000000 implements MigrationInterface {
  name = 'ShiftPauseAndEdits1802000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "work_shifts" ADD COLUMN IF NOT EXISTS "pauseKind" varchar(16)`);
    await q.query(`ALTER TABLE "work_shifts" ADD COLUMN IF NOT EXISTS "lastPingAt" timestamptz`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "shift_edit_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL,
        "date" date NOT NULL,
        "field" varchar(8) NOT NULL,
        "requestedTime" varchar(5) NOT NULL,
        "currentTime" varchar(5),
        "note" varchar(300),
        "status" varchar(10) NOT NULL DEFAULT 'pending',
        "shiftId" uuid,
        "decidedById" uuid,
        "decidedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_shift_edits_status" ON "shift_edit_requests" ("status")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_shift_edits_emp" ON "shift_edit_requests" ("employeeId", "date")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "shift_edit_requests"`);
    await q.query(`ALTER TABLE "work_shifts" DROP COLUMN IF EXISTS "lastPingAt"`);
    await q.query(`ALTER TABLE "work_shifts" DROP COLUMN IF EXISTS "pauseKind"`);
  }
}
