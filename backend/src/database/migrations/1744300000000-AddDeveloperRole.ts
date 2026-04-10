import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeveloperRole1744300000000 implements MigrationInterface {
  name = 'AddDeveloperRole1744300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const enumNames = ['user_role_enum', 'users_role_enum'];
    for (const enumName of enumNames) {
      try {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'developer'`
        );
      } catch (e) {
        // skip if enum doesn't exist
      }
    }
  }

  public async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL
  }
}
