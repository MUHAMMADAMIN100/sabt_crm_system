import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

/** Роль «Проект-менеджер по разработке» (pm_dev) — тестировщик направления:
 *  видит все dev-проекты, ставит задачи-замечания. Колонка users.role в
 *  entity — varchar, но на проде живёт legacy Postgres-enum, поэтому новое
 *  значение добавляем в него (шаблон — AddDeveloperRole). */
export class AddPmDevRole1750800000000 implements MigrationInterface {
  name = 'AddPmDevRole1750800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Имя enum-типа — из каталога по колонке; колонка varchar — пропускаем
    // (15.11.2026): перебор имён через try/catch портил транзакцию миграции.
    await addEnumValues(queryRunner, 'users', 'role', ['pm_dev']);
  }

  public async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL
  }
}
