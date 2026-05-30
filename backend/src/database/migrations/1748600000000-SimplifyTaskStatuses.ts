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
 * тип и колонку (риск). Просто UPDATE'им строки. Енум продолжит содержать
 * старые литералы как «зомби-значения», но в код-базе они не используются,
 * и нормализатор normalizeStatus() конвертирует их при чтении на всякий случай.
 */
export class SimplifyTaskStatuses1748600000000 implements MigrationInterface {
  name = 'SimplifyTaskStatuses1748600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Маппинг в одной транзакции. Используем text-кастинг чтобы enum-проверки
    // не помешали (cast → text → новое enum-значение).
    await queryRunner.query(`
      UPDATE "tasks"
      SET status = CASE
        WHEN status::text IN ('accepted','review','on_pm_review','on_rework',
                              'on_client_approval','approved','returned','rescheduled')
          THEN 'in_progress'::tasks_status_enum
        WHEN status::text = 'published'
          THEN 'done'::tasks_status_enum
        ELSE status
      END
      WHERE status::text NOT IN ('new','in_progress','done','cancelled');
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Откатить уже нельзя — мы потеряли информацию о промежуточных
    // статусах (review/approved/published и т.д.). Down-миграция оставлена
    // пустой намеренно: чтобы вернуть пайплайн нужно прокатить ВСЕ задачи
    // вручную через новые статусы.
  }
}
