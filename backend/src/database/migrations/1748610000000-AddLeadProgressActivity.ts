import { MigrationInterface, QueryRunner } from 'typeorm';

/** Wave 11 — добавляем enum-значение LEAD_PROGRESS в activity_logs_action_enum.
 *  Используется для подсчёта KPI менеджеров продаж: каждое продвижение
 *  лида на следующий этап (status или onboardingStage) пишет запись с этим
 *  action, KPI потом фильтрует по userId + дате. */
export class AddLeadProgressActivity1748610000000 implements MigrationInterface {
  name = 'AddLeadProgressActivity1748610000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres enums нельзя ALTER TABLE-ом дополнять без IF NOT EXISTS до 11+.
    // Используем безопасный паттерн через DO $$.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "activity_logs_action_enum" ADD VALUE IF NOT EXISTS 'LEAD_PROGRESS';
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Удаление enum-значений в Postgres практически невозможно без
    // пересоздания типа. Оставляем no-op.
  }
}
