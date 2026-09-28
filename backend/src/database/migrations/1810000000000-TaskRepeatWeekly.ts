import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Повторяющиеся задачи недели (28.09.2026, решение владельца).
 *
 * Часть поручений выдаётся каждую неделю одна и та же: обзвон базы, отчёт,
 * планёрка. Раньше их приходилось заводить заново каждый понедельник.
 *
 * repeatWeekly   — ставится в форме выдачи галочкой «повторять каждую неделю».
 * repeatedFromId — ссылка на задачу-источник у копии. Нужна, чтобы
 *                  еженедельное задание не наплодило дублей: копия за неделю
 *                  создаётся ровно одна, и её видно по этой ссылке.
 *
 * Выбрана модель «каждую неделю — новая копия» (решение владельца): у каждой
 * копии свой статус, поэтому видно, что человек сделал на первой неделе и
 * пропустил на третьей. Один экземпляр со сбросом отметки такой истории
 * не хранит и ломает подсчёт выполненного.
 */
export class TaskRepeatWeekly1810000000000 implements MigrationInterface {
  name = 'TaskRepeatWeekly1810000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "repeatWeekly" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "repeatedFromId" uuid`,
    );
    // Индекс по источнику: еженедельное задание каждую неделю спрашивает
    // «есть ли уже копия этой задачи на эту дату».
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_repeated_from" ON tasks ("repeatedFromId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_repeat_weekly" ON tasks ("repeatWeekly") WHERE "repeatWeekly" = true`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_repeat_weekly"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_repeated_from"`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS "repeatedFromId"`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS "repeatWeekly"`);
  }
}
