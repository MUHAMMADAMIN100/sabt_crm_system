import { MigrationInterface, QueryRunner } from 'typeorm';

/** Рабочие смены (решение владельца, 18.09.2026): кнопка «Начать работу»
 *  у всех, кроме основателя, и статистика по сотрудникам у основателя.
 *
 *  Отдельная таблица, а не time_logs: там время пишется на задачу и taskId
 *  обязателен, смена же ни к какой задаче не относится. */
export class AddWorkShifts1799000000000 implements MigrationInterface {
  name = 'AddWorkShifts1799000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "work_shifts" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employeeId"  uuid NOT NULL,
        "startedAt"   TIMESTAMP NOT NULL,
        "endedAt"     TIMESTAMP NULL,
        "autoClosed"  boolean NOT NULL DEFAULT false,
        "date"        date NOT NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_shifts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_work_shifts_employee" FOREIGN KEY ("employeeId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_work_shifts_employee" ON "work_shifts" ("employeeId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_work_shifts_date" ON "work_shifts" ("date")`);
    // Одна открытая смена на человека — защита от двойного нажатия и от
    // гонки, когда кнопку жмут с телефона и с компьютера одновременно.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_work_shifts_open"
      ON "work_shifts" ("employeeId") WHERE "endedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "work_shifts"`);
  }
}
