import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReturnedStatus1744200000000 implements MigrationInterface {
  name = 'AddReturnedStatus1744200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'returned' to all possible enum names TypeORM might have created
    const enumNames = ['task_status_enum', 'tasks_status_enum'];

    for (const enumName of enumNames) {
      try {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'returned'`
        );
      } catch (e) {
        // Enum might not exist with this name — skip
      }
    }

    // Also add task_returned to notification enum
    const notifEnumNames = ['notification_type_enum', 'notifications_type_enum'];
    for (const enumName of notifEnumNames) {
      try {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'task_returned'`
        );
      } catch (e) {
        // skip
      }
    }
  }

  public async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL
  }
}
