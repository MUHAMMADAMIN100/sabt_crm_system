import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectAds1745400000000 implements MigrationInterface {
  name = 'AddProjectAds1745400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_ads_channel_enum" AS ENUM (
          'instagram', 'tiktok', 'facebook', 'youtube', 'telegram', 'google', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_ads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" uuid NOT NULL,
        "title" varchar NOT NULL,
        "channel" "project_ads_channel_enum" NOT NULL DEFAULT 'instagram',
        "budget" DECIMAL(15, 2) NULL,
        "startDate" DATE NOT NULL,
        "endDate" DATE NOT NULL,
        "note" text NULL,
        "createdById" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_ads" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pa_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pa_user" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_pa_project" ON "project_ads" ("projectId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_pa_dates" ON "project_ads" ("startDate", "endDate")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "project_ads"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "project_ads_channel_enum"`);
  }
}
