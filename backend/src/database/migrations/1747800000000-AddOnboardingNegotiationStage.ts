import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Добавляем значение 'negotiation' в enum онбординг-этапов клиента.
 * Используется в воронке менеджера продаж по разработке как первый этап
 * (до встречи).
 */
export class AddOnboardingNegotiationStage1747800000000 implements MigrationInterface {
  name = 'AddOnboardingNegotiationStage1747800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'negotiation'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'client_leads_onboardingstage_enum')
        ) THEN
          ALTER TYPE "client_leads_onboardingstage_enum" ADD VALUE 'negotiation';
        END IF;
      END
      $$;
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL не поддерживает удаление значения из enum без пересоздания типа.
    // Откат не предоставляется намеренно.
  }
}
