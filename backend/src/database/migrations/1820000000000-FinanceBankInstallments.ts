import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Кредиты и рассрочки банков — в «Рассрочках», в «Долгах» только настоящие
 * долги (решение владельца 30.10.2026). Один раз переносим то, что уже
 * заведено: банковскую часть рассрочек сотрудникам (finance_installments.
 * debtId) и долги, в названии которых «рассрочка» («Камера (рассрочка)»).
 * Дальше «Что это» задаётся при создании, переключателя нет.
 * Таблицы финансов создаёт FinanceService при старте — на чистой базе их
 * ещё нет, тогда переносить нечего.
 */
export class FinanceBankInstallments1820000000000 implements MigrationInterface {
  name = 'FinanceBankInstallments1820000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_debts'))) return;
    await queryRunner.query(`ALTER TABLE finance_debts ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'debt'`);
    const linked = (await queryRunner.hasTable('finance_installments'))
      && (await queryRunner.hasColumn('finance_installments', 'debtId'));
    await queryRunner.query(
      `UPDATE finance_debts SET kind = 'bank'
        WHERE kind = 'debt'
          AND (name ILIKE '%рассрочк%'${linked ? ` OR id IN (SELECT "debtId" FROM finance_installments WHERE "debtId" IS NOT NULL)` : ''})`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_debts'))) return;
    await queryRunner.query(`UPDATE finance_debts SET kind = 'debt' WHERE kind = 'bank'`);
  }
}
