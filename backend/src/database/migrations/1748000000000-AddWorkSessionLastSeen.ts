import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Колонка lastSeenAt в work_sessions: момент последнего heartbeat от
 * вкладки пользователя. При новом входе незакрытая сессия закрывается
 * этим значением — длительность считается до реального ухода пользователя,
 * а не до бесконечности.
 */
export class AddWorkSessionLastSeen1748000000000 implements MigrationInterface {
  name = 'AddWorkSessionLastSeen1748000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "work_sessions"
      ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMPTZ
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_sessions" DROP COLUMN IF EXISTS "lastSeenAt"`);
  }
}
