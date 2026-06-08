import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Категория финансовой транзакции: enum → свободная строка varchar(100).
 * Это позволяет добавлять собственные категории прямо в форме, не меняя схему.
 * Стандартные значения остаются прежними (salary, project, …).
 */
export class FinanceCategoryToVarchar1748800000000 implements MigrationInterface {
  name = 'FinanceCategoryToVarchar1748800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // enum-колонку приводим к тексту (значения сохраняются как есть),
    // затем удаляем ставший ненужным enum-тип.
    await queryRunner.query(
      `ALTER TABLE "finance_transactions" ALTER COLUMN "category" TYPE character varying(100) USING "category"::text`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "finance_transactions_category_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Откат: воссоздаём enum-тип и приводим колонку обратно.
    // ВНИМАНИЕ: упадёт, если в данных есть нестандартные категории.
    await queryRunner.query(
      `CREATE TYPE "finance_transactions_category_enum" AS ENUM('salary','project','subscription','rent','marketing','tools','transport','other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "finance_transactions" ALTER COLUMN "category" TYPE "finance_transactions_category_enum" USING "category"::"finance_transactions_category_enum"`,
    );
  }
}
