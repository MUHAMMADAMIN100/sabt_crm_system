import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

export class AddProjectMembershipNotifications1744700000000 implements MigrationInterface {
  name = 'AddProjectMembershipNotifications1744700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Имя enum-типа notifications.type — из каталога (15.11.2026): на чистой
    // базе это notification_type_enum, и жёсткое имя роняло миграцию.
    await addEnumValues(queryRunner, 'notifications', 'type', ['manager_assigned', 'manager_removed', 'member_removed']);
  }

  async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL without recreating the type
  }
}
