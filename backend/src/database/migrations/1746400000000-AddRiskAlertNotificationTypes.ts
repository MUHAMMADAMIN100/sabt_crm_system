import { MigrationInterface, QueryRunner } from 'typeorm';

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
    // TypeORM в разных миграциях создавал enum под двумя именами — пробуем оба.
    const enumNames = ['notification_type_enum', 'notifications_type_enum'];
    for (const enumName of enumNames) {
      for (const value of newTypes) {
        try {
          await queryRunner.query(
            `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}'`,
          );
        } catch {
          // enum может не существовать под этим именем — пропускаем
        }
      }
    }
  }

  async down(): Promise<void> {
    // Enum-значения удалить нельзя без пересоздания типа
  }
}
