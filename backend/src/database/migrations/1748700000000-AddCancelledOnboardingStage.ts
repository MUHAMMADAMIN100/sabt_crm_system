import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wave 15 — добавляем 6-й этап онбординга «Отмена» (cancelled) в enum
 * client_leads_onboarding_stage_enum.
 *
 * ВАЖНО: ALTER TYPE ... ADD VALUE требует `transaction = false` (см. Wave 11
 * с такой же ситуацией — иначе ForbiddenTransactionModeOverrideError).
 * Глобально у нас migrationsTransactionMode = 'each', так что override работает.
 */
export class AddCancelledOnboardingStage1748700000000 implements MigrationInterface {
  name = 'AddCancelledOnboardingStage1748700000000';
  // TypeORM: false — миграция выполняется без оборачивающей транзакции,
  // обязательное условие для ALTER TYPE ... ADD VALUE в Postgres.
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "client_leads_onboarding_stage_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Удаление enum-значений в Postgres практически невозможно без
    // пересоздания типа. Оставляем no-op.
  }
}
