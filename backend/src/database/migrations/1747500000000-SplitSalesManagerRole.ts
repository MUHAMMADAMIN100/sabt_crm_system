import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Роль 'sales_manager' разделена на две категории:
 *   - 'sales_manager_smm' — менеджер продаж по SMM-направлению
 *   - 'sales_manager_dev' — менеджер продаж по направлению разработки
 *
 * Колонка users.role уже varchar (см. RoleColumnToVarchar), поэтому
 * достаточно обновить данные — менять enum-тип не нужно.
 */
export class SplitSalesManagerRole1747500000000 implements MigrationInterface {
  name = 'SplitSalesManagerRole1747500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Существующих менеджеров продаж переводим на SMM-вариант по умолчанию.
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'sales_manager_smm' WHERE "role" = 'sales_manager'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Откат: обе новые роли сворачиваем обратно в 'sales_manager'.
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'sales_manager' WHERE "role" IN ('sales_manager_smm', 'sales_manager_dev')`,
    );
  }
}
