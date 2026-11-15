import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

export class AddHeadSmmRole1744900000000 implements MigrationInterface {
  name = 'AddHeadSmmRole1744900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Имя enum-типа users.role — из каталога (15.11.2026): на чистой базе
    // это user_role_enum, и жёсткое имя роняло миграцию.
    await addEnumValues(queryRunner, 'users', 'role', ['head_smm']);
  }

  async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL without recreating the type
  }
}
