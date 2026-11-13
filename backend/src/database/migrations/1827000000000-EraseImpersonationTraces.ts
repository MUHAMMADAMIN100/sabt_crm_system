import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Войти как» не оставляет следов (решение владельца 13.11.2026).
 *
 * С 10:07 до этой выкладки вход в кабинет сотрудника записывался в журналы.
 * Стираем всё записанное за это время:
 *  - «Лента событий» (activity_logs): вход/выход в кабинет, общий след
 *    IMPERSONATED_ACTION и записи сервисов с пометкой impersonatedBy —
 *    действия изнутри чужого кабинета владелец решил не показывать вовсе;
 *  - финансовый журнал: записи с пометкой impersonatedBy;
 *  - журнал безопасности: вход/выход, отказы «Войти как» и «попытки доступа
 *    выше роли», которые сделал в кабинете сотрудника основатель/админ, а
 *    записались они на сотрудника (окно между входом и выходом, не больше
 *    12 часов — столько живёт вход).
 *
 * Сначала журнал безопасности по окнам, потом сами события входа/выхода —
 * иначе окна было бы не из чего построить. Таблиц может не быть (база,
 * поднятая с нуля) — тогда шаг пропускаем. Откатывать нечего.
 */
export class EraseImpersonationTraces1827000000000 implements MigrationInterface {
  name = 'EraseImpersonationTraces1827000000000';

  private async has(q: QueryRunner, table: string): Promise<boolean> {
    const rows: Array<{ ok: boolean }> = await q.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
    return !!rows[0]?.ok;
  }

  async up(q: QueryRunner): Promise<void> {
    if (await this.has(q, 'security_events')) {
      await q.query(`
        DELETE FROM security_events e
         USING (
           SELECT s."userId" AS actor, s.details->>'targetId' AS target, s."createdAt" AS since,
                  COALESCE(
                    (SELECT min(x."createdAt") FROM security_events x
                      WHERE x.type::text = 'impersonation_end' AND x."userId" = s."userId"
                        AND x.details->>'targetId' = s.details->>'targetId'
                        AND x."createdAt" >= s."createdAt"),
                    s."createdAt" + interval '12 hours') AS till
             FROM security_events s
            WHERE s.type::text = 'impersonation_start'
         ) w
        WHERE e.type::text = 'forbidden_access'
          AND e."userId"::text = w.target
          AND e."createdAt" BETWEEN w.since AND w.till`);
      await q.query(`
        DELETE FROM security_events
         WHERE type::text IN ('impersonation_start', 'impersonation_end')
            OR (type::text = 'forbidden_access' AND details->>'path' = 'auth/impersonate')`);
    }
    if (await this.has(q, 'activity_logs')) {
      await q.query(`
        DELETE FROM activity_logs
         WHERE action::text = 'IMPERSONATED_ACTION'
            OR details ? 'impersonatedBy'
            OR details->>'impersonation' IN ('start', 'end')`);
    }
    if (await this.has(q, 'finance_activity')) {
      await q.query(`DELETE FROM finance_activity WHERE details ? 'impersonatedBy'`);
    }
  }

  async down(): Promise<void> {
    // Стёртые записи не восстанавливаются — и не должны.
  }
}
