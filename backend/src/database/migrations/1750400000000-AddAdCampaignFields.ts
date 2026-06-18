import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Поля рекламной кампании (ТЗ §9.9 M7): статус, дневной бюджет, таргетолог,
 * связь с workflow-карточкой. Идемпотентно — дублирует ALTER из
 * ProjectAdsService.onModuleInit для прод-деплоя через migrationsRun.
 */
export class AddAdCampaignFields1750400000000 implements MigrationInterface {
  name = 'AddAdCampaignFields1750400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const cols = [
      `ADD COLUMN IF NOT EXISTS "dailyBudget" numeric(15,2)`,
      `ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'planned'`,
      `ADD COLUMN IF NOT EXISTS "targetologistId" uuid`,
      `ADD COLUMN IF NOT EXISTS "cardId" uuid`,
    ];
    for (const c of cols) {
      await queryRunner.query(`ALTER TABLE project_ads ${c}`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['dailyBudget', 'status', 'targetologistId', 'cardId']) {
      await queryRunner.query(`ALTER TABLE project_ads DROP COLUMN IF EXISTS "${c}"`);
    }
  }
}
