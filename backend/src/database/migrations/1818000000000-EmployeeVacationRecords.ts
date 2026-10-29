import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Отпуск в зарплате (29.10.2026). Статус «В отпуске» после отпуска сам
 * сбрасывается, а зарплата за месяц считается позже — поэтому каждый отпуск
 * остаётся записью: даты, оплачиваемый ли он и что владелец решил по
 * каждому месяцу («Удержать» / «Не удерживать»). Идущие сейчас отпуска
 * переносим как «за свой счёт» — это только подсказка, решает владелец.
 */
export class EmployeeVacationRecords1818000000000 implements MigrationInterface {
  name = 'EmployeeVacationRecords1818000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "vacationPaid" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS employee_vacations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL,
        "userId" varchar(64), -- employees."userId" в старых базах — varchar
        "dateFrom" date NOT NULL,
        "dateUntil" date NOT NULL,
        paid boolean NOT NULL DEFAULT false,
        decisions jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_employee_vacations_employee" ON employee_vacations ("employeeId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_employee_vacations_dates" ON employee_vacations ("dateFrom", "dateUntil")`);
    await queryRunner.query(`
      INSERT INTO employee_vacations ("employeeId", "userId", "dateFrom", "dateUntil", paid)
      SELECT e.id, e."userId", COALESCE(e."vacationFrom", CURRENT_DATE), e."vacationUntil", false
        FROM employees e
       WHERE e.status::text = 'vacation' AND e."vacationUntil" IS NOT NULL
         AND COALESCE(e."vacationFrom", CURRENT_DATE) <= e."vacationUntil"
         AND NOT EXISTS (SELECT 1 FROM employee_vacations v WHERE v."employeeId" = e.id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS employee_vacations`);
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "vacationPaid"`);
  }
}
