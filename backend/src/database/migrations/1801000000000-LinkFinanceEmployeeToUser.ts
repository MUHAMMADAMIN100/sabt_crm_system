import { MigrationInterface, QueryRunner } from 'typeorm';

/** Связь «сотрудник в финансах» ↔ «аккаунт в CRM» (21.09.2026).
 *
 *  Зарплатная ведомость жила отдельно от пользователей: строки заводились
 *  вручную и опознавались только по имени. Теперь сотрудник видит свою
 *  зарплату в личном профиле — значит, строку нужно однозначно сопоставить
 *  с тем, кто залогинен, иначе человек увидит чужие деньги.
 *
 *  Разовое автосопоставление — по ТОЧНОМУ совпадению имени (без регистра и
 *  лишних пробелов) и только когда совпадение единственное с обеих сторон:
 *  два «Амина» не привяжутся ни к кому, их владелец свяжет вручную.
 *  Частичные совпадения намеренно не трогаем — цена ошибки здесь высокая. */
export class LinkFinanceEmployeeToUser1801000000000 implements MigrationInterface {
  name = 'LinkFinanceEmployeeToUser1801000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_employees" ADD COLUMN IF NOT EXISTS "userId" uuid NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_finance_employees_user"
        ON "finance_employees" ("userId") WHERE "userId" IS NOT NULL
    `);

    // Автопривязка: только уникальное точное совпадение имени.
    await queryRunner.query(`
      WITH emp AS (
        SELECT id, lower(btrim(name)) AS key
        FROM "finance_employees"
        WHERE "userId" IS NULL AND btrim(coalesce(name, '')) <> ''
      ),
      emp_uniq AS (
        SELECT key, min(id::text)::uuid AS id FROM emp GROUP BY key HAVING count(*) = 1
      ),
      usr AS (
        SELECT id, lower(btrim(name)) AS key
        FROM "users"
        WHERE btrim(coalesce(name, '')) <> ''
      ),
      usr_uniq AS (
        SELECT key, min(id::text)::uuid AS id FROM usr GROUP BY key HAVING count(*) = 1
      )
      UPDATE "finance_employees" fe
         SET "userId" = usr_uniq.id
        FROM emp_uniq
        JOIN usr_uniq ON usr_uniq.key = emp_uniq.key
       WHERE fe.id = emp_uniq.id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_finance_employees_user"`);
    await queryRunner.query(`ALTER TABLE "finance_employees" DROP COLUMN IF EXISTS "userId"`);
  }
}
