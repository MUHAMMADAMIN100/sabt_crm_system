import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

export class AddDeveloperRole1744300000000 implements MigrationInterface {
  name = 'AddDeveloperRole1744300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Имя enum-типа users.role — из каталога (15.11.2026): перебор двух имён
    // через try/catch портил транзакцию миграции на чистой базе.
    await addEnumValues(queryRunner, 'users', 'role', ['developer']);
  }

  public async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL
  }
}
