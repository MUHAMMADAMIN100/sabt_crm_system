import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Долги без помесячного платежа (решение владельца 31.10.2026): настоящий
 * долг отдают сразу или траншами, срок «вернуть до» — по желанию.
 * — колонка finance_debts."dueDate";
 * — «Долг Мухаммаду» владелец попросил удалить совсем: снимаем его план
 *   и сам долг (как кнопка «Удалить» в форме долга).
 * Уже намеченные платежи других долгов остаются — теперь это их транши.
 * Таблицы финансов создаёт FinanceService при старте — на чистой базе их
 * ещё нет, тогда делать нечего.
 */
export class FinanceDebtsTranches1821000000000 implements MigrationInterface {
  name = 'FinanceDebtsTranches1821000000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('finance_debts'))) return;
    await q.query(`ALTER TABLE finance_debts ADD COLUMN IF NOT EXISTS "dueDate" date`);
    const ids: Array<{ id: string }> = await q.query(
      `SELECT id FROM finance_debts
        WHERE COALESCE(kind, 'debt') = 'debt' AND lower(btrim(name)) = lower('Долг Мухаммаду')`,
    );
    if (!ids.length) return;
    const list = ids.map(r => r.id);
    if (await q.hasTable('finance_planned_payments')) {
      await q.query(`DELETE FROM finance_planned_payments WHERE "debtId" = ANY($1::uuid[])`, [list]);
    }
    await q.query(`DELETE FROM finance_debts WHERE id = ANY($1::uuid[])`, [list]);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Удалённый долг не восстанавливаем; колонку оставляем — её читает код.
  }
}
