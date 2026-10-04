import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Раздел «СММ → Контроль» (03.10.2026): отметки по проекту за месяц —
 * доволен ли клиент (с его словами), были ли на связи, отправлен ли отчёт.
 * По одной строке на проект и месяц. Всё IF NOT EXISTS: повторный прогон
 * миграции не роняет сервер.
 */
export class SmmProjectChecks1812000000000 implements MigrationInterface {
  name = 'SmmProjectChecks1812000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS smm_project_checks (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "projectId" uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ym varchar(7) NOT NULL,
        mood varchar(8),
        "moodNote" text,
        "moodAt" timestamptz,
        "moodById" uuid,
        contact boolean NOT NULL DEFAULT false,
        "contactAt" timestamptz,
        "contactById" uuid,
        report boolean NOT NULL DEFAULT false,
        "reportAt" timestamptz,
        "reportById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_smm_project_checks_project_ym" ON smm_project_checks ("projectId", ym)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS smm_project_checks`);
  }
}
