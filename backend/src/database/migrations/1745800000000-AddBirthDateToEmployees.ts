import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBirthDateToEmployees1745800000000 implements MigrationInterface {
  name = 'AddBirthDateToEmployees1745800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "birthDate" date
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN IF EXISTS "birthDate"`);
  }
}
