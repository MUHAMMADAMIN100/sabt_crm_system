import { MigrationInterface, QueryRunner } from 'typeorm';

export class RoleColumnToVarchar1745700000000 implements MigrationInterface {
  name = 'RoleColumnToVarchar1745700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Convert the role column from enum to varchar, preserving existing values
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "role" TYPE varchar(50) USING "role"::text
    `);

    // Set default
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "role" SET DEFAULT 'employee'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to enum (best-effort)
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "role" TYPE "users_role_enum" USING "role"::"users_role_enum"
    `);
  }
}
