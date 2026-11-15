import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

export class AddReturnedStatus1744200000000 implements MigrationInterface {
  name = 'AddReturnedStatus1744200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'returned' to the task status enum, whatever TypeORM named it.
    // Раньше перебирали два имени через try/catch, но ошибка внутри
    // транзакции миграции портит всю транзакцию — на чистой базе миграция
    // падала. Теперь имя типа берём из каталога по колонке (15.11.2026).
    await addEnumValues(queryRunner, 'tasks', 'status', ['returned']);

    // Also add task_returned to notification enum
    await addEnumValues(queryRunner, 'notifications', 'type', ['task_returned']);
  }

  public async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL
  }
}
