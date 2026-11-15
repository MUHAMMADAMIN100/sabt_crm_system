import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * История ответственного менеджера клиента «Финансов» (14.11.2026): оплата
 * засчитывается менеджеру, который вёл клиента в день оплаты, — смена
 * менеджера не переносит прошлые деньги новому. [{ managerId, from }],
 * пишется при каждой смене salesManagerId. Пусто — всё за текущим.
 */
export class FinanceClientManagerHistory1831000000000 implements MigrationInterface {
  name = 'FinanceClientManagerHistory1831000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // На чистой базе finance_projects ещё нет — её создаёт
    // FinanceService.onModuleInit уже после миграций (15.11.2026).
    if (!(await queryRunner.hasTable('finance_projects'))) return;
    await queryRunner.query(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "salesManagerHistory" jsonb NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('finance_projects'))) return;
    await queryRunner.query(`ALTER TABLE finance_projects DROP COLUMN IF EXISTS "salesManagerHistory"`);
  }
}
