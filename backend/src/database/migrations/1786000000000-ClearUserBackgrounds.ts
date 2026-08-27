import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Персональные обои интерфейса отключены: у всех сотрудников единый
 * стандартный фон темы, менять его из интерфейса больше нельзя.
 *
 * Уже загруженные картинки стираем — они весили сотни килобайт на строку
 * и больше нигде не используются. Колонки и API-ручки намеренно оставлены:
 * это только очистка данных, схема не меняется.
 */
export class ClearUserBackgrounds1786000000000 implements MigrationInterface {
  name = 'ClearUserBackgrounds1786000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users SET "backgroundImage" = NULL, "backgroundRatio" = NULL WHERE "backgroundImage" IS NOT NULL`,
    );
  }

  async down(): Promise<void> {
    // Данные стёрты безвозвратно — откатывать нечего.
  }
}
