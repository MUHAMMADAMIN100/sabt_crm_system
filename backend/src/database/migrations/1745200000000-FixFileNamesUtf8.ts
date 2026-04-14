import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-shot repair: re-decode latin1-mangled filenames in file_attachments.
 * Rows written before the backend UTF-8 fix have Cyrillic filenames stored
 * as the latin1 interpretation of UTF-8 bytes, showing up as "Ð Ð½Ð°Ð¼µÑÐ°"
 * instead of "Анкета" in the UI.
 *
 * We detect them by presence of the classic mojibake prefix characters
 * (Ð, Ñ) and convert the string back by round-tripping through latin1.
 */
export class FixFileNamesUtf81745200000000 implements MigrationInterface {
  name = 'FixFileNamesUtf81745200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; originalName: string }> = await queryRunner.query(
      `SELECT id, "originalName" FROM file_attachments
       WHERE "originalName" ~ '[Ð Ñ]'`,
    );
    for (const r of rows) {
      try {
        const fixed = Buffer.from(r.originalName, 'latin1').toString('utf8');
        if (fixed && fixed !== r.originalName) {
          await queryRunner.query(
            `UPDATE file_attachments SET "originalName" = $1 WHERE id = $2`,
            [fixed, r.id],
          );
        }
      } catch {
        // ignore per-row failures — don't block migration
      }
    }
  }

  async down(): Promise<void> {
    // No-op: can't reliably reverse without the original bytes.
  }
}
