import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Роль «Продюсер» (producer, 29.10.2026) — один на команду, отвечает за
 * съёмки. users.role уже varchar(50) (RoleColumnToVarchar), так что новое
 * значение пишется без изменения схемы; в старые enum-типы добавляем его
 * для подстраховки, как AddVideographerRole. ADD VALUE — без транзакции.
 */
export class AddProducerRole1819000000000 implements MigrationInterface {
  name = 'AddProducerRole1819000000000';
  transaction = false as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of ['user_role_enum', 'users_role_enum']) {
      try {
        await queryRunner.query(`ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'producer'`);
      } catch {
        // Типа нет (новая база без legacy enum) — ок.
      }
    }
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Значение enum в Postgres не удалить без пересоздания типа.
  }
}
