import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmmTariffs1746000000000 implements MigrationInterface {
  name = 'AddSmmTariffs1746000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "smm_tariffs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "description" text NULL,
        "monthlyPrice" DECIMAL(15, 2) NOT NULL DEFAULT 0,
        "storiesPerMonth" integer NOT NULL DEFAULT 0,
        "reelsPerMonth" integer NOT NULL DEFAULT 0,
        "postsPerMonth" integer NOT NULL DEFAULT 0,
        "designsPerMonth" integer NOT NULL DEFAULT 0,
        "adsIncluded" boolean NOT NULL DEFAULT false,
        "shootingDaysPerMonth" integer NOT NULL DEFAULT 0,
        "reportsPerMonth" integer NOT NULL DEFAULT 0,
        "revisionLimit" integer NOT NULL DEFAULT 0,
        "durationDays" integer NOT NULL DEFAULT 30,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdById" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smm_tariffs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_smm_tariffs_creator" FOREIGN KEY ("createdById")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_smm_tariffs_active" ON "smm_tariffs" ("isActive")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "smm_tariffs"`);
  }
}
