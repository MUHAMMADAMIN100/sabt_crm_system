import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentsAndSalaryHistory1744800000000 implements MigrationInterface {
  name = 'AddPaymentsAndSalaryHistory1744800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── project_payments ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" uuid NOT NULL,
        "amount" DECIMAL(15, 2) NOT NULL,
        "paidAt" DATE NOT NULL,
        "recordedById" uuid NULL,
        "note" TEXT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pp_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pp_user" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_pp_paidAt" ON "project_payments" ("paidAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_pp_projectId" ON "project_payments" ("projectId")`);

    // Backfill: for each project with paidAmount > 0, insert one Payment record dated today
    await queryRunner.query(`
      INSERT INTO "project_payments" ("projectId", "amount", "paidAt", "note")
      SELECT id, "paidAmount", CURRENT_DATE, 'Initial backfill from project.paidAmount'
      FROM "projects"
      WHERE "paidAmount" IS NOT NULL AND "paidAmount" > 0
    `);

    // ── salary_history ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "salary_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employeeId" uuid NOT NULL,
        "salary" DECIMAL(15, 2) NOT NULL,
        "effectiveFrom" DATE NOT NULL,
        "changedById" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_salary_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sh_employee" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sh_user" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sh_effectiveFrom" ON "salary_history" ("effectiveFrom")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sh_employeeId" ON "salary_history" ("employeeId")`);

    // Backfill: insert current salary as the first history record per employee.
    // effectiveFrom = beginning of current month so historical reports for this
    // month show current salary.
    await queryRunner.query(`
      INSERT INTO "salary_history" ("employeeId", "salary", "effectiveFrom")
      SELECT id, COALESCE("salary", 0), DATE_TRUNC('month', CURRENT_DATE)::date
      FROM "employees"
      WHERE "salary" IS NOT NULL AND "salary" > 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "salary_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_payments"`);
  }
}
