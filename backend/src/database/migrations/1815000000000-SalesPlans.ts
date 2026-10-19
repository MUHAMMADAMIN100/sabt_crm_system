import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * План продаж менеджеров на месяц (19.10.2026): сумму ставит основатель на
 * странице «Сотрудники». Всё IF NOT EXISTS — повторный прогон не роняет сервер.
 */
export class SalesPlans1815000000000 implements MigrationInterface {
  name = 'SalesPlans1815000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sales_plans (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ym varchar(7) NOT NULL,
        amount decimal(15,2) NOT NULL,
        "updatedById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_plans_user_ym" ON sales_plans ("userId", ym)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sales_plans`);
  }
}
