import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBudgetSourceToAds1745600000000 implements MigrationInterface {
  name = 'AddBudgetSourceToAds1745600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type if not exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_ads_budgetsource_enum') THEN
          CREATE TYPE "project_ads_budgetsource_enum" AS ENUM ('company', 'client');
        END IF;
      END
      $$;
    `);

    // Add column with default 'client'
    await queryRunner.query(`
      ALTER TABLE "project_ads"
      ADD COLUMN IF NOT EXISTS "budgetSource" "project_ads_budgetsource_enum" NOT NULL DEFAULT 'client'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "project_ads" DROP COLUMN IF EXISTS "budgetSource"`);
  }
}
