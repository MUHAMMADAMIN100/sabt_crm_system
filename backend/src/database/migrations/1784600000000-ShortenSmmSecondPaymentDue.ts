import { MigrationInterface, QueryRunner } from 'typeorm';

/** Переносит сроки уже ожидаемых автоматических вторых частей с +20 на +15 дней. */
export class ShortenSmmSecondPaymentDue1784600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_planned_payments'))
      || !(await queryRunner.hasTable('finance_transactions'))) return;
    await queryRunner.query(`
      UPDATE finance_planned_payments second
      SET "dueDate" = source."paidDate" + 15
      FROM (
        SELECT pp2.id,
          (
            SELECT tx.date
            FROM finance_planned_payments pp1
            JOIN finance_transactions tx ON tx.id = pp1."receivedTxId"
            WHERE pp1."projectId" = pp2."projectId"
              AND pp1.ym = pp2.ym
              AND pp1.status = 'received'
            ORDER BY tx.date DESC, pp1."createdAt" DESC
            LIMIT 1
          ) AS "paidDate"
        FROM finance_planned_payments pp2
        WHERE pp2."partNo" = 2
          AND pp2.status = 'expected'
          AND pp2.auto = true
      ) source
      WHERE second.id = source.id
        AND source."paidDate" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_planned_payments'))
      || !(await queryRunner.hasTable('finance_transactions'))) return;
    await queryRunner.query(`
      UPDATE finance_planned_payments second
      SET "dueDate" = source."paidDate" + 20
      FROM (
        SELECT pp2.id,
          (
            SELECT tx.date
            FROM finance_planned_payments pp1
            JOIN finance_transactions tx ON tx.id = pp1."receivedTxId"
            WHERE pp1."projectId" = pp2."projectId"
              AND pp1.ym = pp2.ym
              AND pp1.status = 'received'
            ORDER BY tx.date DESC, pp1."createdAt" DESC
            LIMIT 1
          ) AS "paidDate"
        FROM finance_planned_payments pp2
        WHERE pp2."partNo" = 2
          AND pp2.status = 'expected'
          AND pp2.auto = true
      ) source
      WHERE second.id = source.id
        AND source."paidDate" IS NOT NULL
    `);
  }
}
