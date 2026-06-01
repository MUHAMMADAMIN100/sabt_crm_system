import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wave 15 — добавляем 6-й этап онбординга «Отмена» (cancelled) в enum
 * `client_leads_onboardingstage_enum`.
 *
 * ВАЖНО ПО ИМЕНИ ЕНУМА: TypeORM лоwercase'ит camelCase-имя колонки при
 * генерации имени enum'а БЕЗ underscore-separator: `onboardingStage` →
 * `onboardingstage` (а не `onboarding_stage`). Прошлая попытка миграции
 * указала `client_leads_onboarding_stage_enum` — такого типа в БД нет,
 * ALTER падал, контейнер не стартовал, фронт получал 502.
 *
 * ALTER TYPE ... ADD VALUE требует `transaction = false` (см. Wave 11/13
 * с такой же ситуацией).
 */
export class AddCancelledOnboardingStage1748700000000 implements MigrationInterface {
  name = 'AddCancelledOnboardingStage1748700000000';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "client_leads_onboardingstage_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Удаление enum-значений в Postgres практически невозможно без
    // пересоздания типа. Оставляем no-op.
  }
}
