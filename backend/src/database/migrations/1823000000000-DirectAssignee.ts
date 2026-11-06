import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Директ»: кто ведёт клиента (06.11.2026). Клиент закрепляется за менеджером
 * продаж, который первым ответил ему из CRM; руководство может передать чат.
 * Поля повторяют direct.entity.ts — локально их создаёт synchronize.
 */
export class DirectAssignee1823000000000 implements MigrationInterface {
  name = 'DirectAssignee1823000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "assigneeId" uuid REFERENCES users(id) ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "assignedAt" timestamptz`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_conversations_assignee" ON direct_conversations ("assigneeId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_direct_conversations_assignee"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "assignedAt"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "assigneeId"`);
  }
}
