import { MigrationInterface, QueryRunner } from 'typeorm';

/** Блокер и дата начала задач доски (контракты A/B): isBlocked + blockedReason
 *  (фильтр ?blocked=true, bulk 'blocked', история 'blocked' да/нет) и
 *  startDate (PATCH через update). Идемпотентно: IF NOT EXISTS / IF EXISTS. */
export class AddDevTaskBlockedDates1806000000000 implements MigrationInterface {
  name = 'AddDevTaskBlockedDates1806000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ADD COLUMN IF NOT EXISTS "isBlocked" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ADD COLUMN IF NOT EXISTS "blockedReason" text NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "dev_tasks" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "startDate"`);
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "blockedReason"`);
    await queryRunner.query(`ALTER TABLE "dev_tasks" DROP COLUMN IF EXISTS "isBlocked"`);
  }
}
