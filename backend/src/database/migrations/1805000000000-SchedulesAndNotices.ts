import { MigrationInterface, QueryRunner } from 'typeorm';

/** Личный график смены, просьбы «приду позже» и настройки авто-штрафа
 *  (решение владельца, 22.09.2026, вариант А — своё время у каждого).
 *
 *  Общий порог 09:30 не годится: монтажёр выходит после обеда, а у
 *  руководителя видеографии выездные съёмки и фиксированного начала нет
 *  вовсе. Поэтому опоздание считается от НАЧАЛА СМЕНЫ этого человека плюс
 *  допуск, а у «плавающих» не считается совсем.
 *
 *  Просьба «приду позже», поданная заранее, снимает опоздание за день —
 *  иначе предупреждать не имело бы смысла. */
export class SchedulesAndNotices1805000000000 implements MigrationInterface {
  name = 'SchedulesAndNotices1805000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "work_schedules" (
        "userId" uuid PRIMARY KEY,
        "startTime" varchar(5) NOT NULL DEFAULT '09:00',
        "endTime" varchar(5) NOT NULL DEFAULT '18:00',
        "normMinutes" int NOT NULL DEFAULT 480,
        "graceMinutes" int NOT NULL DEFAULT 30,
        "workdays" varchar(20) NOT NULL DEFAULT '1,2,3,4,5,6',
        "floating" boolean NOT NULL DEFAULT false,
        "updatedById" uuid,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "late_notices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "date" date NOT NULL,
        "plannedTime" varchar(5) NOT NULL,
        "reason" varchar(300),
        "status" varchar(10) NOT NULL DEFAULT 'pending',
        "decidedById" uuid,
        "decidedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_late_notices_day" ON "late_notices" ("date", "status")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_late_notices_user" ON "late_notices" ("userId", "date")`);

    // Настройки живут одной строкой: «включено», сумма, допуск, час
    // проведения и за сколько дней надо предупреждать.
    await q.query(`
      CREATE TABLE IF NOT EXISTS "shift_settings" (
        "id" boolean PRIMARY KEY DEFAULT true,
        "autoFine" boolean NOT NULL DEFAULT false,
        "fineAmount" numeric(15,2) NOT NULL DEFAULT 100,
        "graceMinutes" int NOT NULL DEFAULT 30,
        "runHour" int NOT NULL DEFAULT 21,
        "noticeDaysBefore" int NOT NULL DEFAULT 1,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "shift_settings_single" CHECK ("id")
      )`);
    await q.query(`INSERT INTO "shift_settings" ("id") VALUES (true) ON CONFLICT DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "shift_settings"`);
    await q.query(`DROP TABLE IF EXISTS "late_notices"`);
    await q.query(`DROP TABLE IF EXISTS "work_schedules"`);
  }
}
