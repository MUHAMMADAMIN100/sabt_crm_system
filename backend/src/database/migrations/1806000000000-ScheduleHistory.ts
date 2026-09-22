import { MigrationInterface, QueryRunner } from 'typeorm';

/** История графиков работы (решение владельца, 22.09.2026, вариант Б).
 *
 *  Раньше график был один на человека и опоздания считались по НЫНЕШНЕМУ
 *  графику. Значит, поставив монтажёру смену с 14:00, мы задним числом
 *  «прощали» ему все прошлые опоздания в табеле — цифры за август менялись
 *  от правки, сделанной в сентябре.
 *
 *  Теперь строка графика действует С ДАТЫ: за каждый день берётся тот
 *  график, который действовал в этот день. Прошлое перестаёт переписываться.
 *
 *  Заодно появляется общий график компании — строка с "userId" IS NULL.
 *  До неё общие 09:00–18:00 были константой в коде, и «Изменить» для всех
 *  было невозможно.
 *
 *  Старым строкам ставим "validFrom" = 2000-01-01: они действовали всегда,
 *  поэтому после выката ни одна цифра в табеле не шелохнётся. */
export class ScheduleHistory1806000000000 implements MigrationInterface {
  name = 'ScheduleHistory1806000000000';

  async up(q: QueryRunner): Promise<void> {
    // Ключ был по "userId" — теперь у человека строк много, по одной на дату.
    // Имя ключа берём из каталога: в базе, поднятой synchronize, оно другое.
    await q.query(`
      DO $$
      DECLARE pk text;
      BEGIN
        SELECT conname INTO pk FROM pg_constraint
         WHERE conrelid = 'work_schedules'::regclass AND contype = 'p';
        IF pk IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "work_schedules" DROP CONSTRAINT %I', pk);
        END IF;
      END $$`);
    await q.query(`ALTER TABLE "work_schedules" ADD COLUMN IF NOT EXISTS "id" uuid NOT NULL DEFAULT gen_random_uuid()`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'work_schedules'::regclass AND contype = 'p') THEN
          ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id");
        END IF;
      END $$`);

    await q.query(`ALTER TABLE "work_schedules" ADD COLUMN IF NOT EXISTS "validFrom" date NOT NULL DEFAULT DATE '2000-01-01'`);
    // «Сбросить к общему» нельзя делать удалением строки: удалив её, мы снова
    // переписали бы прошлое. Вместо этого с даты сброса действует пометка
    // «как у всех», а прежняя строка остаётся историей.
    await q.query(`ALTER TABLE "work_schedules" ADD COLUMN IF NOT EXISTS "followsCompany" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "work_schedules" ALTER COLUMN "userId" DROP NOT NULL`);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_work_schedules_user_from"
        ON "work_schedules" ("userId", "validFrom") WHERE "userId" IS NOT NULL`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_work_schedules_company_from"
        ON "work_schedules" ("validFrom") WHERE "userId" IS NULL`);

    // Общий график компании — те же 09:00–18:00, что были константой в коде,
    // чтобы после выката ничего не поменялось.
    await q.query(`
      INSERT INTO "work_schedules"
        ("userId", "startTime", "endTime", "normMinutes", "graceMinutes", "workdays", "floating", "validFrom")
      SELECT NULL, '09:00', '18:00', 480, 30, '1,2,3,4,5,6', false, DATE '2000-01-01'
       WHERE NOT EXISTS (SELECT 1 FROM "work_schedules" WHERE "userId" IS NULL)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "work_schedules" WHERE "userId" IS NULL`);
    await q.query(`DROP INDEX IF EXISTS "ux_work_schedules_company_from"`);
    await q.query(`DROP INDEX IF EXISTS "ux_work_schedules_user_from"`);
    await q.query(`ALTER TABLE "work_schedules" DROP COLUMN IF EXISTS "followsCompany"`);
    await q.query(`ALTER TABLE "work_schedules" DROP COLUMN IF EXISTS "validFrom"`);
  }
}
