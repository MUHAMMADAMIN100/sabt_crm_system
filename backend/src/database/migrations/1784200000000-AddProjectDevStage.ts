import { MigrationInterface, QueryRunner } from 'typeorm';

/** Этап разработки (1..6) для доски «Разработка»: [10%] Сбор требований →
 *  [100%] Внедрение и Передача. Дублирует идемпотентный DDL из
 *  ProjectsService.onModuleInit — для чистого прод-деплоя. */
export class AddProjectDevStage1784200000000 implements MigrationInterface {
  name = 'AddProjectDevStage1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS "devStage" int`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE projects DROP COLUMN IF EXISTS "devStage"`,
    );
  }
}
