import { MigrationInterface, QueryRunner } from 'typeorm';

/** Wave 4: контент-план для SMM-проектов. */
export class AddContentPlan1746300000000 implements MigrationInterface {
  name = 'AddContentPlan1746300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "content_plan_items_content_type_enum" AS ENUM (
          'reel', 'story', 'post', 'design', 'ad', 'video', 'carousel', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "content_plan_items_status_enum" AS ENUM (
          'planned', 'preparing', 'in_production', 'on_review',
          'on_approval', 'approved', 'published', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "content_plan_items_approval_status_enum" AS ENUM (
          'pending', 'approved', 'changes_requested', 'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // Table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "content_plan_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" uuid NOT NULL,
        "contentType" "content_plan_items_content_type_enum" NOT NULL DEFAULT 'post',
        "topic" varchar NOT NULL,
        "format" varchar NULL,
        "preparationDeadline" TIMESTAMP NULL,
        "publishDate" TIMESTAMP NULL,
        "assigneeId" uuid NULL,
        "pmId" uuid NULL,
        "status" "content_plan_items_status_enum" NOT NULL DEFAULT 'planned',
        "fileLink" text NULL,
        "caption" text NULL,
        "approvalStatus" "content_plan_items_approval_status_enum" NOT NULL DEFAULT 'pending',
        "comments" text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_content_plan_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cpi_project" FOREIGN KEY ("projectId")
          REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cpi_assignee" FOREIGN KEY ("assigneeId")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_cpi_pm" FOREIGN KEY ("pmId")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Индексы для аналитики и фильтров
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cpi_project" ON "content_plan_items" ("projectId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cpi_status" ON "content_plan_items" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cpi_publish_date" ON "content_plan_items" ("publishDate")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cpi_assignee" ON "content_plan_items" ("assigneeId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cpi_content_type" ON "content_plan_items" ("contentType")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "content_plan_items"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "content_plan_items_approval_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "content_plan_items_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "content_plan_items_content_type_enum"`);
  }
}
