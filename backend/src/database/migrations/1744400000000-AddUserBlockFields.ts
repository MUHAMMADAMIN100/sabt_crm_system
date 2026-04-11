import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserBlockFields1744400000000 implements MigrationInterface {
  name = 'AddUserBlockFields1744400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS "blockedById" VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS "blockedByName" VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS "blockedByRole" VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS "blockReason" TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "isBlocked",
      DROP COLUMN IF EXISTS "blockedAt",
      DROP COLUMN IF EXISTS "blockedById",
      DROP COLUMN IF EXISTS "blockedByName",
      DROP COLUMN IF EXISTS "blockedByRole",
      DROP COLUMN IF EXISTS "blockReason"
    `);
  }
}
