import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Колонка originStage в tasks — этап онбординга клиента, из которого была
 * автогенерирована задача (negotiation / meeting / kp_creation / contract
 * / implementation). NULL для обычных ручных задач.
 *
 * Нужна, чтобы скрывать КП-задачи (kp_creation) из общих списков задач и
 * календаря — они должны быть видны только в Онбординге на колонке «КП».
 */
export class AddTaskOriginStage1748300000000 implements MigrationInterface {
  name = 'AddTaskOriginStage1748300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "originStage" VARCHAR
    `);
    // Бэкфилл для уже существующих автозадач: проставляем originStage
    // тем задачам, на которые ссылаются client_leads.meetingTaskId.
    await queryRunner.query(`
      UPDATE "tasks" t
      SET "originStage" = l."onboardingStage"
      FROM "client_leads" l
      WHERE l."meetingTaskId" = t.id
        AND l."onboardingStage" IS NOT NULL
        AND t."originStage" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "originStage"`);
  }
}
