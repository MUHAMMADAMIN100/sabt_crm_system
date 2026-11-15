import { MigrationInterface, QueryRunner } from 'typeorm';
import { addEnumValues } from '../migration-helpers';

/**
 * Продажи, этап 2 (15.11.2026) — схема. Данные переносит следующая
 * миграция (1835): новые значения enum нельзя использовать в той же
 * транзакции, где их добавили.
 *
 * - client_leads.status: единая воронка — добавлены «meeting» и «contract».
 * - client_leads: на паузе (флаг), срок следующего шага, вероятность,
 *   ожидаемая дата закрытия, причина отказа (код), итог встречи,
 *   передача в работу и связь с проектом.
 * - projects.leadId — из какого лида создан проект.
 * - lead_events — лента событий лида (звонки, письма, встречи, этапы,
 *   комментарии, передача в работу).
 * - sales_settings — нормы KPI по направлениям и комиссия (ключ → jsonb).
 *
 * На пустой базе таблиц ещё может не быть — тогда пропускаем их часть.
 */
export class SalesFunnelSchema1834000000000 implements MigrationInterface {
  name = 'SalesFunnelSchema1834000000000';

  async up(q: QueryRunner): Promise<void> {
    if (await q.hasTable('client_leads')) {
      await addEnumValues(q, 'client_leads', 'status', ['meeting', 'contract']);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "onHold" boolean NOT NULL DEFAULT false`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "nextStepAt" timestamptz NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "probability" integer NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "expectedCloseAt" date NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "lostReason" varchar(32) NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "meetingResult" varchar(16) NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "handoffAt" timestamptz NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "handoffById" uuid NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "handoffData" jsonb NULL`);
      await q.query(`ALTER TABLE client_leads ADD COLUMN IF NOT EXISTS "projectId" uuid NULL`);
      await q.query(`CREATE INDEX IF NOT EXISTS idx_client_leads_owner_status ON client_leads ("ownerId", status)`);
      await q.query(`CREATE INDEX IF NOT EXISTS idx_client_leads_handoff ON client_leads ("handoffAt") WHERE "handoffAt" IS NOT NULL`);
    }
    if (await q.hasTable('projects')) {
      await q.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS "leadId" uuid NULL`);
    }
    await q.query(`
      CREATE TABLE IF NOT EXISTS lead_events (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id    uuid NOT NULL,
        user_id    uuid NULL,
        kind       varchar(32) NOT NULL,
        data       jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_lead_events_lead_date ON lead_events (lead_id, created_at DESC)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS sales_settings (
        key        varchar(64) PRIMARY KEY,
        value      jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid NULL
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS sales_settings`);
    await q.query(`DROP TABLE IF EXISTS lead_events`);
    if (await q.hasTable('projects')) {
      await q.query(`ALTER TABLE projects DROP COLUMN IF EXISTS "leadId"`);
    }
    if (await q.hasTable('client_leads')) {
      for (const c of ['projectId', 'handoffData', 'handoffById', 'handoffAt', 'meetingResult', 'lostReason', 'expectedCloseAt', 'probability', 'nextStepAt', 'onHold']) {
        await q.query(`ALTER TABLE client_leads DROP COLUMN IF EXISTS "${c}"`);
      }
      // Значения enum (meeting, contract) Postgres удалить не умеет — остаются.
    }
  }
}
