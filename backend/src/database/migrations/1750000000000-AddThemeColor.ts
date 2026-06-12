import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Персональный акцентный цвет интерфейса. Каждый сотрудник выбирает
 * в Профиле; система мгновенно перекрашивается ТОЛЬКО для него.
 * NULL — дефолтный ч/б монохром.
 */
export class AddThemeColor1750000000000 implements MigrationInterface {
  name = 'AddThemeColor1750000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "themeColor" varchar(30)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS "themeColor"`,
    );
  }
}
