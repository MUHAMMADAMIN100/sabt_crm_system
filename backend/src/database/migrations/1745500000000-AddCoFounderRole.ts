import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

export class AddCoFounderRole1745500000000 implements MigrationInterface {
  name = 'AddCoFounderRole1745500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Имя enum-типа users.role — из каталога (15.11.2026): на чистой базе
    // это user_role_enum, и жёсткое имя роняло миграцию.
    await addEnumValues(queryRunner, 'users', 'role', ['co_founder']);
  }

  async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL without recreating the type
  }
}
