import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Сплит-оплаты: одна транзакция может зачисляться частями на разные счета
 * (например, 600 на Alif + 400 на DC). Храним массив объектов в jsonb,
 * чтобы не плодить таблицу-связь и не ломать существующие выборки.
 * Если splits = NULL — транзакция одиночная (старое поведение, account).
 */
export class AddFinanceTransactionSplits1748200000000 implements MigrationInterface {
  name = 'AddFinanceTransactionSplits1748200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_transactions"
      ADD COLUMN IF NOT EXISTS "splits" JSONB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_transactions" DROP COLUMN IF EXISTS "splits"`);
  }
}
