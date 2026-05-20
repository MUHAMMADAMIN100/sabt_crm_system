import { MigrationInterface, QueryRunner } from 'typeorm';

/** Добавляет поле meetingTaskId к client_leads.
 *  Связь с авто-сгенерированной личной задачей-встречей в tasks (scope='personal').
 *  При установке nextContactAt у клиента создаётся/обновляется такая задача,
 *  чтобы встреча отображалась в Календаре и во вкладке Задачи под фильтром «Мои». */
export class AddClientLeadMeetingTaskId1747900000000 implements MigrationInterface {
  name = 'AddClientLeadMeetingTaskId1747900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      ADD COLUMN IF NOT EXISTS "meetingTaskId" uuid NULL
    `);
    // FK на tasks с ON DELETE SET NULL — если задачу удалили вручную,
    // связь обнулится, но сам лид останется.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "client_leads"
        ADD CONSTRAINT "FK_client_leads_meetingTask"
        FOREIGN KEY ("meetingTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_leads"
      DROP CONSTRAINT IF EXISTS "FK_client_leads_meetingTask"
    `);
    await queryRunner.query(`
      ALTER TABLE "client_leads" DROP COLUMN IF EXISTS "meetingTaskId"
    `);
  }
}
