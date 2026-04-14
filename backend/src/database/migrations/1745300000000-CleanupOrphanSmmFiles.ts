import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Railway's default filesystem is ephemeral — anything written to
 * /app/uploads/files/ is lost on redeploy. The original SMM project
 * creation flow auto-attached a "SMM_Анкета_*.txt" backup; its DB
 * row survived but the actual file vanished, producing 404s in the
 * Files tab.
 *
 * This migration removes the orphan file_attachments rows for SMM
 * questionnaire backups (filename pattern). The questionnaire data
 * still lives safely in project.smmData; the "Скачать PDF" button
 * on ProjectDetailPage renders it live from that column.
 */
export class CleanupOrphanSmmFiles1745300000000 implements MigrationInterface {
  name = 'CleanupOrphanSmmFiles1745300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM file_attachments
       WHERE "originalName" LIKE 'SMM_Анкета_%.txt'
          OR "originalName" LIKE 'SMM\\_Анкета\\_%.txt' ESCAPE '\\'`,
    );
  }

  async down(): Promise<void> {
    // No-op — we can't restore what was never reliably stored
  }
}
