import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Позвонить»: руководитель отмечает лидов в Базе клиентов → у менеджера
 * появляется задача обзвонить. Гарантируем колонки на проде миграцией
 * (помимо идемпотентного ALTER в ClientsService.onModuleInit).
 */
export class AddClientCallRequest1750200000000 implements MigrationInterface {
  name = 'AddClientCallRequest1750200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callRequested" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callRequestedAt" timestamp with time zone`,
    );
    await queryRunner.query(
      `ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "callRequestedByName" varchar`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE client_leads DROP COLUMN IF EXISTS "callRequestedByName"`);
    await queryRunner.query(`ALTER TABLE client_leads DROP COLUMN IF EXISTS "callRequestedAt"`);
    await queryRunner.query(`ALTER TABLE client_leads DROP COLUMN IF EXISTS "callRequested"`);
  }
}
