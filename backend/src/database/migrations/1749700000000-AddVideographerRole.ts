import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Новая роль «Видеограф» (videographer) — исполнитель производства
 * контента, права как у designer.
 *
 * Колонка users.role уже varchar(50) (см. RoleColumnToVarchar), поэтому
 * новое строковое значение пишется без изменения схемы. Но legacy
 * enum-типы user_role_enum / users_role_enum всё ещё существуют в БД
 * (нужны для down() RoleColumnToVarchar) — добавляем значение и туда
 * для подстраховки, чтобы потенциальный rollback не потерял юзеров.
 *
 * ALTER TYPE ... ADD VALUE требует transaction = false (см. Wave 11/13/15).
 */
export class AddVideographerRole1749700000000 implements MigrationInterface {
  name = 'AddVideographerRole1749700000000';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of ['user_role_enum', 'users_role_enum']) {
      try {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'videographer'`,
        );
      } catch {
        // Тип не существует (новая инсталляция без legacy enum) — ок.
      }
    }
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Удаление enum-значений в Postgres невозможно без пересоздания типа.
  }
}
