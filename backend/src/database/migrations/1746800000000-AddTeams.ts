import { MigrationInterface, QueryRunner } from 'typeorm';

/** Команды — рабочие группы сотрудников.
 *  Один сотрудник = одна команда (m:1). Проект может быть привязан
 *  к одной команде. */
export class AddTeams1746800000000 implements MigrationInterface {
  name = 'AddTeams1746800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "teams" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "description" text NULL,
        "color" varchar NULL,
        "leadId" uuid NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdById" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teams" PRIMARY KEY ("id"),
        CONSTRAINT "FK_teams_lead"    FOREIGN KEY ("leadId")      REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_teams_creator" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_teams_active" ON "teams" ("isActive")`);

    // Колонка teamId на users
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "teamId" uuid NULL`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_team"
        FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_team" ON "users" ("teamId")`);

    // Колонки teamId + teamNameSnapshot на projects
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "teamId" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "teamNameSnapshot" varchar NULL`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "projects"
        ADD CONSTRAINT "FK_projects_team"
        FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_projects_team" ON "projects" ("teamId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_projects_team"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "FK_projects_team"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "teamNameSnapshot"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "teamId"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_team"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_team"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "teamId"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "teams"`);
  }
}
