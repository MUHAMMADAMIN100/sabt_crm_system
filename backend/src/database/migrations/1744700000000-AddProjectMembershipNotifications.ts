import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectMembershipNotifications1744700000000 implements MigrationInterface {
  name = 'AddProjectMembershipNotifications1744700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of ['manager_assigned', 'manager_removed', 'member_removed']) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumlabel = '${value}'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notifications_type_enum')
          ) THEN
            ALTER TYPE "notifications_type_enum" ADD VALUE '${value}';
          END IF;
        END
        $$;
      `);
    }
  }

  async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL without recreating the type
  }
}
