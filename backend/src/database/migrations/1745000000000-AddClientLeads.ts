import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientLeads1745000000000 implements MigrationInterface {
  name = 'AddClientLeads1745000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "client_leads_status_enum" AS ENUM (
          'new', 'waiting', 'negotiating', 'proposal', 'won', 'lost', 'on_hold'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "client_leads_interest_enum" AS ENUM ('cold', 'warm', 'hot');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "sphere" varchar NULL,
        "problem" text NULL,
        "address" varchar NULL,
        "contactPerson" varchar NULL,
        "contactInfo" text NULL,
        "status" "client_leads_status_enum" NOT NULL DEFAULT 'new',
        "nextStep" text NULL,
        "leadSource" varchar NULL,
        "dealPotential" DECIMAL(15, 2) NULL,
        "interest" "client_leads_interest_enum" NULL,
        "lastContactAt" DATE NULL,
        "nextContactAt" DATE NULL,
        "channel" varchar NULL,
        "rejectionReason" text NULL,
        "ownerId" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_client_leads" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cl_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cl_status" ON "client_leads" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cl_next" ON "client_leads" ("nextContactAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_cl_owner" ON "client_leads" ("ownerId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_leads"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "client_leads_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "client_leads_interest_enum"`);
  }
}
