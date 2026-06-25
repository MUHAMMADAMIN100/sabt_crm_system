import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Последняя активность менеджера с клиентом — client_leads.lastActivityAt.
 * Показывается в Базе клиентов («5 часов назад» / «12 июн»). Идемпотентно —
 * дублирует ALTER из ClientsService.onModuleInit.
 */
export class ClientLeadLastActivity1750700000000 implements MigrationInterface {
  name = 'ClientLeadLastActivity1750700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "lastActivityAt" timestamp with time zone`);
    // Заполним прошлые лиды значением updatedAt, чтобы колонка не пустовала.
    await queryRunner.query(`UPDATE client_leads SET "lastActivityAt" = "updatedAt" WHERE "lastActivityAt" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE client_leads DROP COLUMN IF EXISTS "lastActivityAt"`);
  }
}
