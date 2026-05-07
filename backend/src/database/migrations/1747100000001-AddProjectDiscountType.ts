import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет тип скидки (fixed/percent) для проектов.
 *  Существующие записи получают fixed по умолчанию — поведение не меняется. */
export class AddProjectDiscountType1747100000001 implements MigrationInterface {
  name = 'AddProjectDiscountType1747100000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projects_discounttype_enum') THEN
          CREATE TYPE "projects_discounttype_enum" AS ENUM ('fixed', 'percent');
        END IF;
      END$$;
    `);
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "discountType" "projects_discounttype_enum"
      NOT NULL DEFAULT 'fixed'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "discountType"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "projects_discounttype_enum"`);
  }
}
