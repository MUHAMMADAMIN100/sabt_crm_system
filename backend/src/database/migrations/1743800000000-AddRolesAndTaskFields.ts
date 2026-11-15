import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

export class AddRolesAndTaskFields1743800000000 implements MigrationInterface {
  name = 'AddRolesAndTaskFields1743800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update users role enum to include new roles.
    // Имя enum-типа — из каталога по колонке (15.11.2026): на чистой базе
    // тип называется user_role_enum, и жёсткое имя роняло миграцию.
    await addEnumValues(queryRunner, 'users', 'role', [
      'founder', 'project_manager', 'smm_specialist', 'designer', 'targetologist', 'sales_manager',
    ]);

    // Add managerId to users
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managerId" uuid`);

    // Update tasks status enum
    await addEnumValues(queryRunner, 'tasks', 'status', ['returned']);

    // Add new task fields
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "targetCount" integer`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completedCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "returnCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "returnComment" text`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "resultUrl" character varying`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewedById" uuid`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP`);

    // Update notifications type enum
    await addEnumValues(queryRunner, 'notifications', 'type', ['task_returned', 'task_overdue', 'review_needed']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Removing enum values is complex in Postgres, skip for now
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "reviewedAt"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "reviewedById"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "resultUrl"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "returnComment"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "returnCount"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "completedCount"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "targetCount"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "managerId"`);
  }
}
