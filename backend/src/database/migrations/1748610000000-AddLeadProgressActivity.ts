import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

/** Wave 11 — добавляем enum-значение LEAD_PROGRESS в activity_logs_action_enum.
 *  Используется для подсчёта KPI менеджеров продаж: каждое продвижение
 *  лида на следующий этап (status или onboardingStage) пишет запись с этим
 *  action, KPI потом фильтрует по userId + дате.
 *
 *  ВАЖНО: ALTER TYPE ... ADD VALUE в Postgres < 12 НЕ работает внутри
 *  транзакции, а в 12+ значение не видно до commit. Чтобы избежать обоих
 *  ограничений — заявляем transaction = 'none' и используем
 *  `IF NOT EXISTS`, чтобы миграция была идемпотентной.
 */
export class AddLeadProgressActivity1748610000000 implements MigrationInterface {
  name = 'AddLeadProgressActivity1748610000000';
  // TypeORM: false — миграция выполняется без оборачивающей транзакции,
  // что необходимо для ALTER TYPE ... ADD VALUE в старых Postgres.
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    // Имя enum-типа activity_logs.action — из каталога (15.11.2026): на
    // чистой базе это activity_action_enum, и жёсткое имя роняло миграцию.
    await addEnumValues(queryRunner, 'activity_logs', 'action', ['LEAD_PROGRESS']);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Удаление enum-значений в Postgres практически невозможно без
    // пересоздания типа. Оставляем no-op.
  }
}
