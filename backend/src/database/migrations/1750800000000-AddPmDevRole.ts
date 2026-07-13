import { MigrationInterface, QueryRunner } from 'typeorm';

/** Роль «Проект-менеджер по разработке» (pm_dev) — тестировщик направления:
 *  видит все dev-проекты, ставит задачи-замечания. Колонка users.role в
 *  entity — varchar, но на проде живёт legacy Postgres-enum, поэтому новое
 *  значение добавляем в него (шаблон — AddDeveloperRole). */
export class AddPmDevRole1750800000000 implements MigrationInterface {
  name = 'AddPmDevRole1750800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const enumNames = ['user_role_enum', 'users_role_enum'];
    for (const enumName of enumNames) {
      try {
        await queryRunner.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'pm_dev'`,
        );
      } catch (e) {
        // skip if enum doesn't exist
      }
    }
  }

  public async down(): Promise<void> {
    // Cannot remove enum values in PostgreSQL
  }
}
