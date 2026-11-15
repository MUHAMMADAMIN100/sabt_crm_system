import { QueryRunner } from 'typeorm';

/**
 * Помощники для миграций (15.11.2026).
 *
 * Файл лежит ВНЕ папки migrations намеренно: TypeORM загружает оттуда всё,
 * что экспортирует функцию, как класс миграции, и упал бы на этом файле.
 *
 * Зачем: старые миграции писали имя enum-типа вручную («users_role_enum»,
 * «notifications_type_enum», «activity_logs_action_enum»), а InitialSchema
 * создаёт «user_role_enum», «notification_type_enum», «activity_action_enum».
 * На рабочей базе (её поднимал synchronize) имена совпадали, а на чистой —
 * нет, и цепочка миграций падала с «type does not exist». Перебор двух имён
 * через try/catch тоже не спасал: ошибка внутри транзакции миграции делает
 * всю транзакцию негодной. Поэтому имя берём из каталога по таблице и
 * колонке — как Impersonation1826000000000.
 *
 * На рабочей базе эти миграции уже выполнены и повторно не запускаются.
 */

/** Имя enum-типа колонки public.<table>.<column> или null (колонки нет или
 *  она не enum — например, users.role давно varchar). */
export async function enumTypeOf(q: QueryRunner, table: string, column: string): Promise<string | null> {
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

/** Добавить значения в enum колонки. Нет такого enum — тихо пропускаем:
 *  значения нужны только колонке, а её тип и так их примет (varchar). */
export async function addEnumValues(
  q: QueryRunner,
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  const type = await enumTypeOf(q, table, column);
  if (!type) return;
  for (const value of values) {
    await q.query(`ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS '${value.replace(/'/g, "''")}'`);
  }
}
