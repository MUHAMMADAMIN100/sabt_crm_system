import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Поле направления лида (СММ / Разработка) — нужно для разграничения
 * клиентов между двумя менеджерами продаж. Старые лиды остаются NULL
 * (видны обоим МП до явной классификации).
 */
export class AddClientLeadDirection1747600000000 implements MigrationInterface {
  name = 'AddClientLeadDirection1747600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'client_leads_direction_enum'
        ) THEN
          CREATE TYPE "client_leads_direction_enum" AS ENUM ('smm', 'development');
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      ADD COLUMN IF NOT EXISTS "direction" "client_leads_direction_enum"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "client_leads" DROP COLUMN IF EXISTS "direction"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "client_leads_direction_enum"`);
  }
}
