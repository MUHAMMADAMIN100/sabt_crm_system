import { MigrationInterface, QueryRunner } from 'typeorm';

/** Исторический состав зарплатной ведомости и индексы горячих финансовых выборок. */
export class FinanceEmploymentAndIndexes1784700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('finance_employees')) {
      await queryRunner.query(`
        ALTER TABLE finance_employees
        ADD COLUMN IF NOT EXISTS "terminationDate" date NULL
      `);
      await queryRunner.query(`
        ALTER TABLE finance_employees
        ADD COLUMN IF NOT EXISTS "employmentHistory" jsonb NULL
      `);
    }

    if (await queryRunner.hasTable('finance_transactions')) {
      const has = async (...columns: string[]) => {
        for (const column of columns) {
          if (!(await queryRunner.hasColumn('finance_transactions', column))) return false;
        }
        return true;
      };
      // На чистой установке расширенные финансовые колонки создаются
      // bootstrap-DDL модуля уже после migrationsRun. Индексируем только то,
      // что существует сейчас; bootstrap повторит CREATE INDEX после ALTER.
      // accountId служит маркером расширенной схемы: без него type/status
      // ещё могут быть enum из базовой миграции и последующий ALTER в varchar
      // не должен сталкиваться с созданным здесь partial index.
      if (await has('date', 'type', 'status', 'accountId')) {
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS "IDX_fin_tx_posted_date_type"
          ON finance_transactions (date, type)
          WHERE COALESCE(status, 'completed') = 'completed'
        `);
      }
      if (await has('employeeId', 'salaryYm')) {
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS "IDX_fin_tx_employee_salary_ym"
          ON finance_transactions ("employeeId", "salaryYm")
        `);
      }
      if (await has('projectId', 'date')) {
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS "IDX_fin_tx_project_date"
          ON finance_transactions ("projectId", date)
        `);
      }
      if (await has('subscriptionId', 'date')) {
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS "IDX_fin_tx_subscription_date"
          ON finance_transactions ("subscriptionId", date)
        `);
      }
      if (await has('debtId', 'date')) {
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS "IDX_fin_tx_debt_date"
          ON finance_transactions ("debtId", date)
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('finance_transactions')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_tx_debt_date"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_tx_subscription_date"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_tx_project_date"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_tx_employee_salary_ym"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fin_tx_posted_date_type"`);
    }
    if (await queryRunner.hasTable('finance_employees')) {
      await queryRunner.query(`ALTER TABLE finance_employees DROP COLUMN IF EXISTS "employmentHistory"`);
      await queryRunner.query(`ALTER TABLE finance_employees DROP COLUMN IF EXISTS "terminationDate"`);
    }
  }
}
