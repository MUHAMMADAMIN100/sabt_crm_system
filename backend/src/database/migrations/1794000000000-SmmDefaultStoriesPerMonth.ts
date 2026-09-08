import { MigrationInterface, QueryRunner } from 'typeorm';

/** По умолчанию все SMM-проекты получают 20 сторис в месяц (и производную
 *  дневную норму = round(20/30) = 1), если норма ещё не задана явно. Значение
 *  редактируется на странице проекта (диапазон 0–100). Проекты, где норма уже
 *  выставлена (в т.ч. явный 0), не трогаем. */
export class SmmDefaultStoriesPerMonth1794000000000 implements MigrationInterface {
  name = 'SmmDefaultStoriesPerMonth1794000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "projects"
      SET "smmData" = jsonb_set(
        jsonb_set(COALESCE("smmData", '{}'::jsonb), '{storiesPerMonth}', '20'::jsonb, true),
        '{storiesPerDay}', '1'::jsonb, true
      )
      WHERE "projectType" = 'SMM'
        AND (("smmData" -> 'storiesPerMonth') IS NULL)
    `);
  }

  async down(): Promise<void> {
    // Необратимо на уровне данных: неизвестно, какие проекты имели явную норму
    // до проставления дефолта, поэтому откат не выполняем.
  }
}
