import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHeadSmmRole1744900000000 implements MigrationInterface {
  name = 'AddHeadSmmRole1744900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'head_smm'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'users_role_enum')
        ) THEN
          ALTER TYPE "users_role_enum" ADD VALUE 'head_smm';
        END IF;
      END
      $$;
    `);
  }

  async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL without recreating the type
  }
}
