import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Отпуск, дополнение (27.10.2026). EmployeeVacation добавила 'vacation' в тип
 * «employees_status_enum», но в рабочей базе колонка employees.status может
 * жить на старом типе «employee_status_enum» (из InitialSchema) — тогда
 * сохранение статуса «В отпуске» падало с 500. Берём тип прямо из колонки и
 * на всякий случай дописываем значение в оба старых имени.
 */
export class EmployeeVacationStatusType1817000000000 implements MigrationInterface {
  name = 'EmployeeVacationStatusType1817000000000';
  transaction = false as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    const types: Array<{ schema: string; name: string; kind: string }> = await queryRunner.query(`
      SELECT n.nspname AS schema, t.typname AS name, t.typtype AS kind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE c.relname = 'employees' AND a.attname = 'status'
        AND NOT a.attisdropped AND pg_table_is_visible(c.oid)`);
    for (const t of types) {
      if (t.kind !== 'e') continue; // varchar — любое значение и так подходит
      await queryRunner.query(`ALTER TYPE "${t.schema}"."${t.name}" ADD VALUE IF NOT EXISTS 'vacation'`);
    }
    for (const name of ['employee_status_enum', 'employees_status_enum']) {
      try {
        await queryRunner.query(`ALTER TYPE "${name}" ADD VALUE IF NOT EXISTS 'vacation'`);
      } catch {
        // Типа с таким именем нет — ок.
      }
    }
  }

  async down(): Promise<void> {
    // Значение enum в Postgres не удалить без пересоздания типа.
  }
}
