import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

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

    // Add notification_type enum value if not exists.
    // Имя типа — из каталога по колонке (15.11.2026): на чистой базе он
    // называется notification_type_enum, и жёсткое имя роняло миграцию.
    await addEnumValues(queryRunner, 'notifications', 'type', ['payment_reminder']);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "paidAmount"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "salesManagerId"`);
  }
}
