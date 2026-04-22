import { MigrationInterface, QueryRunner } from 'typeorm';

/** Wave 7: launch-checklist для проектов. */
export class AddProjectLaunchChecklist1746500000000 implements MigrationInterface {
  name = 'AddProjectLaunchChecklist1746500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "launchChecklist" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "launchChecklist"`);
  }
}
