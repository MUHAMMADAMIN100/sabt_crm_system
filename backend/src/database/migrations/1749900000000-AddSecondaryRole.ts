import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Вторая (дополнительная) роль сотрудника — например «Видеограф / Монтажёр».
 * Права = объединение обеих ролей (RolesGuard проверяет обе).
 * Назначается только admin/founder/co_founder.
 * KPI-таргеты и дашборд остаются по основной роли.
 */
export class AddSecondaryRole1749900000000 implements MigrationInterface {
  name = 'AddSecondaryRole1749900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "secondaryRole" varchar(50)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS "secondaryRole"`,
    );
  }
}
