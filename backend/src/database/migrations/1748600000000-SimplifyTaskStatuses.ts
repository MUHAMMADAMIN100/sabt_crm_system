import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wave 11 — упрощаем статусы задач до 4 значений: new / in_progress / done / cancelled.
 *
 * Маппинг существующих:
 *   - accepted, review, on_pm_review, on_rework, on_client_approval,
 *     approved, returned, rescheduled → in_progress
 *   - published                        → done
 *   - new, in_progress, done, cancelled (уже валидные) → без изменений
 *
 * Сам Postgres-enum НЕ перезаписываем — это потребовало бы пересоздавать
 * тип и колонку (риск). Просто UPDATE'им строки.
 *
 * ВАЖНО: НЕ используем `::tasks_status_enum` cast — TypeORM мог назвать
 * тип по-другому в зависимости от истории миграций. Делаем UPDATE с
 * параметрами, Postgres сам приведёт строки к enum-типу.
 */
export class SimplifyTaskStatuses1748600000000 implements MigrationInterface {
  name = 'SimplifyTaskStatuses1748600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Защитный шаг: убедимся что таблица tasks существует, прежде чем
    // что-то с ней делать. На свежей БД (где таблиц ещё нет) миграция
    // должна быть no-op.
    const exists = await queryRunner.query(
      `SELECT to_regclass('public.tasks') AS t`,
    );
    if (!exists?.[0]?.t) {
      return;
    }

    // Маппинг старых → новых статусов. Используем параметризованный
    // запрос — Postgres сам приведёт строки к enum-типу столбца.
    await queryRunner.query(`
      UPDATE "tasks"
      SET status = 'in_progress'
      WHERE status::text IN (
        'accepted','review','on_pm_review','on_rework',
        'on_client_approval','approved','returned','rescheduled'
      )
    `);

    await queryRunner.query(`
      UPDATE "tasks"
      SET status = 'done'
      WHERE status::text = 'published'
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Откатить уже нельзя — мы потеряли информацию о промежуточных
    // статусах (review/approved/published и т.д.). Down-миграция оставлена
    // пустой намеренно.
  }
}
