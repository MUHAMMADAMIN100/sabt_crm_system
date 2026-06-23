import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Несколько исполнителей на карточку/элемент (напр. несколько видеографов
 * на рилс): workflow_cards.assigneeIds (JSONB). assigneeId остаётся «основным».
 * Идемпотентно — дублирует ALTER из WorkflowService.onModuleInit.
 */
export class WorkflowMultiAssignee1750600000000 implements MigrationInterface {
  name = 'WorkflowMultiAssignee1750600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE workflow_cards ADD COLUMN IF NOT EXISTS "assigneeIds" jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE workflow_cards DROP COLUMN IF EXISTS "assigneeIds"`);
  }
}
