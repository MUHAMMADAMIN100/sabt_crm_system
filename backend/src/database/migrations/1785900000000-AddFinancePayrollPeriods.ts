import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет workflow зарплатных периодов без изменения старых проводок.
 * Даты, суммы и salaryYm существующих транзакций намеренно не обновляются. */
export class AddFinancePayrollPeriods1785900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS finance_payroll_periods (
        ym varchar(7) PRIMARY KEY,
        status varchar(16) NOT NULL DEFAULT 'open',
        "closedAt" timestamptz NULL,
        "closedById" uuid NULL,
        "reopenedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_payroll_period_ym"
          CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        CONSTRAINT "CHK_fin_payroll_period_status"
          CHECK (status IN ('open', 'closed'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_payroll_period_status_ym"
      ON finance_payroll_periods (status, ym DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_payroll_period_status_ym"`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_payroll_periods`);
  }
}
