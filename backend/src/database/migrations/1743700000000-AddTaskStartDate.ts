import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskStartDate1743700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "startDate" date;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tasks DROP COLUMN IF EXISTS "startDate";
    `);
  }
}
