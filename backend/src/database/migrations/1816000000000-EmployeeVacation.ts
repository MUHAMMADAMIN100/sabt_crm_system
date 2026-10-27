import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Статус сотрудника «В отпуске» с датами «с — по» (27.10.2026). Пока отпуск
 * идёт, в CRM открыт только профиль. ADD VALUE в enum Postgres не любит
 * внутри транзакции, поэтому миграция без неё; всё IF NOT EXISTS.
 */
export class EmployeeVacation1816000000000 implements MigrationInterface {
  name = 'EmployeeVacation1816000000000';
  transaction = false as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "employees_status_enum" ADD VALUE IF NOT EXISTS 'vacation'`);
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "vacationFrom" date`);
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "vacationUntil" date`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "vacationUntil"`);
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "vacationFrom"`);
    // Значение enum в Postgres не удалить без пересоздания типа.
  }
}
