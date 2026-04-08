import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRolesAndTaskFields1743800000000 implements MigrationInterface {
  name = 'AddRolesAndTaskFields1743800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update users role enum to include new roles
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'founder'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'project_manager'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'smm_specialist'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'designer'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'targetologist'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'sales_manager'`);

    // Add managerId to users
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managerId" uuid`);

    // Update tasks status enum
    await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" ADD VALUE IF NOT EXISTS 'returned'`);

    // Add new task fields
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "targetCount" integer`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completedCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "returnCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "returnComment" text`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "resultUrl" character varying`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewedById" uuid`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP`);

    // Update notifications type enum
    await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'task_returned'`);
    await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'task_overdue'`);
    await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE IF NOT EXISTS 'review_needed'`);
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
