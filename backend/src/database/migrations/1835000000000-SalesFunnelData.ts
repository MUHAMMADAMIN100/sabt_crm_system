import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Продажи, этап 2 (15.11.2026) — перенос данных в единую воронку.
 *
 * Раньше у лида было две несвязанные воронки: «Статус» и «Этап онбординга».
 * Теперь этап один — status:
 *   new «Новый» → waiting «Контакт» → meeting «Встреча» → proposal «КП»
 *   → contract «Договор» → won «Выиграно» | lost «Проиграно».
 * «На паузе» — флаг onHold, а не этап.
 *
 * Перенос:
 *   on_hold → onHold = true, этап — из «Этапа онбординга» или «Контакт»;
 *   negotiating («В переговорах») → waiting; unknown → new;
 *   этап онбординга дальше статуса → статус = этап (negotiation → waiting,
 *   meeting → meeting, kp_creation → proposal, contract → contract,
 *   implementation → won); cancelled → lost (если сделка не выиграна).
 * Колонка onboardingStage остаётся как история, интерфейс её не показывает.
 *
 * Встречи в KPI теперь засчитываются, когда менеджер отметил «состоялась»:
 * заранее записанные будущие встречи (lead_actions kind=meeting с at в
 * будущем) удаляем — они засчитаются при подтверждении.
 */
export class SalesFunnelData1835000000000 implements MigrationInterface {
  name = 'SalesFunnelData1835000000000';

  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('client_leads'))) return;
    const t = await this.statusType(q);
    const as = (v: string) => `'${v}'::text::${t}`;

    const stageAsStatus = `(CASE "onboardingStage"::text
        WHEN 'negotiation' THEN 'waiting' WHEN 'meeting' THEN 'meeting'
        WHEN 'kp_creation' THEN 'proposal' WHEN 'contract' THEN 'contract'
        WHEN 'implementation' THEN 'won' ELSE NULL END)`;
    const rankOf = (expr: string) => `(CASE ${expr}
        WHEN 'new' THEN 0 WHEN 'waiting' THEN 1 WHEN 'meeting' THEN 2
        WHEN 'proposal' THEN 3 WHEN 'contract' THEN 4 WHEN 'won' THEN 5
        ELSE -1 END)`;

    // 1. Пауза — флаг; этап берём из онбординга или «Контакт».
    await q.query(`
      UPDATE client_leads
         SET "onHold" = true,
             status = COALESCE(${stageAsStatus}, 'waiting')::text::${t}
       WHERE status::text = 'on_hold'
    `);

    // 2. Устаревшие статусы.
    await q.query(`UPDATE client_leads SET status = ${as('waiting')} WHERE status::text = 'negotiating'`);
    await q.query(`UPDATE client_leads SET status = ${as('new')} WHERE status::text = 'unknown'`);

    // 3. Этап онбординга дальше статуса — статус догоняет этап.
    await q.query(`
      UPDATE client_leads
         SET status = ${stageAsStatus}::text::${t}
       WHERE "onboardingStage" IS NOT NULL
         AND status::text NOT IN ('won', 'lost')
         AND ${stageAsStatus} IS NOT NULL
         AND ${rankOf(stageAsStatus)} > ${rankOf('status::text')}
    `);

    // 4. Отмена в онбординге — проигрыш (выигранные не трогаем).
    await q.query(`
      UPDATE client_leads
         SET status = ${as('lost')}
       WHERE "onboardingStage"::text = 'cancelled'
         AND status::text NOT IN ('won', 'lost')
    `);
    // Проигранным без кода причины — «Другое» (текст остаётся в rejectionReason).
    await q.query(`UPDATE client_leads SET "lostReason" = 'other' WHERE status::text = 'lost' AND "lostReason" IS NULL`);

    // 5. Будущие встречи больше не засчитываются заранее.
    const hasAt: Array<{ ok: number }> = await q.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'lead_actions' AND column_name = 'at' LIMIT 1`,
    );
    if (hasAt.length) {
      await q.query(`DELETE FROM lead_actions WHERE kind = 'meeting' AND at IS NOT NULL AND at > now()`);
    }
  }

  async down(): Promise<void> {
    // Перенос необратим: прежние статусы и этапы однозначно не восстановить.
  }

  /** Имя типа колонки status (по каталогу, а не по догадке). */
  private async statusType(q: QueryRunner): Promise<string> {
    const rows: Array<{ typname: string }> = await q.query(
      `SELECT t.typname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         JOIN pg_type t ON t.oid = a.atttypid
        WHERE c.relname = 'client_leads' AND a.attname = 'status' AND NOT a.attisdropped`,
    );
    const name = rows[0]?.typname || 'varchar';
    return /^[a-z_][a-z0-9_]*$/i.test(name) ? `"${name}"` : 'varchar';
  }
}
