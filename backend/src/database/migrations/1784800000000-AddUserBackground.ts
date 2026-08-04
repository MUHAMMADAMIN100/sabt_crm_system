import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Персональные обои интерфейса.
 *
 * Картинка лежит В БАЗЕ (data URI), а не на диске: диск на Railway
 * эфемерный и очищается при каждом редеплое — именно поэтому у сотрудников
 * пропадают аватары. Фон должен переживать обновления системы, поэтому
 * колонка, а не файл.
 */
export class AddUserBackground1784800000000 implements MigrationInterface {
  name = 'AddUserBackground1784800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "backgroundImage" text`,
    );
    // Затемнение поверх картинки, 0..90 %. Без него на светлом фото текст
    // и таблицы читаются плохо, поэтому у настройки есть дефолт.
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "backgroundDim" integer NOT NULL DEFAULT 40`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "backgroundImage"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "backgroundDim"`);
  }
}
