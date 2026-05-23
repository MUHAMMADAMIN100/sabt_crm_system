import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1. Разносим контакты ЛПР на отдельные поля (phone / instagram / email).
 *    Старое поле contactInfo остаётся для бэк-совместимости.
 * 2. nextContactAt становится timestamptz, чтобы у встречи была не только
 *    дата, но и время — это нужно календарю и напоминаниям.
 */
export class SplitClientContactsAndAddTime1748100000000 implements MigrationInterface {
  name = 'SplitClientContactsAndAddTime1748100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      ADD COLUMN IF NOT EXISTS "contactPhone" varchar,
      ADD COLUMN IF NOT EXISTS "contactInstagram" varchar,
      ADD COLUMN IF NOT EXISTS "contactEmail" varchar
    `);

    // nextContactAt: date → timestamptz (сохраняем существующие даты как 00:00 локально)
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      ALTER COLUMN "nextContactAt" TYPE TIMESTAMPTZ
      USING "nextContactAt"::timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      ALTER COLUMN "nextContactAt" TYPE DATE USING "nextContactAt"::date
    `);
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      DROP COLUMN IF EXISTS "contactPhone",
      DROP COLUMN IF EXISTS "contactInstagram",
      DROP COLUMN IF EXISTS "contactEmail"
    `);
  }
}
