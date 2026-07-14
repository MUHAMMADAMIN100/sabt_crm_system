import { MigrationInterface, QueryRunner } from 'typeorm';

/** Этап доски «Разработка» у задач (1..6): задачи-карточки, созданные через
 *  «+» в колонке dev-доски. Дублирует идемпотентный DDL из
 *  TasksService.onModuleInit — для чистого прод-деплоя. */
export class AddTaskDevStage1784300000000 implements MigrationInterface {
  name = 'AddTaskDevStage1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "devStage" int`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks DROP COLUMN IF EXISTS "devStage"`,
    );
  }
}
