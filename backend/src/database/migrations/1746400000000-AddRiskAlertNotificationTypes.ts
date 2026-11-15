import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

/** Wave 6: новые типы уведомлений для риск-алертов и операционных алертов. */
export class AddRiskAlertNotificationTypes1746400000000 implements MigrationInterface {
  name = 'AddRiskAlertNotificationTypes1746400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const newTypes = [
      'project_no_tariff',
      'launch_incomplete',
      'task_double_return',
      'employee_inactive_2d',
      'pm_overload',
      'tariff_limit_exceeded',
      'payment_overdue_soon',
      'week_no_content',
      'too_many_pm_reviews',
    ];
    // TypeORM в разных миграциях создавал enum под двумя именами — берём
    // настоящее из каталога по колонке (15.11.2026): перебор через try/catch
    // портил транзакцию миграции, и на чистой базе она падала.
    await addEnumValues(queryRunner, 'notifications', 'type', newTypes);
  }

  async down(): Promise<void> {
    // Enum-значения удалить нельзя без пересоздания типа
  }
}
