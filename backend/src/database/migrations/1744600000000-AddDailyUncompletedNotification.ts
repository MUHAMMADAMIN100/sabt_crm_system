import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyUncompletedNotification1744600000000 implements MigrationInterface {
  name = 'AddDailyUncompletedNotification1744600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'daily_uncompleted'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notifications_type_enum')
        ) THEN
          ALTER TYPE "notifications_type_enum" ADD VALUE 'daily_uncompleted';
        END IF;
      END
      $$;
    `);
  }

  async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL without recreating the type
  }
}
