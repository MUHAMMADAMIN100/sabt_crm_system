import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdDatesToTimestamp1745900000000 implements MigrationInterface {
  name = 'AdDatesToTimestamp1745900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_ads"
      ALTER COLUMN "startDate" TYPE timestamp USING "startDate"::timestamp,
      ALTER COLUMN "endDate" TYPE timestamp USING "endDate"::timestamp
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_ads"
      ALTER COLUMN "startDate" TYPE date USING "startDate"::date,
      ALTER COLUMN "endDate" TYPE date USING "endDate"::date
    `);
  }
}
