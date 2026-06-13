import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Тема интерфейса теперь хранит 5 hex-цветов (realtimecolors-формат
 * text-background-primary-secondary-accent), а не один ключ-пресет.
 * Расширяем колонку до varchar(64) и чистим старые пресет-значения
 * (violet/blue/...) — пользователи перевыберут в новом редакторе.
 */
export class WidenThemeColor1750100000000 implements MigrationInterface {
  name = 'WidenThemeColor1750100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN "themeColor" TYPE varchar(64)`,
    );
    // Старый формат был коротким ключом без дефисов ("violet").
    // Новый — пять hex через дефис. Зачищаем всё, что не похоже на новый.
    await queryRunner.query(
      `UPDATE users SET "themeColor" = NULL
       WHERE "themeColor" IS NOT NULL AND "themeColor" NOT LIKE '%-%-%-%-%'`,
    );
  }

  async down(): Promise<void> {
    // varchar(64)→(30) усечёт данные; оставляем как есть.
  }
}
