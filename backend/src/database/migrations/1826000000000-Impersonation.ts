import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Войти как» (13.11.2026): новые значения журналов.
 *  - activity_logs.action: IMPERSONATED_ACTION — изменение из кабинета
 *    сотрудника, которое сам обработчик не журналирует;
 *  - security_events.type: impersonation_start / impersonation_end.
 *
 * Имя enum-типа берём из каталога по колонке, а не пишем вручную: тип
 * security_events создавала миграция (security_event_type_enum), а в базах,
 * поднятых через synchronize, он называется иначе. Ошибиться в имени — значит
 * уронить старт сервера на проде.
 *
 * ALTER TYPE … ADD VALUE — без оборачивающей транзакции (см. 1748610000000).
 */
export class Impersonation1826000000000 implements MigrationInterface {
  name = 'Impersonation1826000000000';
  transaction = false;

  private async enumOf(q: QueryRunner, table: string, column: string): Promise<string | null> {
    const rows: Array<{ typname: string }> = await q.query(
      `SELECT t.typname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         JOIN pg_type t ON t.oid = a.atttypid AND t.typtype = 'e'
        WHERE c.relname = $1 AND a.attname = $2 AND NOT a.attisdropped`,
      [table, column],
    );
    return rows[0]?.typname ?? null;
  }

  async up(q: QueryRunner): Promise<void> {
    const action = await this.enumOf(q, 'activity_logs', 'action');
    if (action) {
      await q.query(`ALTER TYPE "${action}" ADD VALUE IF NOT EXISTS 'IMPERSONATED_ACTION'`);
    }
    const sec = await this.enumOf(q, 'security_events', 'type');
    if (sec) {
      await q.query(`ALTER TYPE "${sec}" ADD VALUE IF NOT EXISTS 'impersonation_start'`);
      await q.query(`ALTER TYPE "${sec}" ADD VALUE IF NOT EXISTS 'impersonation_end'`);
    }
  }

  async down(): Promise<void> {
    // Значения enum в Postgres не удаляются без пересоздания типа — no-op.
  }
}
