import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет поле discount (скидка в сомони) для проектов.
 *  Используется в расчёте эффективной выручки и маржи. */
export class AddProjectDiscount1747100000000 implements MigrationInterface {
  name = 'AddProjectDiscount1747100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "discount" DECIMAL(15, 2) NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "discount"`);
  }
}
