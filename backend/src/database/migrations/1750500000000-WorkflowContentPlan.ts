import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Контент-план как групповая карточка: kind (kp/reels/macros), items (JSONB
 * со списком рилсов/макетов), confirmed (зелёная точка КП). Идемпотентно —
 * дублирует ALTER из WorkflowService.onModuleInit для прод-деплоя.
 */
export class WorkflowContentPlan1750500000000 implements MigrationInterface {
  name = 'WorkflowContentPlan1750500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const cols = [
      `ADD COLUMN IF NOT EXISTS kind varchar`,
      `ADD COLUMN IF NOT EXISTS items jsonb`,
      `ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false`,
    ];
    for (const c of cols) {
      await queryRunner.query(`ALTER TABLE workflow_cards ${c}`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['kind', 'items', 'confirmed']) {
      await queryRunner.query(`ALTER TABLE workflow_cards DROP COLUMN IF EXISTS "${c}"`);
    }
  }
}
