import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Размер персональных обоев.
 *
 * До этого картинка всегда растягивалась на весь экран (cover), и высокие
 * или квадратные изображения — например логотип — обрезались по краям.
 * backgroundScale задаёт масштаб в процентах от «заполнить экран»:
 * 100 — как раньше, меньше — картинка уменьшается и вокруг остаётся фон
 * темы, больше — приближается.
 *
 * backgroundRatio — соотношение сторон картинки (ширина/высота), считается
 * в браузере при загрузке. Без него нельзя выразить «половина от cover» в
 * CSS: cover зависит и от пропорций картинки, и от размера окна.
 */
export class AddUserBackgroundScale1784900000000 implements MigrationInterface {
  name = 'AddUserBackgroundScale1784900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "backgroundScale" integer NOT NULL DEFAULT 100`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "backgroundRatio" numeric(6,3)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "backgroundScale"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "backgroundRatio"`);
  }
}
