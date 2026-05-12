import { MigrationInterface, QueryRunner } from 'typeorm';

/** Делает Task.projectId nullable + добавляет fromFounder флаг.
 *  Прямые задачи от основателя/сооснователя через быструю форму календаря
 *  не привязаны к проекту — это направление основателя конкретному исполнителю. */
export class MakeProjectIdNullableAndAddFromFounder1747300000000 implements MigrationInterface {
  name = 'MakeProjectIdNullableAndAddFromFounder1747300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "projectId" DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "fromFounder" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "fromFounder"`);
    // Не возвращаем NOT NULL обратно — данные могут уже содержать NULL,
    // обратный апгрейд должен быть осознанным актом.
  }
}
