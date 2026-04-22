import { MigrationInterface, QueryRunner } from 'typeorm';

/** Wave 13: финансовые поля проекта (TZ п.10). */
export class AddProjectFinancials1746600000000 implements MigrationInterface {
  name = 'AddProjectFinancials1746600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "totalContractValue" DECIMAL(15, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "outstandingAmount" DECIMAL(15, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "internalCostEstimate" DECIMAL(15, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "marginEstimate" DECIMAL(15, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "tariffLimitOveruseCost" DECIMAL(15, 2) NULL`);

    // Индекс для финансовых дашбордов / сортировки по outstanding
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_projects_outstanding" ON "projects" ("outstandingAmount")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_projects_outstanding"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "tariffLimitOveruseCost"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "marginEstimate"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "internalCostEstimate"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "outstandingAmount"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "totalContractValue"`);
  }
}
