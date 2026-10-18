import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Цели месяца сотрудников (личный профиль, 17.10.2026): ставят руководитель
 * направления и основатель. Всё IF NOT EXISTS — повторный прогон не роняет
 * сервер.
 */
export class EmployeeGoals1814000000000 implements MigrationInterface {
  name = 'EmployeeGoals1814000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS employee_goals (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ym varchar(7) NOT NULL,
        title varchar(200) NOT NULL,
        metric varchar(40),
        target int,
        done boolean NOT NULL DEFAULT false,
        "doneAt" timestamptz,
        "createdById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employee_goals_user_ym" ON employee_goals ("userId", ym)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS employee_goals`);
  }
}
