import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Этап онбординга клиента — позиция на канбан-доске «Онбординг»
 * (встреча / создание КП / реализация / договор). NULL — клиент не на доске.
 */
export class AddClientLeadOnboardingStage1747700000000 implements MigrationInterface {
  name = 'AddClientLeadOnboardingStage1747700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'client_leads_onboardingstage_enum'
        ) THEN
          CREATE TYPE "client_leads_onboardingstage_enum" AS ENUM
            ('meeting', 'kp_creation', 'implementation', 'contract');
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      ADD COLUMN IF NOT EXISTS "onboardingStage" "client_leads_onboardingstage_enum"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "client_leads" DROP COLUMN IF EXISTS "onboardingStage"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "client_leads_onboardingstage_enum"`);
  }
}
