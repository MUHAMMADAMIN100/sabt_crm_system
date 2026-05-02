import { MigrationInterface, QueryRunner } from 'typeorm';

/** Финансовый модуль — учёт доходов/расходов по 3 счетам компании. */
export class AddFinanceTransactions1746700000000 implements MigrationInterface {
  name = 'AddFinanceTransactions1746700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "finance_transactions_type_enum" AS ENUM ('income', 'expense');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "finance_transactions_account_enum" AS ENUM (
          'alif', 'dushanbe_city', 'cash'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "finance_transactions_category_enum" AS ENUM (
          'salary', 'project', 'subscription', 'rent',
          'marketing', 'tools', 'transport', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "finance_transactions_payment_method_enum" AS ENUM (
          'transfer', 'card', 'cash', 'qr'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "finance_transactions_status_enum" AS ENUM (
          'completed', 'pending', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "finance_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" "finance_transactions_type_enum" NOT NULL,
        "amount" DECIMAL(15, 2) NOT NULL,
        "date" DATE NOT NULL,
        "account" "finance_transactions_account_enum" NOT NULL,
        "category" "finance_transactions_category_enum" NOT NULL,
        "description" varchar NOT NULL,
        "counterparty" varchar NULL,
        "project" varchar NULL,
        "paymentMethod" "finance_transactions_payment_method_enum" NULL,
        "status" "finance_transactions_status_enum" NOT NULL DEFAULT 'completed',
        "comment" text NULL,
        "createdById" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ft_creator" FOREIGN KEY ("createdById")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ft_type"     ON "finance_transactions" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ft_account"  ON "finance_transactions" ("account")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ft_category" ON "finance_transactions" ("category")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ft_status"   ON "finance_transactions" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ft_date"     ON "finance_transactions" ("date")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "finance_transactions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "finance_transactions_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "finance_transactions_payment_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "finance_transactions_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "finance_transactions_account_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "finance_transactions_type_enum"`);
  }
}
