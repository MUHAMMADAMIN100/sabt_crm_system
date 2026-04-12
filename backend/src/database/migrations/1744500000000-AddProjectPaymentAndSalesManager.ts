import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectPaymentAndSalesManager1744500000000 implements MigrationInterface {
  name = 'AddProjectPaymentAndSalesManager1744500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add paidAmount to projects
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(15, 2) NULL
    `);

    // Add salesManagerId to projects
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "salesManagerId" uuid NULL
    `);

    // Add notification_type enum value if not exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'payment_reminder'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notifications_type_enum')
        ) THEN
          ALTER TYPE "notifications_type_enum" ADD VALUE 'payment_reminder';
        END IF;
      END
      $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "paidAmount"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "salesManagerId"`);
  }
}
